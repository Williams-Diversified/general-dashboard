/**
 * POST /api/slack-post
 *
 * Posts a message as the Claude WD bot. Used by the bid runner so replies
 * appear as the bot rather than a personal account.
 *
 * Body: { channel: string, text: string, thread_ts?: string }
 * Auth: X-Runner-Secret header must match RUNNER_SECRET env var.
 *
 * Long messages: Slack's chat.postMessage splits a plain `text` value longer
 * than ~4,000 characters into several separate messages. The bid runner's
 * Cowork kickoff prompt runs 10-13k characters, so it was landing as 3-4
 * fragmented thread replies every cycle. To keep it as ONE message, anything
 * over the plain-text ceiling is sent as a `blocks` array of mrkdwn section
 * blocks instead - a single message can carry 50 blocks of 3,000 characters
 * each. `text` is still sent alongside as the notification fallback.
 */

/** Slack's hard cap on a section block's text. Kept under 3000 for headroom. */
const SECTION_LIMIT = 2900;

/** Slack allows 50 blocks per message. Leave a little room. */
const MAX_BLOCKS = 48;

/**
 * Plain `text` stays intact below this. Slack starts splitting around 4,000,
 * so stop well short of it.
 */
const PLAIN_TEXT_LIMIT = 3500;

/**
 * Splits text into chunks that each fit in one section block.
 *
 * Breaks on line boundaries so a chunk never lands mid-word or inside a
 * `*bold*` span or `<url|label>` link, since neither crosses a newline in the
 * runner's messages. A single line longer than the limit is split on spaces as
 * a last resort.
 */
function chunkForBlocks(text: string): string[] {
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    // Trailing blank lines would render as dead space at the block seam.
    const trimmed = current.replace(/\s+$/, '');
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const rawLine of text.split('\n')) {
    let line = rawLine;

    // A single over-long line cannot fit any chunk. Peel it off in pieces.
    while (line.length > SECTION_LIMIT) {
      flush();
      let cut = line.lastIndexOf(' ', SECTION_LIMIT);
      if (cut <= 0) cut = SECTION_LIMIT;
      chunks.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ /, '');
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > SECTION_LIMIT) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
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

  const provided = req.headers['x-runner-secret'] as string | undefined;
  if (provided !== runnerSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    res.status(500).json({ error: 'SLACK_BOT_TOKEN not configured' });
    return;
  }

  const data = req.body as Record<string, unknown>;
  const channel = data.channel as string | undefined;
  const text = data.text as string | undefined;
  const thread_ts = data.thread_ts as string | undefined;

  if (!channel || !text) {
    res.status(400).json({ error: 'channel and text are required' });
    return;
  }

  const payload: Record<string, unknown> = { channel, text };
  if (thread_ts) payload.thread_ts = thread_ts;

  // Anything Slack would split gets sent as section blocks so it stays one message.
  let mode = 'text';
  let blockCount = 0;
  let warning: string | undefined;

  if (text.length > PLAIN_TEXT_LIMIT) {
    const chunks = chunkForBlocks(text);

    if (chunks.length > MAX_BLOCKS) {
      // Past ~139k characters there is no single-message option left.
      warning =
        `text is ${text.length} chars, needing ${chunks.length} blocks (max ${MAX_BLOCKS}); ` +
        'posted as plain text and Slack will split it';
      console.warn('slack-post:', warning);
    } else {
      payload.blocks = chunks.map((chunk) => ({
        type: 'section',
        text: { type: 'mrkdwn', text: chunk },
      }));
      // Shown in notifications and by clients that cannot render blocks.
      payload.text = text.slice(0, 200);
      mode = 'blocks';
      blockCount = chunks.length;
    }
  }

  const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${slackToken}`,
    },
    body: JSON.stringify(payload),
  });

  const slackData = await slackRes.json() as { ok: boolean; ts?: string; error?: string };

  if (!slackData.ok) {
    console.error('Slack post failed:', slackData.error, `(mode=${mode}, chars=${text.length})`);
    res.status(502).json({ error: slackData.error });
    return;
  }

  const result: Record<string, unknown> = { ok: true, ts: slackData.ts, mode };
  if (mode === 'blocks') result.blocks = blockCount;
  if (warning) result.warning = warning;

  res.status(200).json(result);
}
