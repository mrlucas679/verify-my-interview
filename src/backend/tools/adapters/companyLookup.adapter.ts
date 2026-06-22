import { CompanyVerificationService } from '../../../services/legacy/companyVerification';
import { ToolResult } from '../../../types/tool_results';
import { externalLookupsDisabled } from '../../config/externalLookups';

const companyService = new CompanyVerificationService();

export async function companyLookupAdapter(input: {
  company_name?: string;
  registration_number?: string;
  country?: string;
}, signal?: AbortSignal): Promise<ToolResult> {
  const startTime = Date.now();

  if (externalLookupsDisabled()) {
    return {
      tool: 'lookup_company_registry',
      success: false,
      error: 'company registry lookup disabled for offline run',
      duration: Date.now() - startTime,
    };
  }

  if (!process.env.OPENCORPORATES_API_KEY?.trim()) {
    return {
      tool: 'lookup_company_registry',
      success: false,
      error: 'company registry not configured (OPENCORPORATES_API_KEY missing)',
      duration: Date.now() - startTime,
    };
  }

  try {
    const result = await companyService.verifyCompany({
      name: input.company_name,
      regNum: input.registration_number,
      country: input.country,
    }, signal);

    if (result.error) {
      return {
        tool: 'lookup_company_registry',
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
      };
    }

    return {
      tool: 'lookup_company_registry',
      success: true,
      data: {
        company_name: result.company?.name,
        registration_number: result.company?.regNum,
        country: result.company?.country,
        registered: result.company?.registered,
        status: result.company?.status,
        type: result.company?.type,
        jurisdiction: result.company?.jurisdiction,
        officers: result.company?.officers || [],
        checked: result.checked || false,
        cached: result.cached || false,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: 'lookup_company_registry',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}
