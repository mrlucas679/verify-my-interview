// Stage 3 — Research agent (web/OSINT).
//
// Finds independent, citable evidence on the public web: an official careers
// listing corroborates the offer; scam/fraud complaints contradict it. Reuses
// the investigator's research call when the Foundry agent already made one;
// otherwise executes the tool directly. Every finding carries a citation.

import { ToolOrchestrator } from '../../tools';
import { Entities } from '../../../types/entities';
import { Finding } from '../../../types/report';
import { webResearchEnabled } from '../../research/webResearch';
import { AgentToolCall, ResearchAgentResult } from '../types';

export class ResearchAgent {
  constructor(private readonly tools: ToolOrchestrator) {}

  async run(entities: Entities, priorToolCalls: AgentToolCall[]): Promise<ResearchAgentResult> {
    const company = entities.companies[0];
    if (!webResearchEnabled()) {
      return {
        engine: 'deterministic',
        toolsUsed: [],
        findings: [],
        summary: 'Web research disabled (no SERPAPI_API_KEY); skipped OSINT pass.',
      };
    }
    if (!company) {
      return {
        engine: 'deterministic',
        toolsUsed: [],
        findings: [],
        summary: 'No company name extracted; nothing to research.',
      };
    }

    // Reuse the investigator's call when the Foundry agent already researched.
    let call = priorToolCalls.find((t) => t.tool === 'research_company_web' && t.result.success);
    const reused = Boolean(call);
    if (!call) {
      const result = await this.tools.execute('research_company_web', {
        company,
        role: entities.job_titles[0],
        domain: entities.domains[0],
      });
      call = { tool: 'research_company_web', input: { company }, result };
    }

    const findings: Finding[] = [];
    const data = call.result.success ? call.result.data : undefined;
    if (data) {
      const cite = (i = 0) => data.citations?.[i] ?? 'web search';
      if (data.official_listing_found ?? data.officialListingFound) {
        findings.push({
          claim: `An official-looking job listing exists for ${company}`,
          evidence: `Careers/jobs result found in public search`,
          confidence: 0.7,
          source: cite(),
        });
      }
      if (data.scam_mentions ?? data.scamMentions) {
        findings.push({
          claim: `Public scam/fraud complaints mention "${company}" recruiting`,
          evidence: 'Search results contain scam/fraud/complaint language for this company',
          confidence: 0.75,
          source: cite(),
        });
      }
      if (findings.length === 0) {
        findings.push({
          claim: `No public scam reports surfaced for "${company}" in this pass`,
          evidence: `${data.result_count ?? data.resultCount ?? 0} results reviewed`,
          confidence: 0.5,
          source: 'serpapi',
        });
      }
    }

    return {
      engine: reused ? 'foundry' : 'deterministic',
      toolsUsed: reused ? [] : [call],
      findings,
      summary: call.result.success
        ? `Searched the public web for "${company}" (${findings.length} finding(s), ${
            data?.citations?.length ?? 0
          } citation(s)).`
        : `Web research failed: ${call.result.error ?? 'unknown error'}.`,
    };
  }
}
