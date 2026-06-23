/**
 * POST /api/slack-post
 *
 * Posts a message as the Claude WD bot. Used by the bid runner so replies
 * appear as the bot rather than a personal account.
 *
 * Body: { channel: string, text: string, thread_ts?: string }
 * Auth: X-Runner-Secret header must match RUNNER_SECRET env var.
 */

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
    console.error('Slack post failed:', slackData.error);
    res.status(502).json({ error: slackData.error });
    return;
  }

  res.status(200).json({ ok: true, ts: slackData.ts });
}
