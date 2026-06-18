export type RiskLevel =
  | 'Low Risk'
  | 'Needs More Verification'
  | 'Suspicious'
  | 'Likely Scam'
  | 'Inconclusive';

export type AgentEngine = 'foundry' | 'deterministic';

export interface Entities {
  companies: string[];
  people: string[];
  emails: string[];
  domains: string[];
  urls: string[];
  phones: string[];
  money_requests: string[];
  job_titles: string[];
  reply_to?: string;
  sender_ip?: string;
}

export interface RiskReport {
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  case_summary: string;
  entities: Entities;
  verified_facts: string[];
  red_flags: string[];
  positive_signals: string[];
  missing_evidence: string[];
  recommended_next_steps: string[];
  tool_results_used: string[];
  guidance_citations: GuidanceCitation[];
}

/** Official guidance (FTC / FBI IC3 / BBB) matched to triggered signals. */
export interface GuidanceCitation {
  title: string;
  source: string;
  url: string;
  excerpt: string;
  matched_signals: string[];
}

/** An evidence-backed claim emitted by a pipeline stage. */
export interface Finding {
  claim: string;
  evidence: string;
  confidence: number;
  source: string;
}

export type StageName = 'evidence' | 'verification' | 'research' | 'network' | 'critic' | 'report';

export interface StageTrace {
  stage: StageName;
  engine: AgentEngine;
  summary: string;
  fallback_reason?: string;
  duration_ms: number;
  findings: Finding[];
}

export interface PipelineTrace {
  engine_mode: 'foundry' | 'deterministic' | 'mixed';
  coverage?: number;
  stages: StageTrace[];
  tool_calls: Array<{ tool: string; success: boolean }>;
  investigator_reasoning: string;
  critique: string;
  removed_claims: string[];
  degraded_stages?: Array<{ stage: StageName; reason: string }>;
}

export interface SignalEvidence {
  source: string;
  detail: string;
}

export interface StructuredSignal {
  id: string;
  label: string;
  category: 'red' | 'positive';
  points: number;
  evidence: SignalEvidence;
}

export type TrustLevel = 'unverified' | 'verified' | 'corroborated' | 'trusted';

export interface NetworkMatch {
  reportId: string;
  companyName: string;
  scamType: string;
  description: string;
  location: string;
  reportedAt: string;
  similarity: number;
  reasons: string[];
  trustLevel?: TrustLevel;
}

// --- Linked evidence payload ------------------------------------------------

export type NodeType =
  | 'report'
  | 'company'
  | 'domain'
  | 'email'
  | 'phone'
  | 'payment_handle'
  | 'recruiter_alias';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  trust?: TrustLevel;
  reportCount: number;
  firstSeen: string;
  lastSeen: string;
  scamType?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type:
    | 'uses_domain'
    | 'uses_email'
    | 'uses_phone'
    | 'requests_payment'
    | 'impersonates'
    | 'alias_of';
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

export interface AnalyzeResponse {
  case_id: string;
  report: RiskReport;
  trace: PipelineTrace;
  signals: StructuredSignal[];
  matches: NetworkMatch[];
  graph: EntityGraph;
  multiPass?: MultiPassResult;
}

export type MultiPassOutcome =
  | 'Verified Legitimate'
  | 'Likely Legitimate'
  | 'Insufficient Evidence'
  | 'Requires Human Review'
  | 'Suspicious'
  | 'High Risk Scam Indicators';

export interface MultiPassReview {
  pass: 'base_pipeline' | 'blind_verification' | 'skeptic_red_team';
  conclusion: string;
  support: string[];
  challenges: string[];
}

export interface MultiPassResult {
  status: 'single_pass_sufficient' | 'escalated';
  reason: string;
  outcome: MultiPassOutcome;
  agreement: 'high' | 'medium' | 'low';
  uncertainty: string[];
  reviews: MultiPassReview[];
}
