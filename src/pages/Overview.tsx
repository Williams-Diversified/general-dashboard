import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import {
  agencySpend,
  contracts,
  monthlySpend,
  opportunities,
} from '../data/mockData';
import { formatCurrency, formatDate } from '../lib/format';

const BAR_COLORS = ['#1b3a6b', '#2563eb', '#0891b2', '#7c3aed', '#db2777', '#65a30d'];

export default function Overview() {
  const openCount = opportunities.filter(
    (o) => o.status === 'open' || o.status === 'closing-soon',
  ).length;
  const pipelineValue = opportunities
    .filter((o) => o.status === 'open' || o.status === 'closing-soon')
    .reduce((sum, o) => sum + o.estimatedValue, 0);
  const activeContracts = contracts.filter((c) => c.status === 'active');
  const totalObligated = agencySpend.reduce((s, a) => s + a.obligated, 0);

  const closingSoon = [...opportunities]
    .filter((o) => o.status === 'open' || o.status === 'closing-soon')
    .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))
    .slice(0, 4);

  return (
    <Layout
      title="Overview"
      subtitle="Federal contracting activity at a glance"
    >
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open Opportunities"
          value={String(openCount)}
          sublabel="Accepting proposals"
          trend={{ value: '8%', positive: true }}
        />
        <StatCard
          label="Pipeline Value"
          value={formatCurrency(pipelineValue)}
          sublabel="Est. ceiling, open solicitations"
          trend={{ value: '12%', positive: true }}
        />
        <StatCard
          label="Active Contracts"
          value={String(activeContracts.length)}
          sublabel="Currently performing"
        />
        <StatCard
          label="FY26 Obligated"
          value={formatCurrency(totalObligated)}
          sublabel="Across tracked agencies"
          trend={{ value: '3%', positive: false }}
        />
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Monthly Obligations (FY2026)
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlySpend} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis
                tickFormatter={(v) => formatCurrency(v as number)}
                tick={{ fontSize: 12, fill: '#64748b' }}
                width={56}
              />
              <Tooltip
                formatter={(v) => formatCurrency(v as number)}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Line
                type="monotone"
                dataKey="obligated"
                stroke="#1b3a6b"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Obligations by Agency
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={agencySpend}
              layout="vertical"
              margin={{ left: 8, right: 8 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="agency"
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={110}
              />
              <Tooltip
                formatter={(v) => formatCurrency(v as number)}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="obligated" radius={[0, 4, 4, 0]}>
                {agencySpend.map((_, i) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Closing soon */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-700">
            Closing Soon
          </h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {closingSoon.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy-800">
                  {o.title}
                </p>
                <p className="text-xs text-slate-500">
                  {o.agency} · {o.noticeId}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 pl-4">
                <span className="text-sm text-slate-600">
                  Due {formatDate(o.dueDate)}
                </span>
                <StatusBadge status={o.status} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Layout>
  );
}
