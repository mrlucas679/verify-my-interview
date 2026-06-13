// Shared types for the multi-agent investigation pipeline.

import { ToolResult } from '../../types/tool_results';
import { Entities } from '../../types/entities';
import { Finding } from '../../types/report';
import { EmailHeaderAnalysis } from '../../utils/emailHeaders';
import { EntityGraph, NetworkMatch } from '../network/types';

/** Which engine produced a given stage's output. */
export type AgentEngine = 'foundry' | 'deterministic';

/** A single tool invocation made on behalf of an agent. */
export interface AgentToolCall {
  tool: string;
  input: any;
  result: ToolResult;
}

/** Evidence-based signals shared across stages. */
export interface InvestigationSignals {
  verified_facts: string[];
  red_flags: string[];
  positive_signals: string[];
}

export function emptySignals(): InvestigationSignals {
  return { verified_facts: [], red_flags: [], positive_signals: [] };
}

/** Output of the Investigator stage. */
export interface InvestigatorResult {
  engine: AgentEngine;
  fallback_reason?: string;
  reasoning: string;
  conclusion: string;
  signals: InvestigationSignals;
  toolsUsed: AgentToolCall[];
}

/** Output of the Verifier/Critic stage. */
export interface VerifierResult {
  engine: AgentEngine;
  fallback_reason?: string;
  /** Signals after removing unsupported claims. */
  signals: InvestigationSignals;
  /** Claims the critic judged unsupported by tool evidence and dropped. */
  removed_claims: string[];
  /** Short critique of the investigation's soundness. */
  critique: string;
  /** -1..+1 nudge applied to confidence based on evidence sufficiency. */
  confidence_adjustment: number;
}

/** Output of the Report-writer stage. */
export interface ReporterResult {
  engine: AgentEngine;
  fallback_reason?: string;
  case_summary: string;
  recommended_next_steps: string[];
  /** Optional citations from a knowledge base (Foundry IQ), added later. */
  citations: string[];
}

/** How the submitted evidence was classified by the Evidence agent. */
export type EvidenceType = 'email' | 'chat_screenshot' | 'url' | 'report' | 'text';

/** Output of the Evidence agent (stage 1). */
export interface EvidenceAgentResult {
  engine: AgentEngine;
  entities: Entities;
  evidenceType: EvidenceType;
  headers: EmailHeaderAnalysis;
  findings: Finding[];
  summary: string;
}

/** Output of the Research agent (web/OSINT). */
export interface ResearchAgentResult {
  engine: AgentEngine;
  toolsUsed: AgentToolCall[];
  findings: Finding[];
  summary: string;
}

/** Output of the Network agent (intelligence-network + entity graph). */
export interface NetworkAgentResult {
  engine: AgentEngine;
  matches: NetworkMatch[];
  graph: EntityGraph;
  findings: Finding[];
  summary: string;
}
