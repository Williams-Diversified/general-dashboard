/** Thrown when a live-data request fails; callers fall back to demo data. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json() as Record<string, unknown>;
        detail = body.error
          ? ` — ${body.error}`
          : body.description
          ? ` — ${body.description}`
          : ` — ${JSON.stringify(body).slice(0, 200)}`;
      } catch {
        // non-JSON error body, ignore
      }
      throw new ApiError(`Request to ${url} failed (${res.status})${detail}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

export function getJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  return request<T>(url, { method: 'GET', headers });
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
