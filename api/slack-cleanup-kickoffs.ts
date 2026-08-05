/**
 * POST /api/slack-cleanup-kickoffs
 *
 * Scans a Slack channel (#pipeline by default) for Claude WD opportunity
 * threads that contain a Cowork kickoff, and deletes each such thread in full
 * (parent post + every reply). This automates the recurring manual cleanup.
 *
 * What counts as a "kickoff thread":
 *   - The thread parent was posted by THIS bot (protects human-posted
 *     opportunities like ones pasted via /pipeline-post - the bot cannot and
 *     will not delete those).
 *   - Some reply in the thread contains the exact marker "Cowork Kickoff Ready".
 *     The duplicate-skip note ("...skipping Cowork Kickoff here") does NOT
 *     contain "Ready", so dupe-skip threads are correctly left alone.
 *
 * Only messages authored by the bot are deleted; any stray human reply in a
 * matched thread is left untouched (chat.delete would reject it anyway).
 *
 * Body: { channel?, dryRun?, mode?, sinceDays?, beforeDays?, maxThreads? }
 *   channel    - channel ID (default: PIPELINE_CHANNEL_ID env var / hardcoded)
 *   dryRun     - if true, report what WOULD be deleted without deleting
 *   mode       - "kickoffs" (default): delete bot threads containing a
 *                "Cowork Kickoff Ready" reply.
 *                "olderThan": delete every bot opportunity thread whose PARENT
 *                post is older than `beforeDays` (whole thread, replies included).
 *   sinceDays  - kickoffs mode only: scan back this many days (default 10).
 *   beforeDays - olderThan mode only: delete threads whose parent is older than
 *                this many days (default 7).
 *   maxThreads - cap threads deleted per call (default 40) to stay inside the
 *                serverless time limit; re-invoke while `remaining` > 0.
 *   beforeTs   - olderThan mode: explicit Unix-second cutoff (overrides
 *                beforeDays). Use this to avoid any dependence on the server
 *                clock - delete threads whose parent ts is < beforeTs.
 *   oldestTs   - explicit Unix-second lower bound for the history scan
 *                (overrides sinceDays). Pass 0 to scan the whole channel.
 * In both modes, only bot-authored messages are deleted and human-posted
 * parents are always skipped.
 * Auth: X-Runner-Secret header must match RUNNER_SECRET env var.
 *
 * Slack scopes required on the bot token: channels:history (read the channel),
 * chat:write (delete its own messages).
 */

const DEFAULT_PIPELINE_CHANNEL = process.env.PIPELINE_CHANNEL_ID ?? 'C0B59LQGJTY';
const KICKOFF_MARKER = 'Cowork Kickoff Ready';

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  reply_count?: number;
  subtype?: string;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const runnerSecret = process.env.RUNNER_SECRET;
  if (!runnerSecret) {
    res.status(500).json({ error: 'RUNNER_SECRET not configured' });
    return;
  }
  if ((req.headers['x-runner-secret'] as string | undefined) !== runnerSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const channel = (body.channel as string | undefined) ?? DEFAULT_PIPELINE_CHANNEL;
  const dryRun = body.dryRun === true;
  const mode = body.mode === 'olderThan' ? 'olderThan' : 'kickoffs';
  const sinceDays = typeof body.sinceDays === 'number' && body.sinceDays > 0 ? body.sinceDays : 10;
  const maxThreads = typeof body.maxThreads === 'number' && body.maxThreads > 0 ? body.maxThreads : 40;

  // kickoffs mode: only scan recent history (kickoffs are on recent posts).
  // olderThan mode: scan everything and select parents older than the cutoff.
  //
  // Timestamps: prefer explicit Unix-second overrides (beforeTs / oldestTs) so
  // the cutoff never depends on the server wall clock, which can differ from
  // the channel's message timestamps. Fall back to day-offsets from Date.now()
  // only when no explicit value is given.
  const beforeDays = typeof body.beforeDays === 'number' && body.beforeDays > 0 ? body.beforeDays : 7;
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffTs = typeof body.beforeTs === 'number' && body.beforeTs > 0
    ? body.beforeTs
    : nowSec - beforeDays * 86400; // olderThan: delete threads whose parent ts is before this
  const oldest = typeof body.oldestTs === 'number' && body.oldestTs >= 0
    ? String(body.oldestTs)
    : mode === 'kickoffs' ? String(nowSec - sinceDays * 86400) : '0';

  const authHeader = { Authorization: `Bearer ${token}` };

  async function slackGet(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams(params);
    const r = await fetch(`https://slack.com/api/${method}?${qs}`, { headers: authHeader });
    return (await r.json()) as Record<string, unknown>;
  }

  try {
    // Identify our own bot user id so we only touch our own posts.
    const auth = await slackGet('auth.test', {});
    if (!auth.ok) {
      res.status(502).json({ error: 'auth.test failed', detail: auth.error });
      return;
    }
    const botUserId = auth.user_id as string;

    // 1. Page through channel history to collect top-level messages.
    const parents: SlackMessage[] = [];
    let cursor = '';
    do {
      const params: Record<string, string> = { channel, limit: '200', oldest };
      if (cursor) params.cursor = cursor;
      const page = await slackGet('conversations.history', params);
      if (!page.ok) {
        res.status(502).json({ error: 'conversations.history failed', detail: page.error });
        return;
      }
      for (const m of (page.messages as SlackMessage[]) ?? []) parents.push(m);
      cursor = ((page.response_metadata as Record<string, unknown> | undefined)?.next_cursor as string) ?? '';
      if (cursor) await sleep(1200); // history is tier 3
    } while (cursor);

    // 2. Select the bot-authored parent threads to delete, per mode.
    //    kickoffs   -> thread contains a "Cowork Kickoff Ready" reply.
    //    olderThan  -> parent post is older than the cutoff (whole thread goes).
    // Cap at maxThreads per call so the run stays inside the time limit; the
    // caller re-invokes until `remaining` is 0.
    const candidates = parents.filter(p => p.user === botUserId);
    const toDelete: { name: string; parentTs: string; messageTs: string[] }[] = [];
    let matched = 0;
    for (const parent of candidates) {
      if (mode === 'olderThan') {
        if (Number(parent.ts) >= cutoffTs) continue; // newer than a week - keep
      } else {
        if (!parent.reply_count || parent.reply_count < 1) continue;
      }

      // Gather this thread's messages (need replies for their ts, and for the
      // kickoff-marker check). A 0-reply parent in olderThan mode is just itself.
      let msgs: SlackMessage[] = [parent];
      if (parent.reply_count && parent.reply_count > 0) {
        const replies = await slackGet('conversations.replies', { channel, ts: parent.ts, limit: '200' });
        await sleep(1200); // replies is tier 3
        if (!replies.ok) continue;
        msgs = (replies.messages as SlackMessage[]) ?? [parent];
      }

      if (mode === 'kickoffs' && !msgs.some(m => (m.text ?? '').includes(KICKOFF_MARKER))) continue;

      matched++;
      if (toDelete.length >= maxThreads) continue; // counted for `remaining`, deleted next call

      const ourTs = msgs.filter(m => m.user === botUserId).map(m => m.ts);
      const name = (parent.text ?? '').split('\n')[0].replace(/\*/g, '').slice(0, 120);
      toDelete.push({ name, parentTs: parent.ts, messageTs: ourTs });
    }
    const remaining = Math.max(0, matched - toDelete.length);

    if (dryRun) {
      res.status(200).json({
        dryRun: true,
        mode,
        channel,
        threadsMatched: matched,
        threadsThisRun: toDelete.length,
        remaining,
        messagesToDelete: toDelete.reduce((n, t) => n + t.messageTs.length, 0),
        threads: toDelete.map(t => ({ name: t.name, parentTs: t.parentTs, replies: t.messageTs.length })),
      });
      return;
    }

    // 3. Delete. Replies first, then parents (delete every collected ts;
    //    parent ts is already in the list). Retry once on rate limit.
    let deleted = 0;
    const failures: { ts: string; error: string }[] = [];
    for (const thread of toDelete) {
      for (const ts of thread.messageTs) {
        let attempt = 0;
        for (;;) {
          const r = await fetch('https://slack.com/api/chat.delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ channel, ts }),
          });
          const data = (await r.json()) as { ok: boolean; error?: string };
          if (data.ok) { deleted++; break; }
          if (data.error === 'ratelimited' && attempt < 3) { attempt++; await sleep(3000); continue; }
          failures.push({ ts, error: data.error ?? 'unknown' });
          break;
        }
        await sleep(1100); // chat.delete is tier 3 (~50/min)
      }
    }

    res.status(200).json({
      ok: true,
      mode,
      channel,
      threadsDeleted: toDelete.length,
      messagesDeleted: deleted,
      remaining,
      failures,
      threads: toDelete.map(t => t.name),
    });
  } catch (err) {
    console.error('slack-cleanup-kickoffs error:', err);
    res.status(502).json({ error: 'Cleanup failed', detail: err instanceof Error ? err.message : String(err) });
  }
}
