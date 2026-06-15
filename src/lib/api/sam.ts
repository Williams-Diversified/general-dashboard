import { config } from '../config';
import type { Opportunity, OpportunityStatus } from '../../data/types';
import { ApiError, getJson } from './http';
import { daysUntil } from '../format';

/** SAM.gov requires postedFrom/postedTo in MM/dd/yyyy, max one-year span. */
function samDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

interface SamOpportunity {
  noticeId?: string;
  solicitationNumber?: string;
  title?: string;
  fullParentPathName?: string;
  postedDate?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  typeOfSetAsideDescription?: string;
  active?: string;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string };
  };
}

interface SamResponse {
  opportunitiesData?: SamOpportunity[];
}

function statusFor(o: SamOpportunity): OpportunityStatus {
  if (o.active && o.active.toLowerCase() === 'no') return 'closed';
  if (o.responseDeadLine) {
    const days = daysUntil(o.responseDeadLine);
    if (days < 0) return 'closed';
    if (days <= 7) return 'closing-soon';
  }
  return 'open';
}

function locationOf(o: SamOpportunity): string {
  const city = o.placeOfPerformance?.city?.name;
  const state = o.placeOfPerformance?.state?.code;
  return [city, state].filter(Boolean).join(', ') || '—';
}

export async function fetchOpportunities(limit = 25): Promise<Opportunity[]> {
  if (!config.samApiKey) {
    throw new ApiError('VITE_SAM_API_KEY is not set');
  }

  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);

  const params = new URLSearchParams({
    api_key: config.samApiKey,
    limit: String(limit),
    postedFrom: samDate(from),
    postedTo: samDate(to),
    ptype: 'o,p,k', // solicitations, presolicitations, combined synopsis
  });

  const data = await getJson<SamResponse>(
    `${config.samBase}/opportunities/v2/search?${params.toString()}`,
  );

  return (data.opportunitiesData ?? []).map((o, i) => ({
    id: o.noticeId ?? `opp-${i}`,
    noticeId: o.solicitationNumber || o.noticeId || '—',
    title: o.title ?? 'Untitled opportunity',
    agency: o.fullParentPathName?.split('.')[0] ?? 'Unknown agency',
    naics: o.naicsCode ?? '—',
    setAside: o.typeOfSetAsideDescription || 'None',
    estimatedValue: 0, // SAM.gov rarely publishes an estimated ceiling
    postedDate: o.postedDate ?? '',
    dueDate: o.responseDeadLine ?? '',
    status: statusFor(o),
    location: locationOf(o),
  }));
}
