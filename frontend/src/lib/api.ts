import type { AnalyzeResponse, RiskLevel, TrustLevel } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  signal?: AbortSignal;
}

interface AnalyzeOptions extends RequestOptions {
  evidenceIds?: string[];
}

// ── Auth token injection (pluggable) ─────────────────────────────────────────
// The auth layer registers a browser PKCE/Entra token provider here; until then
// no provider is set and requests go out unauthenticated exactly as today.
// Keeping this indirection means the API client has zero hard dependency on a
// specific auth SDK, so the anonymous flow and offline build are unaffected.
type TokenProvider = () => Promise<string | null> | string | null;
let authTokenProvider: TokenProvider | null = null;

export function setAuthTokenProvider(provider: TokenProvider | null): void {
  authTokenProvider = provider;
}

async function authHeader(): Promise<Record<string, string>> {
  if (!authTokenProvider) return {};
  try {
    const token = await authTokenProvider();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // Token acquisition failed → fall back to anonymous; the server decides.
    return {};
  }
}

const ROUTE_TIMEOUT_MS = {
  account: 20_000,
  chat: 30_000,
  evidence: 45_000,
  upload: 75_000,
  transcribe: 130_000,
  analyze: 90_000,
} as const;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CaseContext {
  evidence: string;
  risk_level: string;
  risk_score: number;
  case_summary: string;
  red_flags: string[];
  matches: Array<{ reportId: string; scamType: string; similarity: number }>;
}

export interface AccountProfile {
  user: {
    id: string;
    email?: string;
    name?: string;
    provider?: string;
    plan: 'free';
    consent: { store_evidence: boolean; at: string };
  };
  usage: { period: string; count: number };
}

export interface ServerCase {
  _id: string;
  userId?: string;
  createdAt: string;
  riskLevel: RiskLevel;
  riskScore: number;
  caseSummary: string;
  evidenceIds: string[];
  result?: AnalyzeResponse;
}

export interface PendingReport {
  _id: string;
  reportId: string;
  companyName: string;
  aliases?: string[];
  scamType: string;
  description: string;
  domains: string[];
  emails: string[];
  phones?: string[];
  paymentHandles?: string[];
  location: string;
  reportedAt: string;
  sourceType: string;
  trustLevel: TrustLevel;
  status: 'pending_review';
  submittedAt: string;
}

export interface ModerateReportResult {
  ok: true;
  reportId: string;
  action: 'approved' | 'rejected';
  indexed: boolean;
}

function timeoutMessage(path: string): string {
  if (path === '/chat') return 'The detective took too long to reply. Please try again.';
  if (path === '/analyze') return 'The investigation took too long. Please try again.';
  if (path === '/upload') return 'Document reading took too long. Try a smaller file.';
  if (path === '/transcribe') return 'Transcription took too long. Try a shorter recording.';
  return 'The request took too long. Please try again.';
}

async function errorFromResponse(res: Response, fallback: string): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown; requestId?: unknown };
    return new ApiError(
      typeof body.error === 'string' && body.error ? body.error : fallback,
      res.status,
      typeof body.code === 'string' ? body.code : undefined,
      typeof body.requestId === 'string' ? body.requestId : undefined
    );
  } catch {
    return new ApiError(fallback, res.status);
  }
}

async function fetchJson<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(await authHeader()) };
    const res = await fetch(path, { ...init, headers, signal: controller.signal });
    if (!res.ok) throw await errorFromResponse(res, `${path} failed (${res.status})`);
    return (await res.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) {
      if (!timedOut) throw new ApiError('Request cancelled.', 0, 'CLIENT_ABORTED');
      throw new ApiError(timeoutMessage(path), 0, 'CLIENT_TIMEOUT');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function chat(
  caseContext: CaseContext,
  messages: ChatMessage[],
  options: RequestOptions = {}
): Promise<{ reply: string; engine: string }> {
  return fetchJson(
    '/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseContext, messages }),
    },
    ROUTE_TIMEOUT_MS.chat,
    options.signal
  );
}

export async function uploadDocument(
  file: File,
  options: RequestOptions = {}
): Promise<{ text: string; pages: number; fileName: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return fetchJson('/upload', { method: 'POST', body: fd }, ROUTE_TIMEOUT_MS.upload, options.signal);
}

export async function transcribeAudio(
  blob: Blob,
  fileName = 'recording.webm',
  options: RequestOptions = {}
): Promise<{ text: string; durationSec: number; locale: string }> {
  const fd = new FormData();
  fd.append('audio', blob, fileName);
  return fetchJson(
    '/transcribe',
    { method: 'POST', body: fd },
    ROUTE_TIMEOUT_MS.transcribe,
    options.signal
  );
}

export async function analyze(
  evidence: string,
  options: AnalyzeOptions = {}
): Promise<AnalyzeResponse> {
  const evidenceIds = options.evidenceIds?.filter(Boolean).slice(0, 20);
  return fetchJson(
    '/analyze',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceIds?.length ? { evidence, evidenceIds } : { evidence }),
    },
    ROUTE_TIMEOUT_MS.analyze,
    options.signal
  );
}

export async function getProfile(options: RequestOptions = {}): Promise<AccountProfile> {
  return fetchJson('/me', { method: 'GET' }, ROUTE_TIMEOUT_MS.account, options.signal);
}

export async function setEvidenceConsent(
  storeEvidence: boolean,
  options: RequestOptions = {}
): Promise<{ consent: AccountProfile['user']['consent'] }> {
  return fetchJson(
    '/me/consent',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_evidence: storeEvidence }),
    },
    ROUTE_TIMEOUT_MS.account,
    options.signal
  );
}

export async function deleteAccount(options: RequestOptions = {}): Promise<{ ok: true }> {
  return fetchJson('/me', { method: 'DELETE' }, ROUTE_TIMEOUT_MS.account, options.signal);
}

export async function listCases(options: RequestOptions = {}): Promise<{ cases: ServerCase[] }> {
  return fetchJson('/cases', { method: 'GET' }, ROUTE_TIMEOUT_MS.account, options.signal);
}

export async function getCase(id: string, options: RequestOptions = {}): Promise<ServerCase> {
  return fetchJson(`/cases/${encodeURIComponent(id)}`, { method: 'GET' }, ROUTE_TIMEOUT_MS.account, options.signal);
}

export async function storeEvidence(file: File, options: RequestOptions = {}): Promise<{ evidenceId: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return fetchJson('/evidence', { method: 'POST', body: fd }, ROUTE_TIMEOUT_MS.evidence, options.signal);
}

/**
 * Save the finished (already redacted) report result so it can be revisited or
 * shared via a link (POST /share). Returns an unguessable id. Stores only the
 * derived report, never the raw evidence; auto-expires per the server's TTL.
 */
export async function shareReport(
  result: AnalyzeResponse,
  options: RequestOptions = {}
): Promise<{ id: string; expiresInDays: number }> {
  return fetchJson(
    '/share',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    },
    20_000,
    options.signal
  );
}

/** Load a previously shared report result by id (GET /shared/:id). */
export async function loadSharedReport(
  id: string,
  options: RequestOptions = {}
): Promise<AnalyzeResponse> {
  const data = await fetchJson<{ result: AnalyzeResponse }>(
    `/shared/${encodeURIComponent(id)}`,
    { method: 'GET' },
    20_000,
    options.signal
  );
  return data.result;
}

export interface ScamReportInput {
  companyName: string;
  description: string;
  domains?: string[];
  emails?: string[];
  phones?: string[];
  location?: string;
}

/** File a scam report (POST /report). Server redacts sensitive identifiers and
 * keeps only scam IOCs that can help future checks. */
export async function submitReport(
  input: ScamReportInput,
  options: RequestOptions = {}
): Promise<{ ok: boolean; reportId: string; indexed: boolean; status: 'pending_review' | 'indexed' }> {
  return fetchJson(
    '/report',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    30_000,
    options.signal
  );
}

export async function listPendingReports(options: RequestOptions = {}): Promise<{ reports: PendingReport[] }> {
  return fetchJson('/reports/pending', { method: 'GET' }, ROUTE_TIMEOUT_MS.account, options.signal);
}

export async function moderateReport(
  reportId: string,
  action: 'approve' | 'reject',
  options: RequestOptions = {}
): Promise<ModerateReportResult> {
  return fetchJson(
    `/reports/${encodeURIComponent(reportId)}/moderate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    },
    ROUTE_TIMEOUT_MS.account,
    options.signal
  );
}
