export type OpportunityStatus = 'open' | 'closing-soon' | 'closed' | 'awarded';

/** Common set-aside labels; real SAM.gov data may return other free-form values. */
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
  /** A SetAside label for mock data, or any free-form value from SAM.gov. */
  setAside: SetAside | string;
  /** Estimated contract ceiling in USD (0 when SAM.gov does not publish one). */
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
  /** Number of contracts, when known (USAspending agency feed does not provide this). */
  contracts?: number;
}

export interface MonthlySpend {
  month: string; // e.g. "Oct"
  obligated: number; // USD
}
