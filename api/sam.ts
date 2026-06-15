import { proxySamSearch } from './_samProxy';

/**
 * Serverless endpoint: GET /api/sam?limit=&postedFrom=&postedTo=&ptype=...
 *
 * Deployed automatically by Vercel (any file in `api/` becomes a function).
 * The handler signature is structurally compatible with Vercel/Node, so no
 * platform-specific types are required.
 */

interface ProxyRequest {
  url?: string;
}

interface ProxyResponse {
  status(code: number): ProxyResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(
  req: ProxyRequest,
  res: ProxyResponse,
): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const { status, body } = await proxySamSearch(url.searchParams);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(status).json(body);
}
