/**
 * Runtime configuration, sourced from Vite env vars (prefixed VITE_).
 * Copy `.env.example` to `.env.local` and fill these in to enable live data.
 */

export const config = {
  /**
   * Master switch. When false (default), the app always shows bundled demo
   * data and never touches the network. Set VITE_USE_LIVE_DATA=true to fetch.
   */
  useLiveData: import.meta.env.VITE_USE_LIVE_DATA === 'true',

  /** USAspending.gov — free, no key required, CORS-friendly. */
  usaSpendingBase:
    import.meta.env.VITE_USASPENDING_BASE ?? 'https://api.usaspending.gov',

  /**
   * Recommended path: call our own SAM.gov proxy (see `api/sam.ts` and the
   * Vite dev middleware), which injects the API key server-side and sidesteps
   * SAM.gov's lack of CORS headers. Defaults to the bundled proxy route.
   * Set VITE_SAM_PROXY="" to disable the proxy and call SAM.gov directly.
   */
  samProxy: import.meta.env.VITE_SAM_PROXY ?? '/api/sam',

  /**
   * Direct-mode fallback only (no proxy). SAM.gov does not send CORS headers,
   * so a browser usually can't use these — they exist for non-browser use or a
   * CORS-permitting gateway. Get a key at
   * https://open.gsa.gov/api/get-opportunities-public-api/.
   */
  samApiKey: import.meta.env.VITE_SAM_API_KEY ?? '',
  samBase: import.meta.env.VITE_SAM_BASE ?? 'https://api.sam.gov',
} as const;
