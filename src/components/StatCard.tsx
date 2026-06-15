interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  trend?: { value: string; positive: boolean };
}

export default function StatCard({
  label,
  value,
  sublabel,
  trend,
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-navy-800">{value}</span>
        {trend && (
          <span
            className={`text-sm font-medium ${
              trend.positive ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {trend.positive ? '▲' : '▼'} {trend.value}
          </span>
        )}
      </div>
      {sublabel && <p className="mt-1 text-sm text-slate-400">{sublabel}</p>}
    </div>
  );
}
