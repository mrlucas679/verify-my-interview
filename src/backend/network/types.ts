// Scam-intelligence network types.

/** Trust level of a report — resists database poisoning. */
export type TrustLevel = 'unverified' | 'verified' | 'corroborated' | 'trusted';

/** Where a report came from. */
export type ReportSource = 'user' | 'seed' | 'authoritative';

/** A scam report as submitted/seeded (no vector). */
export interface NetworkReport {
  reportId: string;
  companyName: string;
  aliases: string[];
  scamType: string;
  description: string;
  domains: string[];
  emails: string[];
  phones?: string[];
  paymentHandles: string[];
  location: string;
  reportedAt: string; // ISO date
  trustLevel?: TrustLevel;
  sourceType?: ReportSource;
}

/** A match returned when querying the network for a new case. */
export interface NetworkMatch {
  reportId: string;
  companyName: string;
  scamType: string;
  description: string;
  location: string;
  reportedAt: string;
  /** Semantic similarity (0-1) of the new evidence to this prior report. */
  similarity: number;
  /** Human-readable reasons this prior report matched (shared domain, wallet, alias, location). */
  reasons: string[];
  /** Trust level of the matched report (graph-computed). */
  trustLevel?: TrustLevel;
}

// --- Entity graph -----------------------------------------------------------
// Nodes are reports + the hard identifiers they use. Company names never merge
// entities — scammers rotate brands but reuse infrastructure.

export type NodeType =
  | 'report'
  | 'company'
  | 'domain'
  | 'email'
  | 'phone'
  | 'payment_handle'
  | 'recruiter_alias';

export interface GraphNode {
  id: string; // `${type}:${normalizedValue}`
  type: NodeType;
  label: string;
  trust?: TrustLevel; // report nodes only
  reportCount: number; // entity nodes: distinct reports touching this (reports: 1)
  firstSeen: string;
  lastSeen: string;
  scamType?: string; // report nodes only
}

export type EdgeType =
  | 'uses_domain'
  | 'uses_email'
  | 'uses_phone'
  | 'requests_payment'
  | 'impersonates'
  | 'alias_of';

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
}

export interface EntityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
}

export interface NetworkStats {
  reportCount: number;
  byTrust: Record<TrustLevel, number>;
  topScamTypes: Array<{ name: string; count: number }>;
  topDomains: Array<{ name: string; count: number }>;
  topHandles: Array<{ name: string; count: number }>;
  monthlyTrend: Array<{ month: string; count: number }>;
}
