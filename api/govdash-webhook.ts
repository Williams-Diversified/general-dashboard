import crypto from 'node:crypto';

/**
 * Serverless endpoint: POST /api/govdash-webhook
 *
 * Receives GovDash events via Svix. Verifies the signature, logs the event,
 * and handles v1.opportunity.create to kick off the bid workflow.
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

  const event = req.body as { type?: string; data?: Record<string, unknown> };
  console.log(`GovDash event received: ${event.type}`);

  if (event.type === 'v1.opportunity.create' || event.type === 'v1.opportunity.update') {
    const data = event.data ?? {};
    const solicitationNumber = data.solicitationNumber as string | undefined;
    const name = data.name as string | undefined;
    const naicsCode = data.naicsCode as string | undefined;
    const dueDate = data.dueDate as string | undefined;
    const setAside = (data.setAside as { value?: string } | undefined)?.value;
    const placeOfPerformance = data.placeOfPerformance as { city?: string; state?: string } | undefined;
    const samUrl = (data.source as { url?: string } | undefined)?.url;

    console.log('GovDash opportunity event:', {
      type: event.type,
      name,
      solicitationNumber,
      naicsCode,
      dueDate,
    });

    // Post to #bids so the Claude runner and team can see new pipeline items
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      const dueDateFormatted = dueDate
        ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
        : 'TBD';

      const location = placeOfPerformance
        ? `${placeOfPerformance.city ?? ''}, ${placeOfPerformance.state ?? ''}`.trim().replace(/^,\s*/, '')
        : 'Unknown';

      const message = [
        `*New pipeline opportunity${event.type === 'v1.opportunity.update' ? ' (updated)' : ''}:* ${name ?? 'Unnamed'}`,
        solicitationNumber ? `Solicitation: \`${solicitationNumber}\`` : null,
        naicsCode ? `NAICS: ${naicsCode}` : null,
        setAside ? `Set-aside: ${setAside}` : null,
        `Location: ${location}`,
        `Due: ${dueDateFormatted}`,
        samUrl ? `SAM.gov: ${samUrl}` : null,
      ].filter(Boolean).join('\n');

      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${slackToken}`,
        },
        body: JSON.stringify({ channel: '#bids', text: message }),
      });
    } else {
      console.warn('SLACK_BOT_TOKEN not set — skipping #bids notification');
    }
  }

  res.status(200).json({ received: true });
}
