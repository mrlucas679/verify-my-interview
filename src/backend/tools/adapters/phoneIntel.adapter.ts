import { ToolResult } from '../../../types/tool_results';
import { phoneIntelligence, phoneIntelEnabled } from '../../verification/providers';

/**
 * Look up reputation/line-type intelligence for a recruiter phone number.
 * Targets the WhatsApp/personal-number application pattern common in SA job
 * scams. Returns `success: false` (a clean skip) when ABSTRACT_PHONE_KEY is
 * unset, so the deterministic pipeline and offline evals are unaffected.
 *
 * Note: the provider deliberately discards the registered-owner name (POPIA
 * minimality) — only line type / risk / carrier reach the scorer.
 */
export async function phoneIntelAdapter(input: {
  phone: string;
  country?: string;
}, signal?: AbortSignal): Promise<ToolResult> {
  const startTime = Date.now();

  if (!phoneIntelEnabled()) {
    return {
      tool: 'lookup_phone_intel',
      success: false,
      error: 'phone intelligence not configured (ABSTRACT_PHONE_KEY missing)',
      duration: Date.now() - startTime,
    };
  }

  try {
    const intel = await phoneIntelligence(input.phone, input.country || 'ZA', signal);
    if (!intel) {
      return {
        tool: 'lookup_phone_intel',
        success: false,
        error: 'no intelligence returned for phone number',
        duration: Date.now() - startTime,
      };
    }
    return {
      tool: 'lookup_phone_intel',
      success: true,
      data: {
        is_valid: intel.isValid ?? null,
        line_type: intel.lineType ?? null,
        is_voip: intel.isVoip ?? null,
        carrier: intel.carrier ?? null,
        country: intel.country ?? null,
        risk_level: intel.riskLevel ?? null,
        is_disposable: intel.isDisposable ?? null,
        is_abuse_detected: intel.isAbuseDetected ?? null,
        breaches: intel.totalBreaches ?? null,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: 'lookup_phone_intel',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}
