import { DomainVerificationService } from '../../../services/legacy/domainVerificationService';
import { ToolResult } from '../../../types/tool_results';
import { externalLookupsDisabled } from '../../config/externalLookups';

const domainService = new DomainVerificationService();

function calculateDaysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const created = new Date(dateStr);
  if (Number.isNaN(created.getTime())) return null;
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

export async function domainLookupAdapter(input: {
  domain: string;
  email?: string;
  senderIp?: string;
}, signal?: AbortSignal): Promise<ToolResult> {
  const startTime = Date.now();

  if (externalLookupsDisabled()) {
    return {
      tool: 'lookup_domain_rdap',
      success: false,
      error: 'domain lookup disabled for offline run',
      duration: Date.now() - startTime,
    };
  }

  try {
    const result = await domainService.checkDomainHealth({
      domain: input.domain,
      email: input.email,
      senderIp: input.senderIp,
    }, signal);

    if (result.error) {
      return {
        tool: 'lookup_domain_rdap',
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
      };
    }

    // Prefer WHOIS creation date; fall back to the reputation provider's domain age.
    const whoisAge = calculateDaysSince(result.whois?.created);
    const ageDays = whoisAge ?? result.emailRep?.domainAgeDays ?? null;

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
          age_days: ageDays,
        },
        is_disposable: result.disposable || false,
        is_free_email: result.isFree ?? null,
        risky_tld: result.riskyTld ?? null,
        // Email-reputation risk verdicts (null when unconfigured).
        address_risk: result.emailRep?.addressRisk ?? null,
        domain_risk: result.emailRep?.domainRisk ?? null,
        mx_valid: result.emailRep?.isMxValid ?? null,
        dmarc_enforced: result.emailRep?.isDmarcEnforced ?? null,
        spf_strict: result.emailRep?.isSpfStrict ?? null,
        breaches: result.emailRep?.totalBreaches ?? null,
        // Company that owns the (application) domain, when enrichment is on.
        org_name: result.company?.companyName ?? null,
        org_founded: result.company?.yearFounded ?? null,
        // Originating-IP intelligence (email Received: header), when available.
        ip_intel: result.ipIntel ?? null,
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
