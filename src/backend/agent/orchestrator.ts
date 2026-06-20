// Multi-agent investigation orchestrator.
//
// Six specialist stages, each with its own trace entry (engine, findings,
// duration): Evidence → Verification → Research → Network → Critic → Report.
// Foundry drives the reasoning stages when configured; every stage has a
// deterministic fallback so the system is always demoable. The risk score is
// always computed by the deterministic signal engine + scorer — agents gather
// and vet evidence, they never set the score.

import { RiskReport, RiskLevel, StructuredSignal, Finding } from '../../types/report';
import { Entities } from '../../types/entities';
import { ToolOrchestrator } from '../tools';
import { FoundryRunner, getFoundrySettings } from './foundryRunner';
import { AgentEngine, AgentToolCall } from './types';
import { summarizeToolResult } from './humanize';
import { EvidenceAgent } from './agents/evidenceAgent';
import { InvestigatorAgent, InvestigationInput } from './agents/investigatorAgent';
import { ResearchAgent } from './agents/researchAgent';
import { NetworkAgent } from './agents/networkAgent';
import { VerifierAgent } from './agents/verifierAgent';
import { ReporterAgent } from './agents/reporterAgent';
import { deriveSignals, coverage } from '../scorer/signalEngine';
import { scoreStructuredSignals, levelFromScore } from '../scorer/deterministic_scorer';
import { matchGuidance } from '../knowledge/guidance';
import { knowledgeBaseEnabled, retrieveGrounding } from '../network/knowledgeBase';
import { expandShortenedUrls, urlUnwrapEnabled } from '../research/urlUnwrap';
import { EntityGraph, NetworkMatch } from '../network/types';
import { MultiPassResult, runMultiPassAdjudication } from './multiPass';
import { analysisResultAttributes, withTelemetrySpan } from '../observability/telemetry';
import { logger } from '../observability/logger';

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
  coverage: number;
  stages: StageTrace[];
  tool_calls: Array<{ tool: string; success: boolean }>;
  investigator_reasoning: string;
  critique: string;
  removed_claims: string[];
  degraded_stages: Array<{ stage: StageName; reason: string }>;
}

export interface AnalysisResult {
  report: RiskReport;
  trace: PipelineTrace;
  signals: StructuredSignal[];
  matches: NetworkMatch[];
  graph: EntityGraph;
  multiPass: MultiPassResult;
}

export interface AnalysisOptions {
  signal?: AbortSignal;
}

export class AnalysisAbortedError extends Error {
  constructor(reason?: string) {
    super(reason || 'Analysis aborted');
    this.name = 'AnalysisAbortedError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new AnalysisAbortedError(typeof reason === 'string' ? reason : undefined);
}

/** Time a stage and wrap its result in a StageTrace. */
async function staged<T>(
  stage: StageName,
  run: () => Promise<T>,
  describe: (result: T) => {
    engine: AgentEngine;
    summary: string;
    findings: Finding[];
    fallback_reason?: string;
  },
  signal?: AbortSignal
): Promise<{ result: T; trace: StageTrace }> {
  throwIfAborted(signal);
  const started = Date.now();
  const result = await run();
  throwIfAborted(signal);
  const { engine, summary, findings, fallback_reason } = describe(result);
  return {
    result,
    trace: {
      stage,
      engine,
      summary,
      fallback_reason,
      findings,
      duration_ms: Date.now() - started,
    },
  };
}

function clampConfidence(value: number, cap = 0.95): number {
  return Math.max(0, Math.min(cap, value));
}

/**
 * Confidence = how much we should trust the verdict, derived from AGREEMENT and
 * evidence SUFFICIENCY (not the risk band). Corroboration raises it; struck
 * claims, conflicting red/green evidence, resemblance-only matches, open evidence
 * gaps, and thin tool coverage lower it. A case with no signals can fall into the
 * < 0.3 "too sparse to band normally" regime; any case with real signals keeps at
 * least 0.3 so its score-driven band is stable. Never claims certainty (≤ 0.95).
 */
function calibratedConfidence(
  baseConfidence: number,
  criticAdjustment: number,
  signals: StructuredSignal[],
  removedClaimCount: number,
  coverage: number,
  missingEvidenceCount: number
): number {
  const hasRed = signals.some((s) => s.category === 'red');
  const hasPositive = signals.some((s) => s.category === 'positive');
  const semanticOnly = signals.length > 0 && signals.every((s) => s.id === 'network_match');

  // Agreement.
  let adjustment = Math.max(-0.4, Math.min(0.15, criticAdjustment));
  if (removedClaimCount > 0) adjustment -= Math.min(0.25, removedClaimCount * 0.08);
  if (hasRed && hasPositive) adjustment -= 0.12; // risk and reassurance disagree
  if (semanticOnly) adjustment -= 0.2; // resemblance with no hard signal
  if (signals.length === 0) adjustment -= 0.15;

  // Sufficiency — what "Needs More Verification" actually measures: unresolved
  // evidence gaps and thin external coverage cap how firm any verdict can be.
  if (missingEvidenceCount > 0) adjustment -= Math.min(0.2, missingEvidenceCount * 0.08);
  if (coverage < 0.34) adjustment -= 0.08;

  const cap = hasRed && hasPositive ? 0.85 : semanticOnly ? 0.6 : 0.95;
  const c = clampConfidence(baseConfidence + adjustment, cap);
  return signals.length > 0 ? Math.max(0.3, c) : c;
}

function toolDisplayName(tool: string): string {
  switch (tool) {
    case 'lookup_company_registry':
      return 'company registry';
    case 'lookup_domain_rdap':
      return 'domain and email records';
    case 'lookup_phone_intel':
      return 'phone reputation';
    case 'detect_scam_patterns':
      return 'message pattern check';
    case 'research_company_web':
      return 'public web search';
    default:
      return tool.replace(/_/g, ' ');
  }
}

export class AgentOrchestrator {
  static async analyze(
    evidence: string,
    caseId: string,
    options: AnalysisOptions = {}
  ): Promise<AnalysisResult> {
    return withTelemetrySpan('vmi.analysis', { 'vmi.case_id': caseId }, async (span) => {
      const result = await AgentOrchestrator.analyzeInternal(evidence, caseId, options);
      span.setAttributes(analysisResultAttributes(result));
      return result;
    });
  }

  private static async analyzeInternal(
    evidence: string,
    caseId: string,
    options: AnalysisOptions
  ): Promise<AnalysisResult> {
    const { signal } = options;
    throwIfAborted(signal);
    logger.info(`[Agent] Starting analysis for case ${caseId}`);

    const settings = getFoundrySettings();
    const runner = settings.enabled ? new FoundryRunner(settings) : null;
    const tools = new ToolOrchestrator();
    if (!runner) {
      logger.info('[Agent] No Foundry endpoint configured; pipeline runs deterministically.');
    }

    const stages: StageTrace[] = [];

    // 1. EVIDENCE — classify input, extract entities, parse email headers.
    const ev = await staged(
      'evidence',
      () => new EvidenceAgent().run(evidence),
      (r) => ({ engine: r.engine, summary: r.summary, findings: r.findings }),
      signal
    );
    stages.push(ev.trace);
    const entities = ev.result.entities;
    throwIfAborted(signal);

    // Resolve shortened "apply here" links to their real destination so the
    // verification tools analyse the true domain (key-gated; no-op offline).
    if (urlUnwrapEnabled()) await expandShortenedUrls(entities, signal);
    throwIfAborted(signal);

    // Foundry IQ grounding: retrieve passages from prior reported scams ONCE and
    // share them across every reasoning stage (Investigator, Critic, Reporter),
    // so the whole pipeline reasons against real precedent — not just the final
    // write-up. Only the Foundry passes consume grounding, so skip the network
    // call entirely when running deterministically. Key-gated + never throws.
    const grounding =
      runner && knowledgeBaseEnabled()
        ? await retrieveGrounding(
            [entities.companies[0], entities.domains[0], evidence].filter(Boolean).join(' ')
          )
        : [];
    throwIfAborted(signal);

    // 2. VERIFICATION — evidence gathering is always deterministic, so every
    // relevant identifier check runs and coverage is complete by construction.
    // When Foundry is configured the Investigator adds a reasoning pass OVER those
    // results (no tool-calling); the scorer reads the tool results, not the prose.
    const investigator = new InvestigatorAgent(runner, tools);
    const input: InvestigationInput = {
      evidence,
      companyName: entities.companies[0],
      emailAddress: entities.emails[0],
      domain: entities.domains[0],
      phone: entities.phones[0],
      senderIp: entities.sender_ip,
    };
    const ver = await staged(
      'verification',
      () => investigator.run(input, grounding, signal),
      (r) => ({
        engine: r.engine,
        fallback_reason: r.fallback_reason,
        summary: `Checked ${r.toolsUsed.length} identifier${r.toolsUsed.length === 1 ? '' : 's'} from the evidence. ${r.conclusion}`,
        findings: r.toolsUsed
          .filter((t) => t.result.success)
          .slice(0, 6)
          .map((t) => ({
            claim: `Checked ${toolDisplayName(t.tool)}`,
            // Plain English for the report; raw JSON stays in the dev trace.
            evidence: summarizeToolResult(t.tool, t.result.data).slice(0, 220),
            confidence: 0.85,
            source: t.tool,
          })),
      }),
      signal
    );
    stages.push(ver.trace);
    const investigation = ver.result;
    const toolsUsed: AgentToolCall[] = [...investigation.toolsUsed];

    // 3. RESEARCH + 4. NETWORK — independent of each other (research reads the
    // already-completed investigator tool calls; network reads evidence/entities
    // + the intelligence graph), so run them concurrently to cut wall-clock time
    // when real web search and vector search are both live. Trace push order is
    // preserved below.
    const networkAgent = new NetworkAgent();
    const [res, net] = await Promise.all([
      staged(
        'research',
        () => new ResearchAgent(tools).run(entities, toolsUsed, signal),
        (r) => ({ engine: r.engine, summary: r.summary, findings: r.findings }),
        signal
      ),
      staged(
        'network',
        () => networkAgent.run(evidence, entities, signal),
        (r) => ({ engine: r.engine, summary: r.summary, findings: r.findings }),
        signal
      ),
    ]);
    stages.push(res.trace);
    toolsUsed.push(...res.result.toolsUsed);
    stages.push(net.trace);
    const { matches, graph } = net.result;

    // Deterministic detection over everything gathered so far.
    const signals = deriveSignals(evidence, entities, toolsUsed, ev.result.headers);
    signals.push(...networkAgent.signals(net.result));
    const cov = coverage(toolsUsed);

    // 5. CRITIC — strike any claim no tool evidence supports.
    const crit = await staged(
      'critic',
      () => new VerifierAgent(runner).run(evidence, investigation, grounding, signal),
      (r) => ({
        engine: r.engine,
        fallback_reason: r.fallback_reason,
        summary:
          r.critique ||
          `Reviewed ${signals.length} signal(s); removed ${r.removed_claims.length} unsupported claim(s).`,
        findings: r.removed_claims.map((claim) => ({
          claim: `Removed unsupported claim: "${claim}"`,
          evidence: 'No successful tool result backed this claim',
          confidence: 0.8,
          source: 'critic',
        })),
      }),
      signal
    );
    stages.push(crit.trace);
    const verified = crit.result;

    // Transparent scoring from the structured signals. With zero signals and
    // no verifiable identifiers in the evidence there is nothing to conclude —
    // never let a confidence nudge turn "no evidence" into reassuring "Low Risk".
    const scored = scoreStructuredSignals(signals, cov);
    const missingEvidence = this.deriveMissingEvidence(entities, toolsUsed.length);
    // Confidence is derived from agreement + evidence sufficiency (coverage,
    // open gaps), so an under-verified verdict reports low confidence by virtue
    // of the gaps themselves — no band-name clamp needed.
    const confidence = calibratedConfidence(
      scored.confidence,
      verified.confidence_adjustment,
      signals,
      verified.removed_claims.length,
      cov,
      missingEvidence.length
    );
    const nothingToVerify =
      entities.companies.length === 0 &&
      entities.emails.length === 0 &&
      entities.domains.length === 0 &&
      entities.urls.length === 0;
    const calibratedLevel = levelFromScore(scored.score, confidence);
    const level: RiskLevel =
      signals.length === 0 && nothingToVerify
        ? 'Inconclusive'
        : calibratedLevel === 'Low Risk' && scored.level !== 'Low Risk'
          ? scored.level
          : calibratedLevel;

    const redSignals = signals.filter((s) => s.category === 'red');
    const redFlags = redSignals.map((s) => s.label);
    const userFacingRedFlags =
      level === 'Low Risk'
        ? []
        : redFlags;
    const positives = signals.filter((s) => s.category === 'positive').map((s) => s.label);
    const verifiedFacts = signals
      .filter((s) => s.category === 'positive' && s.evidence.source !== 'text')
      .map((s) => s.evidence.detail);

    // 6. REPORT — user-facing narrative composed from the vetted evidence. Reuses
    // the grounding retrieved up front (shared with the Investigator and Critic).
    const reporter = new ReporterAgent(runner);
    const rep = await staged(
      'report',
      () =>
        reporter.run({
          signals: { verified_facts: verifiedFacts, red_flags: userFacingRedFlags, positive_signals: positives },
          riskLevel: level,
          riskScore: scored.score,
          entities,
          evidenceType: ev.result.evidenceType,
          grounding,
        }, signal),
      (r) => ({
        engine: r.engine,
        fallback_reason: r.fallback_reason,
        summary: 'Reviewed the supported findings and wrote the final user-facing verdict.',
        findings: signals.slice(0, 6).map((s) => ({
          claim: s.label,
          evidence: s.evidence.detail,
          confidence,
          source: s.evidence.source,
        })),
      }),
      signal
    );
    stages.push(rep.trace);
    const narrative = rep.result;

    const report: RiskReport = {
      risk_score: scored.score,
      risk_level: level,
      confidence,
      case_summary: narrative.case_summary,
      entities,
      verified_facts: verifiedFacts,
      red_flags: userFacingRedFlags,
      positive_signals: positives,
      missing_evidence: missingEvidence,
      recommended_next_steps: narrative.recommended_next_steps,
      tool_results_used: toolsUsed.map((t) => t.tool),
      guidance_citations: matchGuidance(signals),
    };

    const engines = new Set<AgentEngine>(stages.map((s) => s.engine));
    const trace: PipelineTrace = {
      engine_mode: engines.size === 1 ? [...engines][0] : 'mixed',
      coverage: cov,
      stages,
      tool_calls: toolsUsed.map((t) => ({ tool: t.tool, success: t.result.success })),
      investigator_reasoning: investigation.reasoning,
      critique: verified.critique,
      removed_claims: verified.removed_claims,
      degraded_stages: stages
        .filter((stage) => Boolean(stage.fallback_reason))
        .map((stage) => ({ stage: stage.stage, reason: stage.fallback_reason ?? 'unknown' })),
    };

    const multiPass = runMultiPassAdjudication({
      report,
      signals,
      matches,
      graph,
      removedClaims: verified.removed_claims,
      evidenceType: ev.result.evidenceType,
    });

    logger.info(
      `[Agent] Case ${caseId} complete — ${level} (${scored.score}/100), engine: ${trace.engine_mode}, coverage: ${Math.round(cov * 100)}%`
    );

    return { report, trace, signals, matches, graph, multiPass };
  }

  private static deriveMissingEvidence(entities: Entities, toolCount: number): string[] {
    const missing: string[] = [];
    if (entities.companies.length === 0) {
      missing.push('No company name found — provide the hiring company.');
    }
    if (entities.emails.length === 0 && entities.domains.length === 0) {
      missing.push('No recruiter email or domain found — provide the contact address.');
    }
    if (toolCount === 0) {
      missing.push('No verifiable entities were available to check against external sources.');
    }
    return missing;
  }
}
