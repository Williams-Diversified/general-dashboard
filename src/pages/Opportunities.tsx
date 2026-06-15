import { useMemo, useState } from 'react';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import DataSourceNotice from '../components/DataSourceNotice';
import { opportunities as mockOpportunities } from '../data/mockData';
import type { OpportunityStatus } from '../data/types';
import { useDataset } from '../hooks/useDataset';
import { fetchOpportunities } from '../lib/api/sam';
import { daysUntil, formatCurrency, formatDate } from '../lib/format';

const FILTERS: { label: string; value: 'all' | OpportunityStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Closing Soon', value: 'closing-soon' },
  { label: 'Awarded', value: 'awarded' },
  { label: 'Closed', value: 'closed' },
];

export default function Opportunities() {
  const [filter, setFilter] = useState<'all' | OpportunityStatus>('all');
  const [query, setQuery] = useState('');
  const { data: opportunities, loading, source, error } = useDataset(
    () => fetchOpportunities(50),
    mockOpportunities,
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return opportunities.filter((o) => {
      const matchesFilter = filter === 'all' || o.status === filter;
      const matchesQuery =
        !q ||
        o.title.toLowerCase().includes(q) ||
        o.agency.toLowerCase().includes(q) ||
        o.noticeId.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, opportunities]);

  return (
    <Layout
      title="Opportunities"
      subtitle="Federal solicitations and notices"
    >
      <DataSourceNotice source={source} error={error} provider="SAM.gov" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'bg-navy-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, agency, notice id…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600 sm:w-72"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Agency</th>
              <th className="px-5 py-3">Set-Aside</th>
              <th className="px-5 py-3 text-right">Est. Value</th>
              <th className="px-5 py-3">Due</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((o) => {
              const days = daysUntil(o.dueDate);
              return (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-navy-800">{o.title}</p>
                    <p className="text-xs text-slate-400">
                      {o.noticeId} · NAICS {o.naics} · {o.location}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{o.agency}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {o.setAside}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-medium text-slate-700">
                    {formatCurrency(o.estimatedValue)}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {formatDate(o.dueDate)}
                    {days >= 0 &&
                      (o.status === 'open' || o.status === 'closing-soon') && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({days}d)
                        </span>
                      )}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-10 text-center text-slate-400"
                >
                  {loading
                    ? 'Loading opportunities…'
                    : 'No opportunities match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
