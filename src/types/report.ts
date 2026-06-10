// Report schema type definitions

import { Entities } from './entities';

export type RiskLevel = 'Low Risk' | 'Needs More Verification' | 'Suspicious' | 'Likely Scam' | 'Inconclusive';

export interface RiskReport {
  risk_score: number; // 0-100
  risk_level: RiskLevel;
  confidence: number; // 0.0-1.0
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

/**
 * Official guidance (FTC / FBI IC3 / BBB) cited because the case triggered
 * the signals it covers. `url` always points at the original source.
 */
export interface GuidanceCitation {
  title: string;
  source: string;
  url: string;
  excerpt: string;
  matched_signals: string[];
}

export interface SignalSet {
  company_registry_match?: {
    present: boolean;
    real_domain?: string;
  };
  email_domain_mismatch?: boolean;
  recruiter_domain_age?: {
    days: number;
    red_flag: boolean;
  };
  upfront_payment_request?: boolean;
  dns_records_weak?: boolean;
  url_belongs_to_different_domain?: boolean;
  [key: string]: any;
}

export interface ScoringContext {
  signals: SignalSet;
  entities: Entities;
  tool_results_used: string[];
  verification_coverage: number; // 0.0-1.0
}

/** Proof backing a structured signal. */
export interface SignalEvidence {
  source: string; // tool name, 'entities', or 'text'
  detail: string; // human-readable proof
}

/**
 * An evidence-backed finding emitted by a pipeline stage. Every claim the
 * system makes must be expressible as one of these — no source, no claim.
 */
export interface Finding {
  claim: string;
  evidence: string;
  confidence: number; // 0.0-1.0
  source: string; // tool/subsystem: 'rdap', 'opencorporates', 'serpapi', 'scam_network', 'entity_graph', 'email_headers', 'text', ...
}

/**
 * A structured, evidence-backed signal derived deterministically from real
 * tool results + parsed entities. `points` is the signed contribution to the
 * risk score (positive = riskier, negative = reassuring).
 */
export interface StructuredSignal {
  id: string;
  label: string;
  category: 'red' | 'positive';
  points: number;
  evidence: SignalEvidence;
}
