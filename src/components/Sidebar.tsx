import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Overview', icon: '▱' },
  { to: '/opportunities', label: 'Opportunities', icon: '◎' },
  { to: '/contracts', label: 'Contracts', icon: '▤' },
];

export default function Sidebar() {
  return (
    <aside className="flex w-60 flex-col bg-navy-800 text-slate-100">
      <div className="flex items-center gap-2 px-6 py-5 text-xl font-bold tracking-tight">
        <span className="text-2xl" aria-hidden>
          ★
        </span>
        GovDash
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-navy-600 text-white'
                  : 'text-slate-300 hover:bg-navy-700 hover:text-white'
              }`
            }
          >
            <span aria-hidden className="w-4 text-center">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-6 py-4 text-xs text-slate-400">
        FY2026 · Demo data
      </div>
    </aside>
  );
}
