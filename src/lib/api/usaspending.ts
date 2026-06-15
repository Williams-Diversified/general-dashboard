import { config } from '../config';
import type { AgencySpend, Contract, ContractStatus, MonthlySpend } from '../../data/types';
import { getJson, postJson } from './http';

/** Current federal fiscal year (Oct 1 – Sep 30). */
function currentFiscalYear(now = new Date()): number {
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

function fyRange(fy = currentFiscalYear()): { start: string; end: string } {
  return { start: `${fy - 1}-10-01`, end: `${fy}-09-30` };
}

const CONTRACT_AWARD_TYPES = ['A', 'B', 'C', 'D'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// --- Agency obligations (Overview bar chart) ------------------------------

interface ToptierAgenciesResponse {
  results: { agency_name: string; obligated_amount: number }[];
}

export async function fetchAgencySpending(limit = 6): Promise<AgencySpend[]> {
  const data = await getJson<ToptierAgenciesResponse>(
    `${config.usaSpendingBase}/api/v2/references/toptier_agencies/`,
  );
  return data.results
    .filter((r) => r.obligated_amount > 0)
    .sort((a, b) => b.obligated_amount - a.obligated_amount)
    .slice(0, limit)
    .map((r) => ({ agency: r.agency_name, obligated: r.obligated_amount }));
}

// --- Monthly obligations (Overview line chart) ----------------------------

interface SpendingOverTimeResponse {
  results: {
    time_period: { fiscal_year: string; month?: string };
    aggregated_amount: number;
  }[];
}

export async function fetchMonthlySpend(): Promise<MonthlySpend[]> {
  const { start, end } = fyRange();
  const data = await postJson<SpendingOverTimeResponse>(
    `${config.usaSpendingBase}/api/v2/search/spending_over_time/`,
    {
      group: 'month',
      filters: {
        time_period: [{ start_date: start, end_date: end }],
        award_type_codes: CONTRACT_AWARD_TYPES,
      },
    },
  );
  return data.results.map((r) => {
    const m = Number(r.time_period.month);
    return {
      month: MONTH_NAMES[m - 1] ?? String(m),
      obligated: r.aggregated_amount,
    };
  });
}

// --- Recent contract awards (Contracts page) ------------------------------

interface SpendingByAwardResponse {
  results: Record<string, string | number | null>[];
}

function statusFromDates(start: string, end: string): ContractStatus {
  const now = Date.now();
  if (start && new Date(start).getTime() > now) return 'pending';
  if (end && new Date(end).getTime() < now) return 'completed';
  return 'active';
}

export async function fetchContracts(limit = 10): Promise<Contract[]> {
  const { start, end } = fyRange();
  const data = await postJson<SpendingByAwardResponse>(
    `${config.usaSpendingBase}/api/v2/search/spending_by_award/`,
    {
      filters: {
        time_period: [{ start_date: start, end_date: end }],
        award_type_codes: CONTRACT_AWARD_TYPES,
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Awarding Agency',
        'Award Amount',
        'Start Date',
        'End Date',
        'Description',
      ],
      sort: 'Award Amount',
      order: 'desc',
      page: 1,
      limit,
    },
  );

  return data.results.map((r, i) => {
    const startDate = String(r['Start Date'] ?? '');
    const endDate = String(r['End Date'] ?? '');
    const amount = Number(r['Award Amount'] ?? 0);
    return {
      id: String(r['generated_internal_id'] ?? `award-${i}`),
      awardId: String(r['Award ID'] ?? '—'),
      title: String(r['Description'] || r['Award ID'] || 'Federal award'),
      agency: String(r['Awarding Agency'] ?? 'Unknown agency'),
      awardee: String(r['Recipient Name'] ?? 'Unknown recipient'),
      // USAspending returns a single current award amount; use it for both.
      obligatedAmount: amount,
      totalValue: amount,
      startDate,
      endDate,
      status: statusFromDates(startDate, endDate),
    };
  });
}
