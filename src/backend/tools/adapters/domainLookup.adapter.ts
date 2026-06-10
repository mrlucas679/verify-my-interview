import { DomainVerificationService } from '../../../services/legacy/domainVerificationService';
import { ToolResult } from '../../../types/tool_results';

const domainService = new DomainVerificationService();

function calculateDaysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const created = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

export async function domainLookupAdapter(input: { domain: string }): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const result = await domainService.checkDomainHealth(input.domain);

    if (result.error) {
      return {
        tool: 'lookup_domain_rdap',
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
      };
    }

    return {
      tool: 'lookup_domain_rdap',
      success: true,
      data: {
        domain: input.domain,
        dns_records: result.dns || { MX: [], A: [], AAAA: [] },
        whois_data: {
          created_date: result.whois?.created,
          expiry_date: result.whois?.expiry,
          registrar: result.whois?.registrar,
          age_days: calculateDaysSince(result.whois?.created),
        },
        geolocation: result.geolocation || null,
        is_disposable: result.disposable || false,
        cached: result.cached || false,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: 'lookup_domain_rdap',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}
