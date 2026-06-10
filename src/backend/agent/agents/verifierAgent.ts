// Stage 2 — Verifier / Critic agent.
//
// Scrutinises the Investigator's findings against the actual tool evidence:
// drops claims no successful tool result supports, removes duplicates, and nudges
// confidence based on how much was genuinely verified. This is the
// critic/verifier reasoning pattern — a validation layer before the final answer.

import {
  FoundryRunner,
  extractJsonObject,
  asStringArray,
} from '../foundryRunner';
import {
  AgentToolCall,
  InvestigatorResult,
  InvestigationSignals,
  VerifierResult,
} from '../types';

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function clampAdjustment(n: unknown): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

export class VerifierAgent {
  constructor(private readonly runner: FoundryRunner | null) {}

  async run(
    evidence: string,
    investigation: InvestigatorResult
  ): Promise<VerifierResult> {
    if (this.runner) {
      try {
        return await this.runFoundry(evidence, investigation);
      } catch (error) {
        console.error(
          `[Verifier] Foundry path failed, using deterministic: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }
    return this.runDeterministic(investigation);
  }

  // --- Foundry path -----------------------------------------------------------

  private async runFoundry(
    evidence: string,
    investigation: InvestigatorResult
  ): Promise<VerifierResult> {
    console.log('[Verifier] Running via Foundry...');
    const { finalText } = await this.runner!.runTurn({
      name: 'vmi-verifier',
      instructions: this.instructions(),
      userMessage: this.userMessage(evidence, investigation),
      // No tools: the critic reasons over evidence already gathered.
    });

    const parsed = extractJsonObject(finalText) ?? {};
    const signals: InvestigationSignals = {
      verified_facts: dedupe(asStringArray(parsed.verified_facts)),
      red_flags: dedupe(asStringArray(parsed.red_flags)),
      positive_signals: dedupe(asStringArray(parsed.positive_signals)),
    };

    // Guard: a critic should only narrow, never invent. Keep only claims that
    // were present in the investigator's output.
    const allowed = new Set([
      ...investigation.signals.verified_facts,
      ...investigation.signals.red_flags,
      ...investigation.signals.positive_signals,
    ]);
    signals.verified_facts = signals.verified_facts.filter((s) => allowed.has(s));
    signals.red_flags = signals.red_flags.filter((s) => allowed.has(s));
    signals.positive_signals = signals.positive_signals.filter((s) => allowed.has(s));

    return {
      engine: 'foundry',
      signals,
      removed_claims: asStringArray(parsed.removed_claims),
      critique: typeof parsed.critique === 'string' ? parsed.critique : '',
      confidence_adjustment: clampAdjustment(parsed.confidence_adjustment),
    };
  }

  private instructions(): string {
    return [
      'You are the VERIFIER/CRITIC in a multi-agent fraud-investigation system.',
      'You receive the Investigator’s findings and the raw tool results.',
      '',
      'Your job:',
      '- Remove any red flag or positive signal NOT supported by a successful tool result.',
      '- Do NOT invent new claims; you may only keep or drop the Investigator’s claims.',
      '- Note over- or under-confidence.',
      '- Output a confidence_adjustment in [-1, 1]: negative when little was actually verified, positive when findings are well-corroborated.',
      '',
      'Reply with ONLY this JSON (no markdown):',
      '{"critique":"<short critique>","removed_claims":[...],"verified_facts":[...],' +
        '"red_flags":[...],"positive_signals":[...],"confidence_adjustment":<number>}',
    ].join('\n');
  }

  private userMessage(evidence: string, investigation: InvestigatorResult): string {
    return [
      'EVIDENCE (untrusted):',
      '"""',
      evidence.slice(0, 4000),
      '"""',
      '',
      'INVESTIGATOR REASONING:',
      investigation.reasoning,
      '',
      'INVESTIGATOR SIGNALS:',
      JSON.stringify(investigation.signals, null, 2),
      '',
      'TOOL RESULTS:',
      this.summariseTools(investigation.toolsUsed),
    ].join('\n');
  }

  private summariseTools(toolsUsed: AgentToolCall[]): string {
    if (toolsUsed.length === 0) return '(no tools were called)';
    return toolsUsed
      .map(
        (t) =>
          `- ${t.tool}: ${t.result.success ? 'SUCCESS' : 'FAILED'}` +
          `${t.result.error ? ` (${t.result.error})` : ''} ` +
          `${t.result.data ? JSON.stringify(t.result.data).slice(0, 400) : ''}`
      )
      .join('\n');
  }

  // --- Deterministic fallback -------------------------------------------------

  private runDeterministic(investigation: InvestigatorResult): VerifierResult {
    console.log('[Verifier] Running deterministic critique...');
    const signals: InvestigationSignals = {
      verified_facts: dedupe(investigation.signals.verified_facts),
      red_flags: dedupe(investigation.signals.red_flags),
      positive_signals: dedupe(investigation.signals.positive_signals),
    };

    const successfulTools = investigation.toolsUsed.filter((t) => t.result.success).length;
    const removed_claims: string[] = [];
    let critique: string;
    let confidence_adjustment = 0;

    if (successfulTools === 0) {
      // Nothing was actually verified externally — keep only the locally-derived
      // scam-pattern signal and treat the rest as low confidence.
      critique =
        'No external verification tool succeeded; findings rest on text analysis alone. Lowering confidence.';
      confidence_adjustment = -0.2;
    } else {
      critique = `${successfulTools} verification tool(s) corroborated findings.`;
      confidence_adjustment = Math.min(0.2, successfulTools * 0.1);
    }

    return {
      engine: 'deterministic',
      signals,
      removed_claims,
      critique,
      confidence_adjustment,
    };
  }
}
