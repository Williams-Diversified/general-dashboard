export type OpportunityStatus = 'open' | 'closing-soon' | 'closed' | 'awarded';

export type SetAside =
  | 'None'
  | 'Small Business'
  | '8(a)'
  | 'WOSB'
  | 'SDVOSB'
  | 'HUBZone';

export interface Opportunity {
  id: string;
  /** SAM.gov-style solicitation/notice id */
  noticeId: string;
  title: string;
  agency: string;
  naics: string;
  setAside: SetAside;
  /** Estimated contract ceiling in USD */
  estimatedValue: number;
  postedDate: string; // ISO date
  dueDate: string; // ISO date
  status: OpportunityStatus;
  location: string;
}

export type ContractStatus = 'active' | 'pending' | 'completed';

export interface Contract {
  id: string;
  /** Federal award id (PIID) */
  awardId: string;
  title: string;
  agency: string;
  awardee: string;
  obligatedAmount: number;
  totalValue: number;
  startDate: string; // ISO date
  endDate: string; // ISO date
  status: ContractStatus;
}

export interface AgencySpend {
  agency: string;
  /** Total obligated this fiscal year, in USD */
  obligated: number;
  contracts: number;
}

export interface MonthlySpend {
  month: string; // e.g. "Oct"
  obligated: number; // USD
}
