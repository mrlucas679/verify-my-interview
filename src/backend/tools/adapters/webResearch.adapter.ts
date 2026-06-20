import { ToolResult } from '../../../types/tool_results';
import { researchCompany, webResearchEnabled } from '../../research/webResearch';

export async function webResearchAdapter(input: {
  company?: string;
  role?: string;
  domain?: string;
}, signal?: AbortSignal): Promise<ToolResult> {
  const start = Date.now();
  if (!input.company) {
    return { tool: 'research_company_web', success: false, error: 'company is required', duration: Date.now() - start };
  }
  if (!webResearchEnabled()) {
    return {
      tool: 'research_company_web',
      success: false,
      error: 'web research not configured (no SERPAPI_API_KEY / NEWSAPI_API_KEY / GNEWS_API_KEY)',
      duration: Date.now() - start,
    };
  }
  try {
    const r = await researchCompany(input.company, input.role, input.domain, signal);
    return {
      tool: 'research_company_web',
      success: true,
      data: {
        official_listing_found: r.officialListingFound,
        scam_mentions: r.scamMentions,
        result_count: r.resultCount,
        citations: r.citations,
        top_results: r.topResults,
        official_listing_url: r.officialListingUrl,
        scam_mention_url: r.scamMentionUrl,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      tool: 'research_company_web',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - start,
    };
  }
}
