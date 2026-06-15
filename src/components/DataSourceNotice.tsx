import { config } from '../lib/config';
import type { DataSource } from '../hooks/useDataset';

interface Props {
  source: DataSource;
  error: string | null;
  /** Human label for the live provider, e.g. "USAspending.gov". */
  provider: string;
}

export default function DataSourceNotice({ source, error, provider }: Props) {
  if (source === 'live') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
        Live data from {provider}
      </div>
    );
  }

  // Demo mode: distinguish "live disabled" from "live failed".
  const reason = !config.useLiveData
    ? 'Live data is off — set VITE_USE_LIVE_DATA=true to enable.'
    : error
      ? `Couldn't reach ${provider} (${error}).`
      : `No live records from ${provider}.`;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
      Showing demo data. {reason}
    </div>
  );
}
