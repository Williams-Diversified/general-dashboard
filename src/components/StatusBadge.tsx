import type { ContractStatus, OpportunityStatus } from '../data/types';

type AnyStatus = OpportunityStatus | ContractStatus;

const STYLES: Record<AnyStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-green-100 text-green-800' },
  'closing-soon': {
    label: 'Closing Soon',
    className: 'bg-amber-100 text-amber-800',
  },
  closed: { label: 'Closed', className: 'bg-slate-200 text-slate-700' },
  awarded: { label: 'Awarded', className: 'bg-blue-100 text-blue-800' },
  active: { label: 'Active', className: 'bg-green-100 text-green-800' },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800' },
  completed: { label: 'Completed', className: 'bg-slate-200 text-slate-700' },
};

export default function StatusBadge({ status }: { status: AnyStatus }) {
  const { label, className } = STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
