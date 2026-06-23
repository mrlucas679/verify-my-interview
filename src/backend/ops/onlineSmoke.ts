import { analyzeEvidenceLocal, healthSnapshot, withLogsOnStderr } from '../local/appTools';
import type { LocalAnalyzeResponse } from '../local/appTools';

type SmokeMode = 'local' | 'endpoint';
type SmokeLevel = 'pass' | 'fail';

export interface OnlineSmokeOptions {
  url?: string;
  requireFoundry?: boolean;
  requireTelemetry?: boolean;
  timeoutMs?: number;
}

export interface SmokeCaseResult {
  name: string;
  level: SmokeLevel;
  riskLevel: string;
  riskScore: number;
  engineMode: string;
  multiPassStatus: string;
  detail: string;
}

export interface OnlineSmokeReport {
  ok: boolean;
  mode: SmokeMode;
  target: string;
  generatedAt: string;
  health: unknown;
  cases: SmokeCaseResult[];
}

interface SmokeCase {
  name: string;
  evidence: string;
  minimumScore?: number;
}

const SMOKE_CASES: readonly SmokeCase[] = [
  {
    name: 'upfront-fee-job-scam',
    evidence:
      'Recruiter says I have the job but must urgently pay a $250 refundable training fee by Bitcoin before the interview can continue.',
    minimumScore: 50,
  },
  {
    name: 'clean-interview-invite',
    evidence:
      'Hello, your interview with Contoso is scheduled for Tuesday at 10:00. No payment is required. Join using the Teams link from careers.contoso.com.',
  },
  {
    name: 'spoken-scam-report',
    evidence:
      'I wanted to report this. The company name is Fake Identity and they asked me to pay R6 000 for training before they would send a contract.',
    minimumScore: 40,
  },
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAnalysisResponse(value: unknown): value is LocalAnalyzeResponse {
  if (!isObject(value)) return false;
  const report = value.report;
  const trace = value.trace;
  const multiPass = value.multiPass;
  return (
    isObject(report) &&
    typeof report.risk_level === 'string' &&
    typeof report.risk_score === 'number' &&
    isObject(trace) &&
    typeof trace.engine_mode === 'string' &&
    Array.isArray(trace.stages) &&
    isObject(multiPass) &&
    typeof multiPass.status === 'string'
  );
}

function endpointUrl(base: string, pathname: string): string {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(pathname.replace(/^\//, ''), normalized).toString();
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeEndpoint(baseUrl: string, evidence: string, timeoutMs: number): Promise<LocalAnalyzeResponse> {
  const value = await fetchJson(
    endpointUrl(baseUrl, '/analyze'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidence }),
    },
    timeoutMs
  );
  if (!isAnalysisResponse(value)) throw new Error('response did not match /analyze schema');
  return value;
}

async function endpointHealth(baseUrl: string, timeoutMs: number): Promise<unknown> {
  return fetchJson(endpointUrl(baseUrl, '/health'), { method: 'GET' }, timeoutMs);
}

const FOUNDRY_EXPECTED_STAGES = new Set(['critic', 'report']);

function foundryStageProblems(result: LocalAnalyzeResponse): string[] {
  return result.trace.stages
    .filter((stage) => FOUNDRY_EXPECTED_STAGES.has(stage.stage) && stage.engine !== 'foundry')
    .map((stage) => {
      const reason = stage.fallback_reason ? ` (${stage.fallback_reason})` : '';
      return `${stage.stage}=${stage.engine}${reason}`;
    });
}

function smokeEngineLabel(result: LocalAnalyzeResponse, requireFoundry: boolean, foundryOk: boolean): string {
  if (result.trace.engine_mode !== 'mixed') return result.trace.engine_mode;
  if (requireFoundry && foundryOk) return 'foundry-assisted';
  return 'hybrid';
}

function caseResult(
  smokeCase: SmokeCase,
  result: LocalAnalyzeResponse,
  requireFoundry: boolean
): SmokeCaseResult {
  const scoreOk = smokeCase.minimumScore === undefined || result.report.risk_score >= smokeCase.minimumScore;
  const foundryProblems = foundryStageProblems(result);
  const foundryOk = !requireFoundry || foundryProblems.length === 0;
  const schemaOk = result.signals.length >= 0 && result.multiPass.reviews.length > 0;
  const degradedCount = result.trace.degraded_stages?.length ?? 0;
  const degradedDetail = result.trace.degraded_stages
    ?.map((stage) => `${stage.stage}: ${stage.reason}`)
    .join(' | ');
  const level: SmokeLevel = scoreOk && foundryOk && schemaOk ? 'pass' : 'fail';
  const detailParts = [
    scoreOk ? 'score check passed' : `score below ${smokeCase.minimumScore}`,
    foundryOk ? 'engine check passed (Foundry reasoning active)' : `Foundry stage check failed: ${foundryProblems.join(', ')}`,
    degradedCount === 0 ? 'no degraded stages' : `${degradedCount} degraded stage(s): ${degradedDetail}`,
  ];
  return {
    name: smokeCase.name,
    level,
    riskLevel: result.report.risk_level,
    riskScore: result.report.risk_score,
    engineMode: smokeEngineLabel(result, requireFoundry, foundryOk),
    multiPassStatus: result.multiPass.status,
    detail: detailParts.join('; '),
  };
}

function telemetrySatisfied(health: unknown, requireTelemetry: boolean): boolean {
  if (!requireTelemetry) return true;
  if (!isObject(health)) return false;
  const subsystems = health.subsystems;
  return isObject(subsystems) && subsystems.azure_monitor === true;
}

export async function runOnlineSmoke(options: OnlineSmokeOptions = {}): Promise<OnlineSmokeReport> {
  const timeoutMs = options.timeoutMs ?? 75_000;
  const baseUrl = options.url?.trim();
  const mode: SmokeMode = baseUrl ? 'endpoint' : 'local';
  const health = baseUrl ? await endpointHealth(baseUrl, timeoutMs) : healthSnapshot();
  const cases: SmokeCaseResult[] = [];

  for (const smokeCase of SMOKE_CASES) {
    try {
      const result = baseUrl
        ? await analyzeEndpoint(baseUrl, smokeCase.evidence, timeoutMs)
        : await withLogsOnStderr(() => analyzeEvidenceLocal(smokeCase.evidence, `online-${smokeCase.name}`));
      cases.push(caseResult(smokeCase, result, Boolean(options.requireFoundry)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cases.push({
        name: smokeCase.name,
        level: 'fail',
        riskLevel: 'ERROR',
        riskScore: -1,
        engineMode: 'ERROR',
        multiPassStatus: 'ERROR',
        detail: message,
      });
    }
  }

  const telemetryOk = telemetrySatisfied(health, Boolean(options.requireTelemetry));
  if (!telemetryOk) {
    cases.push({
      name: 'azure-monitor-required',
      level: 'fail',
      riskLevel: 'N/A',
      riskScore: -1,
      engineMode: 'N/A',
      multiPassStatus: 'N/A',
      detail: 'Azure Monitor telemetry was required but health did not report it configured',
    });
  }

  return {
    ok: cases.every((item) => item.level === 'pass'),
    mode,
    target: baseUrl ?? 'local-pipeline',
    generatedAt: new Date().toISOString(),
    health,
    cases,
  };
}

export function formatOnlineSmoke(report: OnlineSmokeReport): string {
  const lines = [`Online smoke — ${report.mode} (${report.target}) — ${report.generatedAt}`];
  for (const item of report.cases) {
    lines.push(
      `${item.level.toUpperCase().padEnd(4)} ${item.name} — ${item.riskLevel} ${item.riskScore}/100, ${item.engineMode}, ${item.multiPassStatus}; ${item.detail}`
    );
  }
  lines.push(report.ok ? 'READY' : 'NOT READY');
  return `${lines.join('\n')}\n`;
}
