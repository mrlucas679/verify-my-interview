import { Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { AzureMonitorOpenTelemetryOptions, useAzureMonitor } from '@azure/monitor-opentelemetry';

import type { AnalysisResult } from '../agent/orchestrator';
import { maskForLogs } from '../privacy/redaction';

type TelemetryValue = string | number | boolean;
type TelemetryAttributes = Record<string, TelemetryValue>;

const SERVICE_NAME = 'verify-my-interview';
const MAX_ATTRIBUTE_TEXT = 160;

let azureMonitorInitialized = false;
let azureMonitorFailed = false;

function telemetryDisabled(): boolean {
  return process.env.VMI_TELEMETRY_DISABLED === '1' || process.env.NODE_ENV === 'test';
}

function connectionString(): string {
  return process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim() ?? '';
}

function usableConnectionString(): boolean {
  const value = connectionString();
  if (!value || value.includes('<') || value.includes('>')) return false;
  return /(^|;)InstrumentationKey=/i.test(value);
}

function cleanAttributeValue(value: TelemetryValue): TelemetryValue {
  if (typeof value !== 'string') return value;
  return value.length > MAX_ATTRIBUTE_TEXT ? value.slice(0, MAX_ATTRIBUTE_TEXT) : value;
}

function cleanAttributes(attributes: TelemetryAttributes): TelemetryAttributes {
  const cleaned: TelemetryAttributes = {};
  for (const [key, value] of Object.entries(attributes).slice(0, 40)) {
    cleaned[key] = cleanAttributeValue(value);
  }
  return cleaned;
}

export function azureMonitorConfigured(): boolean {
  return usableConnectionString() && !telemetryDisabled();
}

export function azureMonitorStatus(): {
  configured: boolean;
  initialized: boolean;
  failed: boolean;
} {
  return {
    configured: azureMonitorConfigured(),
    initialized: azureMonitorInitialized,
    failed: azureMonitorFailed,
  };
}

export function initAzureMonitor(): boolean {
  if (azureMonitorInitialized) return true;
  if (!azureMonitorConfigured()) return false;

  try {
    const options: AzureMonitorOpenTelemetryOptions = {
      azureMonitorExporterOptions: {
        connectionString: connectionString(),
      },
      enableTraceBasedSamplingForLogs: true,
    };
    useAzureMonitor(options);
    azureMonitorInitialized = true;
    azureMonitorFailed = false;
    return true;
  } catch (error) {
    azureMonitorFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Telemetry] Azure Monitor initialization failed: ${message}`);
    return false;
  }
}

export async function withTelemetrySpan<T>(
  name: string,
  attributes: TelemetryAttributes,
  operation: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = trace.getTracer(SERVICE_NAME);
  return tracer.startActiveSpan(name, { attributes: cleanAttributes(attributes) }, async (span) => {
    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const captured = new Error(maskForLogs(raw).slice(0, MAX_ATTRIBUTE_TEXT));
      captured.name = error instanceof Error ? error.name : 'Error';
      span.recordException(captured);
      span.setStatus({ code: SpanStatusCode.ERROR, message: captured.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function analysisResultAttributes(result: AnalysisResult): TelemetryAttributes {
  return {
    'vmi.risk_score': result.report.risk_score,
    'vmi.risk_level': result.report.risk_level,
    'vmi.confidence': Number(result.report.confidence.toFixed(3)),
    'vmi.engine_mode': result.trace.engine_mode,
    'vmi.coverage': Number(result.trace.coverage.toFixed(3)),
    'vmi.signal_count': result.signals.length,
    'vmi.red_signal_count': result.signals.filter((signal) => signal.category === 'red').length,
    'vmi.positive_signal_count': result.signals.filter((signal) => signal.category === 'positive')
      .length,
    'vmi.tool_call_count': result.trace.tool_calls.length,
    'vmi.removed_claim_count': result.trace.removed_claims.length,
    'vmi.degraded_stage_count': result.trace.degraded_stages.length,
    'vmi.network_match_count': result.matches.length,
    'vmi.guidance_citation_count': result.report.guidance_citations.length,
    'vmi.multi_pass_status': result.multiPass.status,
    'vmi.multi_pass_outcome': result.multiPass.outcome,
    'vmi.multi_pass_agreement': result.multiPass.agreement,
    'vmi.multi_pass_review_count': result.multiPass.reviews.length,
  };
}
