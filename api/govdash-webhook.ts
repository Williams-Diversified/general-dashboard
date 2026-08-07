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
 * integration is attached to the project. If they are absent, or the store is
 * unreachable, we do NOT simply post anyway: that silent fail-open is what let
 * one requirement reach #pipeline two dozen times. Instead the degradation is
 * logged as an error and dedup falls back to scanning Slack history, so the
 * worst case is a weaker check rather than no check. We still never drop a real
 * opportunity - if both the ledger and the fallback are unavailable, we post.
 */
const KV_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_CONFIGURED = Boolean(KV_URL && KV_TOKEN);

/** #pipeline channel id, used by the Slack-history dedup fallback. */
const PIPELINE_CHANNEL_ID = process.env.PIPELINE_CHANNEL_ID ?? 'C0B59LQGJTY';

/** How far back the Slack-history fallback looks for an existing post. */
const HISTORY_LOOKBACK_DAYS = 30;

/**
 * TTL applies to the content-derived key only. The identity keys (GovDash id,
 * solicitation number, notice id) are permanent - each names one specific
 * record. The content key is a fuzzy match on title + NAICS + location, so it
 * has to expire: a recurring annual requirement posted under the same title
 * would otherwise be suppressed forever.
 */
const CONTENT_KEY_TTL_SECONDS = 120 * 24 * 60 * 60;

async function kvCommand(command: string[]): Promise<unknown> {
  const path = command.map(encodeURIComponent).join('/');
  const res = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

/**
 * `available: false` means the ledger could not be consulted at all - not
 * configured, or unreachable. Callers must fall back to another check rather
 * than reading `hit: false` as "definitely not posted yet". Conflating those
 * two cases is what made the original fail-open silent.
 */
async function alreadyPosted(keys: string[]): Promise<{ hit: boolean; available: boolean }> {
  if (!KV_CONFIGURED || keys.length === 0) return { hit: false, available: false };
  try {
    const result = await kvCommand(['exists', ...keys]);
    return { hit: typeof result === 'number' && result > 0, available: true };
  } catch (err) {
    console.error('KV dedup check failed - ledger unavailable:', err);
    return { hit: false, available: false };
  }
}

async function markPosted(keys: string[], name: string, ttlKeys: Set<string>): Promise<void> {
  if (!KV_CONFIGURED) return;
  for (const key of keys) {
    try {
      await kvCommand(
        ttlKeys.has(key)
          ? ['set', key, name, 'EX', String(CONTENT_KEY_TTL_SECONDS)]
          : ['set', key, name],
      );
    } catch (err) {
      console.warn('KV mark-posted failed for', key, err);
    }
  }
}

/**
 * Fuzzy identity for a requirement, stable across the churn that defeats all
 * three identity keys at once: GovDash re-creating an opportunity under a fresh
 * `opp_` id, SAM.gov re-issuing the 32-hex notice id on each amendment, and
 * payloads that carry no solicitation number at all. When those rotate together
 * every re-fire looks brand new, which is how one requirement ended up posted
 * two dozen times.
 *
 * Deliberately excludes the due date - an amendment that moves the deadline is
 * still the same requirement, and including it would let those through.
 */
function contentKey(
  name: string | undefined,
  naicsCode: string | undefined,
  location: string | undefined,
): string | null {
  const title = name?.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const basis = [title, naicsCode ?? '', location?.toLowerCase().trim() ?? ''].join('|');
  const hash = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
  return `pipeline:seen:content:${hash}`;
}

/** The 32-hex SAM.gov notice id embedded in a `/opp/<id>/view` URL. */
function noticeIdFrom(samUrl: string | undefined): string | undefined {
  return samUrl?.match(/\/opp\/([0-9a-f]{32})/i)?.[1]?.toLowerCase();
}

/** How long to wait on SAM before giving up and posting without the strong key. */
const SAM_LOOKUP_TIMEOUT_MS = 4000;

/**
 * Resolve a solicitation number from a SAM.gov notice id.
 *
 * GovDash omits `solicitationNumber` on most payloads, which silently drops the
 * strongest dedup key and leaves only keys that rotate: GovDash re-creates
 * opportunities under fresh `opp_` ids, and SAM re-issues the notice id on every
 * amendment. The content key covers some of that, but it breaks whenever the CO
 * retitles a notice - the same Turner requirement (47PD5526R0042) posted as both
 * "Turner Roof and Building Envelope Project" and "MT0055AW ... Turner LPOE -
 * Amendment 0001". SAM knows the solicitation number for a notice id, so look it
 * up here and dedup on the one identifier that survives all of that churn.
 *
 * Strictly best-effort. This endpoint 404s for pulled or superseded notices and
 * has intermittently returned 401, so every failure path returns undefined and
 * dedup carries on with the remaining keys. It must never block or delay a real
 * opportunity reaching #pipeline.
 */
async function resolveSolicitationNumber(noticeId: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAM_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://sam.gov/api/prod/opps/v2/opportunities/${noticeId}`, {
      headers: { Accept: 'application/hal+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      // 404 means the notice was pulled or superseded, 401 means the endpoint is
      // gated again. Both are expected states rather than defects.
      console.log(`SAM lookup for ${noticeId} returned ${res.status} - no solicitation number`);
      return undefined;
    }
    // The record nests under `data2`, not `data`.
    const body = (await res.json()) as { data2?: { solicitationNumber?: string } };
    return body.data2?.solicitationNumber?.trim() || undefined;
  } catch (err) {
    console.warn('SAM solicitation lookup failed for', noticeId, err);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function buildDedupKeys(
  opportunityId: string | undefined,
  solicitationNumber: string | undefined,
  noticeId: string | undefined,
  name: string | undefined,
  naicsCode: string | undefined,
  location: string | undefined,
): { keys: string[]; ttlKeys: Set<string> } {
  const content = contentKey(name, naicsCode, location);
  const keys = [
    opportunityId ? `pipeline:seen:opp:${opportunityId}` : null,
    // Matched exactly, including any trailing amendment letter. A reopened
    // solicitation gets a letter suffix and a new notice id while the original
    // goes inactive (697DCK-26-R-00315 -> 697DCK-26-R-00315a), and the feed has
    // posted the dead one before the live one. Collapsing the suffix would
    // suppress the live reopening as a duplicate of a closed notice.
    solicitationNumber ? `pipeline:seen:sol:${solicitationNumber.trim().toUpperCase()}` : null,
    noticeId ? `pipeline:seen:notice:${noticeId.toLowerCase()}` : null,
    content,
  ].filter((k): k is string => k !== null);
  return { keys, ttlKeys: new Set(content ? [content] : []) };
}

/**
 * Dedup fallback for when the KV ledger cannot be consulted: look for an
 * existing `*Pipeline opportunity:* <name>` post in #pipeline. Strictly weaker
 * than the ledger - a post deleted during cleanup is invisible here, and it
 * costs Slack API calls - but it keeps duplicate suppression working when no KV
 * store is attached, instead of degrading to no suppression at all.
 *
 * Needs the `channels:history` scope on SLACK_BOT_TOKEN. If that scope is
 * missing the call fails loudly in the logs and we post rather than drop.
 */
async function postedInSlackHistory(name: string | undefined, token: string): Promise<boolean> {
  if (!name) return false;
  const needle = `*Pipeline opportunity:* ${name}`;
  const oldest = Math.floor(Date.now() / 1000) - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60;
  let cursor: string | undefined;

  for (let page = 0; page < 5; page++) {
    const url = new URL('https://slack.com/api/conversations.history');
    url.searchParams.set('channel', PIPELINE_CHANNEL_ID);
    url.searchParams.set('limit', '200');
    url.searchParams.set('oldest', String(oldest));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      messages?: { text?: string }[];
      response_metadata?: { next_cursor?: string };
    };

    if (!data.ok) {
      console.error('Slack history dedup unavailable:', data.error, '- cannot verify duplicates');
      return false;
    }
    // Compare the first line exactly; a startsWith would let one title that is a
    // prefix of another suppress the longer one.
    if (data.messages?.some(m => m.text?.split('\n')[0] === needle)) return true;

    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return false;
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

  // Reported in the response so the Svix delivery log shows whether the strong
  // key was available for this delivery.
  let solicitationSource: 'payload' | 'sam' | 'none' = 'none';

  if (isNewOpportunity) {
    let solicitationNumber = (data.solicitationNumber as string | undefined)?.trim() || undefined;
    const name = data.name as string | undefined;
    const naicsCode = data.naicsCode as string | undefined;
    const dueDate = data.dueDate as string | undefined;
    const setAside = (data.setAside as { value?: string } | undefined)?.value;
    const placeOfPerformance = data.placeOfPerformance as { city?: string; state?: string } | undefined;
    const samUrl = (data.source as { url?: string } | undefined)?.url;

    const slackToken = process.env.SLACK_BOT_TOKEN;

    const location = placeOfPerformance
      ? `${placeOfPerformance.city ?? ''}, ${placeOfPerformance.state ?? ''}`.trim().replace(/^,\s*/, '')
      : 'Unknown';

    // Fill in the solicitation number from SAM before the ledger is consulted,
    // so the key that survives amendments and retitles is actually present.
    const noticeId = noticeIdFrom(samUrl);
    if (solicitationNumber) {
      solicitationSource = 'payload';
    } else if (noticeId) {
      const resolved = await resolveSolicitationNumber(noticeId);
      if (resolved) {
        solicitationNumber = resolved;
        solicitationSource = 'sam';
        console.log(`Resolved solicitation ${resolved} from SAM notice ${noticeId}`);
      }
    }

    // Skip anything already posted, even if its Slack post was later deleted.
    const { keys: dedupKeys, ttlKeys } = buildDedupKeys(
      opportunityId,
      solicitationNumber,
      noticeId,
      name,
      naicsCode,
      location,
    );

    const ledger = await alreadyPosted(dedupKeys);
    let isDuplicate = ledger.hit;

    if (!ledger.available) {
      // Fail loud. A silent fail-open means every re-fire becomes a new post,
      // which is how #pipeline filled up with repeats of the same requirement.
      console.error(
        KV_CONFIGURED
          ? 'DEDUP DEGRADED: KV ledger unreachable - falling back to Slack history.'
          : 'DEDUP DEGRADED: KV_REST_API_URL / KV_REST_API_TOKEN are not set, so the Vercel KV integration is not attached. Falling back to Slack history.',
      );
      if (slackToken) isDuplicate = await postedInSlackHistory(name, slackToken);
    }

    if (isDuplicate) {
      console.log('Opportunity already posted to #pipeline, skipping:', name);
      res.status(200).json({ received: true, skipped: 'duplicate' });
      return;
    }

    if (slackToken) {
      const dueDateFormatted = dueDate
        ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
        : 'TBD';

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
        await markPosted(dedupKeys, name ?? 'Unnamed', ttlKeys);
      }
    } else {
      console.warn('SLACK_BOT_TOKEN not set — skipping #pipeline notification');
    }
  }

  // `dedup` reports which mechanism is actually live, so a degraded ledger is
  // visible from the Svix delivery log without digging through function logs.
  res.status(200).json({
    received: true,
    dedup: KV_CONFIGURED ? 'kv' : 'slack-history',
    solicitation: solicitationSource,
  });
}
