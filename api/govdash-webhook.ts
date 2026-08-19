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
 * unreachable, dedup has no fallback (we deliberately do not read Slack history
 * - the bot has no channel read scope). The degradation is logged as an error
 * so it is visible, and we post rather than drop: never lose a real opportunity.
 */
const KV_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_CONFIGURED = Boolean(KV_URL && KV_TOKEN);

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

/** How long to wait on SAM before giving up and posting without its answer. */
const SAM_LOOKUP_TIMEOUT_MS = 4000;

/**
 * Grace period before a passed deadline counts as closed. Absorbs clock skew and
 * date-only feed values so an opportunity closing today is never mistaken for
 * one that closed already.
 */
const CLOSED_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * What SAM.gov knows about a notice id.
 *
 * `missing` (404) and `unavailable` (timeout, 401, unparseable body) are kept
 * apart deliberately. A 404 is a real statement about the notice; the others
 * tell us nothing and must never be read as evidence against an opportunity.
 */
type NoticeLookup =
  | {
      status: 'ok';
      solicitationNumber?: string;
      responseDeadline?: string;
      archived: boolean;
      cancelled: boolean;
    }
  | { status: 'missing' }
  | { status: 'unavailable' };

/**
 * Ask SAM.gov about a notice id. Two jobs.
 *
 * First, the solicitation number. GovDash omits it on most payloads, which
 * silently drops the strongest dedup key and leaves only keys that rotate:
 * GovDash re-creates opportunities under fresh `opp_` ids, and SAM re-issues the
 * notice id on every amendment. The content key covers some of that, but it
 * breaks whenever a CO retitles a notice - the same Turner requirement
 * (47PD5526R0042) posted as both "Turner Roof and Building Envelope Project" and
 * "MT0055AW ... Turner LPOE - Amendment 0001".
 *
 * Second, liveness. The feed republishes notices whose response date has long
 * passed - AMXG Group Air Compressors kept arriving for over a week after quotes
 * closed on 2026-08-05 - and SAM's own deadline is the authority on that,
 * because the feed's `dueDate` is routinely stale in both directions.
 *
 * Strictly best-effort. Every failure path reports `unavailable` so the
 * opportunity still reaches #pipeline. It must never block or delay real work.
 */
async function lookupNotice(noticeId: string): Promise<NoticeLookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAM_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://sam.gov/api/prod/opps/v2/opportunities/${noticeId}`, {
      headers: { Accept: 'application/hal+json' },
      signal: controller.signal,
    });
    if (res.status === 404) {
      // The notice is not on SAM at all - pulled, superseded, or never public.
      console.log(`SAM lookup for ${noticeId} returned 404 - notice not on SAM.gov`);
      return { status: 'missing' };
    }
    if (!res.ok) {
      // 401 has shown up intermittently when the endpoint is gated again.
      console.log(`SAM lookup for ${noticeId} returned ${res.status} - treating as unavailable`);
      return { status: 'unavailable' };
    }
    // The solicitation record nests under `data2`; the lifecycle flags sit at the
    // top level beside it, not inside it.
    const body = (await res.json()) as {
      data2?: {
        solicitationNumber?: string;
        solicitation?: { deadlines?: { response?: string } };
      };
      archived?: boolean;
      cancelled?: boolean;
    };
    return {
      status: 'ok',
      solicitationNumber: body.data2?.solicitationNumber?.trim() || undefined,
      responseDeadline: body.data2?.solicitation?.deadlines?.response || undefined,
      archived: body.archived === true,
      cancelled: body.cancelled === true,
    };
  } catch (err) {
    console.warn('SAM lookup failed for', noticeId, err);
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

function hasPassed(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < Date.now() - CLOSED_GRACE_MS;
}

/**
 * Why this opportunity can no longer be bid, or null if it still can be.
 *
 * Distinct from dedup: the ledger stops the same opportunity being posted twice,
 * this stops one nobody can act on being posted at all. The AMXG flood was the
 * second kind - it arrived under a fresh notice id every time, so no ledger key
 * would have matched it anyway.
 *
 * SAM is the authority whenever it answers. The feed's own `dueDate` is only
 * consulted to corroborate a 404, because it is stale in both directions: it has
 * read a day early on live notices, so gating on it alone would drop real work.
 * Requiring both signals to agree means that even an outage turning every lookup
 * into a 404 still cannot suppress a live-dated opportunity.
 */
function closedReason(lookup: NoticeLookup, payloadDueDate: string | undefined): string | null {
  if (lookup.status === 'ok') {
    if (lookup.cancelled) return 'cancelled on SAM.gov';
    if (lookup.archived) return 'archived on SAM.gov';
    if (hasPassed(lookup.responseDeadline)) {
      return `response deadline ${lookup.responseDeadline} has passed`;
    }
    return null;
  }
  if (lookup.status === 'missing' && hasPassed(payloadDueDate)) {
    return `notice is not on SAM.gov and the feed due date ${payloadDueDate} has passed`;
  }
  return null;
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
  // key was available for this delivery, and whether SAM could be reached to
  // judge liveness at all.
  let solicitationSource: 'payload' | 'sam' | 'none' = 'none';
  let noticeStatus: NoticeLookup['status'] | 'no-url' = 'no-url';

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

    // One SAM lookup now serves both the dedup key and the liveness gate, so it
    // runs even when the payload already carries a solicitation number.
    const noticeId = noticeIdFrom(samUrl);
    const lookup: NoticeLookup = noticeId ? await lookupNotice(noticeId) : { status: 'unavailable' };
    if (noticeId) noticeStatus = lookup.status;

    // Fill in the solicitation number from SAM before the ledger is consulted,
    // so the key that survives amendments and retitles is actually present.
    if (solicitationNumber) {
      solicitationSource = 'payload';
    } else if (lookup.status === 'ok' && lookup.solicitationNumber) {
      solicitationNumber = lookup.solicitationNumber;
      solicitationSource = 'sam';
      console.log(`Resolved solicitation ${solicitationNumber} from SAM notice ${noticeId}`);
    }

    // Drop opportunities whose window has already closed. Nothing downstream can
    // act on one: the runner's Stage 1 can only ever return NO-BID, and the feed
    // re-sends it indefinitely under rotating notice ids, so each repost costs a
    // fresh showstopper analysis for an opportunity nobody can bid.
    const closed = closedReason(lookup, dueDate);
    if (closed) {
      console.log(`Opportunity closed (${closed}), not posting to #pipeline:`, name);
      res.status(200).json({ received: true, skipped: 'closed', reason: closed });
      return;
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
    const isDuplicate = ledger.hit;

    if (!ledger.available) {
      // Fail loud, then post. Duplicate suppression depends entirely on the KV
      // ledger; without it there is no fallback, so we log and post rather than
      // drop. A silent fail-open is how #pipeline filled up with repeats before,
      // so this stays a logged, visible degradation.
      console.error(
        KV_CONFIGURED
          ? 'DEDUP DEGRADED: KV ledger unreachable - posting without duplicate suppression.'
          : 'DEDUP DEGRADED: KV_REST_API_URL / KV_REST_API_TOKEN are not set, so the Vercel KV integration is not attached. Posting without duplicate suppression.',
      );
    }

    if (isDuplicate) {
      console.log('Opportunity already posted to #pipeline, skipping:', name);
      res.status(200).json({ received: true, skipped: 'duplicate' });
      return;
    }

    if (slackToken) {
      // SAM's deadline wins when we have it. The feed's dueDate has been seen
      // both a day early on live notices and a week stale on closed ones, and a
      // wrong date here becomes a wrong Stage 1 timeline verdict downstream.
      const effectiveDueDate =
        (lookup.status === 'ok' ? lookup.responseDeadline : undefined) ?? dueDate;
      const dueDateFormatted = effectiveDueDate
        ? new Date(effectiveDueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
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

  // `dedup` reports whether the KV ledger is live, so a degraded ledger (dedup
  // "none") is visible from the Svix delivery log without digging through logs.
  res.status(200).json({
    received: true,
    dedup: KV_CONFIGURED ? 'kv' : 'none',
    solicitation: solicitationSource,
    notice: noticeStatus,
  });
}
