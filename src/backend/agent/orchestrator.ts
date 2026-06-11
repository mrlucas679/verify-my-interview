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
import { EvidenceAgent } from './agents/evidenceAgent';
import { InvestigatorAgent, InvestigationInput } from './agents/investigatorAgent';
import { ResearchAgent } from './agents/researchAgent';
import { NetworkAgent } from './agents/networkAgent';
import { VerifierAgent } from './agents/verifierAgent';
import { ReporterAgent } from './agents/reporterAgent';
import { deriveSignals, coverage } from '../scorer/signalEngine';
import { scoreStructuredSignals, levelFromScore } from '../scorer/deterministic_scorer';
import { matchGuidance } from '../knowledge/guidance';
import { EntityGraph, NetworkMatch } from '../network/types';

export type StageName = 'evidence' | 'verification' | 'research' | 'network' | 'critic' | 'report';

export interface StageTrace {
  stage: StageName;
  engine: AgentEngine;
  summary: string;
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
}

export interface AnalysisResult {
  report: RiskReport;
  trace: PipelineTrace;
  signals: StructuredSignal[];
  matches: NetworkMatch[];
  graph: EntityGraph;
}

/** Time a stage and wrap its result in a StageTrace. */
async function staged<T>(
  stage: StageName,
  run: () => Promise<T>,
  describe: (result: T) => { engine: AgentEngine; summary: string; findings: Finding[] }
): Promise<{ result: T; trace: StageTrace }> {
  const started = Date.now();
  const result = await run();
  const { engine, summary, findings } = describe(result);
  return {
    result,
    trace: { stage, engine, summary, findings, duration_ms: Date.now() - started },
  };
}

export class AgentOrchestrator {
  static async analyze(evidence: string, caseId: string): Promise<AnalysisResult> {
    console.log(`[Agent] Starting analysis for case ${caseId}`);

    const settings = getFoundrySettings();
    const runner = settings.enabled ? new FoundryRunner(settings) : null;
    const tools = new ToolOrchestrator();
    if (!runner) {
      console.log('[Agent] No Foundry endpoint configured; pipeline runs deterministically.');
    }

    const stages: StageTrace[] = [];

    // 1. EVIDENCE — classify input, extract entities, parse email headers.
    const ev = await staged(
      'evidence',
      () => new EvidenceAgent().run(evidence),
      (r) => ({ engine: r.engine, summary: r.summary, findings: r.findings })
    );
    stages.push(ev.trace);
    const entities = ev.result.entities;

    // 2. VERIFICATION — registry/RDAP/pattern tools, Foundry-planned when available.
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
      () => investigator.run(input),
      (r) => ({
        engine: r.engine,
        summary: `Called ${r.toolsUsed.length} verification tool(s); ${r.conclusion}`,
        findings: r.toolsUsed
          .filter((t) => t.result.success)
          .slice(0, 6)
          .map((t) => ({
            claim: `Verified via ${t.tool}`,
            evidence: JSON.stringify(t.result.data ?? {}).slice(0, 160),
            confidence: 0.85,
            source: t.tool,
          })),
      })
    );
    stages.push(ver.trace);
    const investigation = ver.result;
    const toolsUsed: AgentToolCall[] = [...investigation.toolsUsed];

    // 3. RESEARCH — independent web/OSINT evidence with citations.
    const res = await staged(
      'research',
      () => new ResearchAgent(tools).run(entities, toolsUsed),
      (r) => ({ engine: r.engine, summary: r.summary, findings: r.findings })
    );
    stages.push(res.trace);
    toolsUsed.push(...res.result.toolsUsed);

    // 4. NETWORK — semantic + structural matching against the intelligence graph.
    const networkAgent = new NetworkAgent();
    const net = await staged(
      'network',
      () => networkAgent.run(evidence, entities),
      (r) => ({ engine: r.engine, summary: r.summary, findings: r.findings })
    );
    stages.push(net.trace);
    const { matches, graph } = net.result;

    // Deterministic detection over everything gathered so far.
    const signals = deriveSignals(evidence, entities, toolsUsed, ev.result.headers);
    signals.push(...networkAgent.signals(net.result));
    const cov = coverage(toolsUsed);

    // 5. CRITIC — strike any claim no tool evidence supports.
    const crit = await staged(
      'critic',
      () => new VerifierAgent(runner).run(evidence, investigation),
      (r) => ({
        engine: r.engine,
        summary:
          r.critique ||
          `Reviewed ${signals.length} signal(s); removed ${r.removed_claims.length} unsupported claim(s).`,
        findings: r.removed_claims.map((claim) => ({
          claim: `Removed unsupported claim: "${claim}"`,
          evidence: 'No successful tool result backed this claim',
          confidence: 0.8,
          source: 'critic',
        })),
      })
    );
    stages.push(crit.trace);
    const verified = crit.result;

    // Transparent scoring from the structured signals. With zero signals and
    // no verifiable identifiers in the evidence there is nothing to conclude —
    // never let a confidence nudge turn "no evidence" into reassuring "Low Risk".
    const scored = scoreStructuredSignals(signals, cov);
    const confidence = Math.max(0, Math.min(1, scored.confidence + verified.confidence_adjustment));
    const nothingToVerify =
      entities.companies.length === 0 &&
      entities.emails.length === 0 &&
      entities.domains.length === 0 &&
      entities.urls.length === 0;
    const level: RiskLevel =
      signals.length === 0 && nothingToVerify
        ? 'Inconclusive'
        : levelFromScore(scored.score, confidence);

    const redFlags = signals.filter((s) => s.category === 'red').map((s) => s.label);
    const positives = signals.filter((s) => s.category === 'positive').map((s) => s.label);
    const verifiedFacts = signals
      .filter((s) => s.category === 'positive' && s.evidence.source !== 'text')
      .map((s) => s.evidence.detail);

    // 6. REPORT — user-facing narrative composed from the vetted evidence.
    const reporter = new ReporterAgent(runner);
    const rep = await staged(
      'report',
      () =>
        reporter.run({
          signals: { verified_facts: verifiedFacts, red_flags: redFlags, positive_signals: positives },
          riskLevel: level,
          riskScore: scored.score,
          entities,
        }),
      (r) => ({
        engine: r.engine,
        summary: 'Composed the final risk report from vetted, evidence-backed findings.',
        findings: signals.slice(0, 6).map((s) => ({
          claim: s.label,
          evidence: s.evidence.detail,
          confidence,
          source: s.evidence.source,
        })),
      })
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
      red_flags: redFlags,
      positive_signals: positives,
      missing_evidence: this.deriveMissingEvidence(entities, toolsUsed.length),
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
    };

    console.log(
      `[Agent] Case ${caseId} complete — ${level} (${scored.score}/100), engine: ${trace.engine_mode}, coverage: ${Math.round(cov * 100)}%`
    );

    return { report, trace, signals, matches, graph };
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
