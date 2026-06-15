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
   * SAM.gov Opportunities API key (https://open.gsa.gov/api/get-opportunities-public-api/).
   * Required to fetch live opportunities. NOTE: SAM.gov does not send CORS
   * headers, so direct browser calls are usually blocked — point
   * VITE_SAM_BASE at a proxy you control for production use.
   */
  samApiKey: import.meta.env.VITE_SAM_API_KEY ?? '',
  samBase: import.meta.env.VITE_SAM_BASE ?? 'https://api.sam.gov',
} as const;
