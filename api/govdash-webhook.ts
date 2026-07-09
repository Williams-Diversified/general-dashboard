import crypto from 'node:crypto';

/**
 * Serverless endpoint: POST /api/govdash-webhook
 *
 * Receives GovDash events via Svix. The event type is in the svix-event-type
 * header; the body is the raw opportunity object.
 */

function verifySignature(
  payload: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const msgId = headers['svix-id'] as string;
  const msgTimestamp = headers['svix-timestamp'] as string;
  const msgSignature = headers['svix-signature'] as string;

  if (!msgId || !msgTimestamp || !msgSignature) return false;

  // Reject messages older than 5 minutes
  const ts = parseInt(msgTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const toSign = `${msgId}.${msgTimestamp}.${payload}`;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const computed = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');

  // Svix may send multiple signatures; accept if any match
  const signatures = msgSignature.split(' ').map(s => s.split(',')[1]);
  return signatures.some(sig => sig === computed);
}

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

/**
 * Persistent dedup ledger backed by Vercel KV (Upstash Redis REST API).
 *
 * The initial #pipeline post is the only signal the runner acts on, but posts
 * get deleted during cleanup. Scanning the channel would miss anything already
 * removed, so we keep a durable record of every opportunity we have ever posted
 * keyed by GovDash id, solicitation number, and SAM.gov notice id. GovDash can
 * re-fire the webhook for the same opportunity (re-create, phase churn); this
 * stops those from producing duplicate pipeline posts.
 *
 * These env vars are injected automatically when the Vercel KV / Upstash
 * integration is attached to the project. If they are absent (or the store is
 * unreachable) we FAIL OPEN and post anyway - a duplicate post is a smaller
 * problem than silently dropping a real opportunity.
 */
const KV_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvCommand(command: string[]): Promise<unknown> {
  const path = command.map(encodeURIComponent).join('/');
  const res = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function alreadyPosted(keys: string[]): Promise<boolean> {
  if (!KV_URL || !KV_TOKEN || keys.length === 0) return false;
  try {
    const result = await kvCommand(['exists', ...keys]);
    return typeof result === 'number' && result > 0;
  } catch (err) {
    console.warn('KV dedup check failed - failing open (will post):', err);
    return false;
  }
}

async function markPosted(keys: string[], name: string): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  for (const key of keys) {
    try {
      await kvCommand(['set', key, name]);
    } catch (err) {
      console.warn('KV mark-posted failed for', key, err);
    }
  }
}

function buildDedupKeys(
  opportunityId: string | undefined,
  solicitationNumber: string | undefined,
  samUrl: string | undefined,
): string[] {
  const noticeId = samUrl?.match(/\/opp\/([0-9a-f]{32})/i)?.[1];
  return [
    opportunityId ? `pipeline:seen:opp:${opportunityId}` : null,
    solicitationNumber ? `pipeline:seen:sol:${solicitationNumber.toUpperCase()}` : null,
    noticeId ? `pipeline:seen:notice:${noticeId.toLowerCase()}` : null,
  ].filter((k): k is string => k !== null);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.GOVDASH_WEBHOOK_SECRET;
  if (!secret) {
    console.error('GOVDASH_WEBHOOK_SECRET is not set');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  const payload = JSON.stringify(req.body);
  if (!verifySignature(payload, req.headers, secret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const data = req.body as Record<string, unknown>;
  const opportunityId = data.id as string | undefined;

  console.log('GovDash webhook received:', JSON.stringify(data));

  // GovDash doesn't send an event type header. Distinguish creates from phase
  // moves by checking for the presence of 'name' — phase updates only contain
  // id and phase, while new opportunity payloads include all fields.
  const isNewOpportunity = opportunityId?.startsWith('opp_') && typeof data.name === 'string';

  if (isNewOpportunity) {
    const solicitationNumber = data.solicitationNumber as string | undefined;
    const name = data.name as string | undefined;
    const naicsCode = data.naicsCode as string | undefined;
    const dueDate = data.dueDate as string | undefined;
    const setAside = (data.setAside as { value?: string } | undefined)?.value;
    const placeOfPerformance = data.placeOfPerformance as { city?: string; state?: string } | undefined;
    const samUrl = (data.source as { url?: string } | undefined)?.url;

    // Skip anything already in the durable ledger, even if its Slack post was deleted.
    const dedupKeys = buildDedupKeys(opportunityId, solicitationNumber, samUrl);
    if (await alreadyPosted(dedupKeys)) {
      console.log('Opportunity already posted to #pipeline (ledger hit), skipping:', name);
      res.status(200).json({ received: true, skipped: 'duplicate' });
      return;
    }

    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      const dueDateFormatted = dueDate
        ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
        : 'TBD';

      const location = placeOfPerformance
        ? `${placeOfPerformance.city ?? ''}, ${placeOfPerformance.state ?? ''}`.trim().replace(/^,\s*/, '')
        : 'Unknown';

      const message = [
        `*Pipeline opportunity:* ${name ?? 'Unnamed'}`,
        solicitationNumber ? `Solicitation: \`${solicitationNumber}\`` : null,
        naicsCode ? `NAICS: ${naicsCode}` : null,
        setAside ? `Set-aside: ${setAside}` : null,
        location ? `Location: ${location}` : null,
        `Due: ${dueDateFormatted}`,
        samUrl ? `SAM.gov: ${samUrl}` : null,
      ].filter(Boolean).join('\n');

      const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${slackToken}`,
        },
        body: JSON.stringify({ channel: '#pipeline', text: message }),
      });

      const slackData = await slackRes.json() as { ok: boolean; error?: string };
      if (!slackData.ok) {
        console.error('Slack post failed:', slackData.error);
      } else {
        console.log('Posted to #pipeline successfully');
        // Record in the ledger only after a successful post so a failed post can retry.
        await markPosted(dedupKeys, name ?? 'Unnamed');
      }
    } else {
      console.warn('SLACK_BOT_TOKEN not set — skipping #pipeline notification');
    }
  }

  res.status(200).json({ received: true });
}
