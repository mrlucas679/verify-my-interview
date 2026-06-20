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

  async run(
    entities: Entities,
    priorToolCalls: AgentToolCall[],
    signal?: AbortSignal
  ): Promise<ResearchAgentResult> {
    const company = entities.companies[0];
    if (!webResearchEnabled()) {
      return {
        engine: 'deterministic',
        toolsUsed: [],
        findings: [],
        summary: 'Public-web research is not configured on this server, so this pass was skipped.',
      };
    }
    if (!company) {
      return {
        engine: 'deterministic',
        toolsUsed: [],
        findings: [],
        summary: 'No company name was found, so there was nothing reliable to search for on the public web.',
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
      }, signal);
      call = { tool: 'research_company_web', input: { company }, result };
    }

    const findings: Finding[] = [];
    const data = call.result.success ? call.result.data : undefined;
    if (data) {
      if (data.official_listing_found ?? data.officialListingFound) {
        findings.push({
          claim: `A public job listing was found for ${company}`,
          evidence: 'Careers or job result found in public search',
          confidence: 0.7,
          source: 'research_company_web',
        });
      }
      if (data.scam_mentions ?? data.scamMentions) {
        findings.push({
          claim: `Public complaints mention "${company}" recruiting`,
          evidence: 'Search results contain scam, fraud, or complaint language for this company',
          confidence: 0.75,
          source: 'research_company_web',
        });
      }
      if (findings.length === 0) {
        findings.push({
          claim: `No public scam reports were found for "${company}" in this pass`,
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
        ? `Searched the public web for "${company}" and found ${findings.length} relevant item${findings.length === 1 ? '' : 's'} with ${
            data?.citations?.length ?? 0
          } citation${(data?.citations?.length ?? 0) === 1 ? '' : 's'}.`
        : `Public-web research could not complete: ${call.result.error ?? 'unknown error'}.`,
    };
  }
}
