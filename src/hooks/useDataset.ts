import { useEffect, useState } from 'react';
import { config } from '../lib/config';

export type DataSource = 'live' | 'demo';

export interface DatasetState<T> {
  data: T;
  loading: boolean;
  source: DataSource;
  /** Populated when a live fetch failed and we fell back to demo data. */
  error: string | null;
}

/**
 * Returns `fallback` immediately, then (when VITE_USE_LIVE_DATA is on) attempts
 * the live `loader`. Any failure keeps the demo data and surfaces an error,
 * so the UI never ends up empty.
 */
export function useDataset<T>(
  loader: () => Promise<T>,
  fallback: T,
): DatasetState<T> {
  const [state, setState] = useState<DatasetState<T>>({
    data: fallback,
    loading: config.useLiveData,
    source: 'demo',
    error: null,
  });

  useEffect(() => {
    if (!config.useLiveData) return;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    loader()
      .then((data) => {
        if (cancelled) return;
        // Guard against an empty live response masking the demo data.
        const empty = Array.isArray(data) && data.length === 0;
        setState({
          data: empty ? fallback : data,
          loading: false,
          source: empty ? 'demo' : 'live',
          error: empty ? 'Live source returned no records.' : null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          data: fallback,
          loading: false,
          source: 'demo',
          error: err instanceof Error ? err.message : 'Failed to load live data',
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
