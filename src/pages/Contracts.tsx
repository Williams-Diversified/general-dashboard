import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import DataSourceNotice from '../components/DataSourceNotice';
import { contracts as mockContracts } from '../data/mockData';
import { useDataset } from '../hooks/useDataset';
import { fetchContracts } from '../lib/api/usaspending';
import { formatCurrency, formatCurrencyFull, formatDate } from '../lib/format';

export default function Contracts() {
  const { data: contracts, source, error } = useDataset(
    () => fetchContracts(12),
    mockContracts,
  );

  const totalValue = contracts.reduce((s, c) => s + c.totalValue, 0);
  const totalObligated = contracts.reduce((s, c) => s + c.obligatedAmount, 0);
  const activeCount = contracts.filter((c) => c.status === 'active').length;

  return (
    <Layout title="Contracts" subtitle="Awarded contracts and obligations">
      <DataSourceNotice source={source} error={error} provider="USAspending.gov" />

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard
          label="Portfolio Value"
          value={formatCurrency(totalValue)}
          sublabel="Total ceiling, all awards"
        />
        <StatCard
          label="Obligated to Date"
          value={formatCurrency(totalObligated)}
          sublabel={`${Math.round((totalObligated / totalValue) * 100)}% of ceiling`}
        />
        <StatCard
          label="Active Contracts"
          value={String(activeCount)}
          sublabel={`of ${contracts.length} total`}
        />
      </div>

      <div className="space-y-4">
        {contracts.map((c) => {
          const pct = Math.min(
            100,
            Math.round((c.obligatedAmount / c.totalValue) * 100),
          );
          return (
            <div
              key={c.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-navy-800">{c.title}</h3>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {c.awardee} · {c.agency}
                  </p>
                  <p className="text-xs text-slate-400">
                    Award {c.awardId} · {formatDate(c.startDate)} –{' '}
                    {formatDate(c.endDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-navy-800">
                    {formatCurrencyFull(c.totalValue)}
                  </p>
                  <p className="text-xs text-slate-400">total ceiling</p>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>Obligated {formatCurrencyFull(c.obligatedAmount)}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-navy-600"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
