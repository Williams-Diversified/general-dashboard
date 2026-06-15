/**
 * Shared SAM.gov proxy logic, used by both the serverless endpoint
 * (`api/sam.ts`) and the Vite dev middleware (see `vite.config.ts`).
 *
 * It reads the API key from `SAM_API_KEY` (a SERVER-side env var, never
 * exposed to the browser), forwards a safe allowlist of query params to
 * SAM.gov's Opportunities API, and returns the upstream JSON.
 */

const SAM_BASE = process.env.SAM_BASE ?? 'https://api.sam.gov';

/** Query params we allow callers to pass through to SAM.gov. */
const ALLOWED_PARAMS = [
  'limit',
  'offset',
  'postedFrom',
  'postedTo',
  'ptype',
  'ncode',
  'naics',
  'state',
  'setAside',
  'title',
  'q',
];

export interface ProxyResult {
  status: number;
  body: unknown;
}

export async function proxySamSearch(
  query: URLSearchParams,
): Promise<ProxyResult> {
  const key = process.env.SAM_API_KEY;
  if (!key) {
    return {
      status: 500,
      body: { error: 'SAM_API_KEY is not configured on the server.' },
    };
  }

  const params = new URLSearchParams();
  for (const name of ALLOWED_PARAMS) {
    const value = query.get(name);
    if (value !== null) params.set(name, value);
  }
  if (!params.has('limit')) params.set('limit', '25');
  params.set('api_key', key);

  const url = `${SAM_BASE}/opportunities/v2/search?${params.toString()}`;

  try {
    const res = await fetch(url);
    const text = await res.text();
    // SAM.gov may return a non-JSON error page (e.g. a gateway message);
    // surface it cleanly instead of throwing a parse error.
    try {
      return { status: res.status, body: JSON.parse(text) as unknown };
    } catch {
      return {
        status: res.ok ? 502 : res.status,
        body: { error: 'SAM.gov returned a non-JSON response', detail: text.slice(0, 500) },
      };
    }
  } catch (err) {
    return {
      status: 502,
      body: {
        error: 'Failed to reach SAM.gov',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
