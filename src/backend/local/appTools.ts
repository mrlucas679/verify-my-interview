import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { AgentOrchestrator, AnalysisResult } from '../agent/orchestrator';
import { CaseContext, ChatMessage, ConversationalAgent } from '../agent/agents/conversationalAgent';
import { FoundryRunner, getFoundrySettings } from '../agent/foundryRunner';
import { entityGraph } from '../network/entityGraph';
import { scamNetwork } from '../network/scamNetwork';
import { NetworkReport, NodeType, TrustLevel } from '../network/types';
import { extractText, ocrEnabled } from '../ocr/documentIntelligence';
import { speechEnabled, transcribeAudio, TranscriptionError } from '../speech/speechToText';
import { webResearchEnabled } from '../research/webResearch';
import { redactAndCap, redactSensitiveIdentifiers } from '../privacy/redaction';
import { ToolOrchestrator } from '../tools';
import { ToolResult } from '../../types/tool_results';
import { azureMonitorConfigured, azureMonitorStatus, initAzureMonitor } from '../observability/telemetry';
import {
  cosmosEnabled,
  deleteReport,
  deleteUserData,
  getCase,
  getSharedReport,
  getUsage,
  listCases,
  saveCase,
  saveReport,
  saveSharedReport,
  type CaseDoc,
  type UserDoc,
} from '../data/cosmos';
import { getUser, upsertUser } from '../data/cosmos';
import { authEnabled } from '../auth/identity';
import { blobEnabled, deleteEvidence, getEvidence, putEvidence } from '../storage/blob';
import { publishEvent } from '../events/serviceBus';
import { cleanString, cleanStringArray, sniffAudioType, sniffUploadType } from '../http/guard';

export const MAX_LOCAL_EVIDENCE_CHARS = 40_000;

export interface LocalAnalyzeResponse extends AnalysisResult {
  case_id: string;
}

export interface LocalChatResponse {
  reply: string;
  engine: 'foundry' | 'deterministic';
}

export interface HealthSnapshot {
  status: 'ok';
  timestamp: string;
  subsystems: {
    foundry_agents: boolean;
    scam_network_index: boolean;
    entity_graph: true;
    document_ocr: boolean;
    voice_transcription: boolean;
    web_research: boolean;
    azure_monitor: boolean;
    shared_reports: boolean;
    accounts: boolean;
    evidence_storage: boolean;
  };
  observability: ReturnType<typeof azureMonitorStatus>;
}

export interface LocalUploadResponse {
  text: string;
  pages: number;
  fileName: string;
}

export interface LocalTranscriptionResponse {
  text: string;
  durationSec: number;
  locale: string;
}

export interface LocalReportResponse {
  ok: true;
  reportId: string;
  indexed: boolean;
}

export class LocalHttpError extends Error {
  constructor(
    public readonly clientStatus: number,
    message: string
  ) {
    super(message);
    this.name = 'LocalHttpError';
  }
}

const RAW_TOOL_ALLOWLIST = new Set([
  'lookup_company_registry',
  'lookup_domain_rdap',
  'lookup_phone_intel',
  'detect_scam_patterns',
  'research_company_web',
]);

const NODE_TYPES: ReadonlySet<string> = new Set<NodeType>([
  'report',
  'company',
  'domain',
  'email',
  'phone',
  'payment_handle',
  'recruiter_alias',
]);
const TRUST_LEVELS: ReadonlySet<string> = new Set<TrustLevel>([
  'unverified',
  'verified',
  'corroborated',
  'trusted',
]);

const SNIFFED_AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  amr: 'audio/amr',
};

function findProjectRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'verify-my-interview') return dir;
      } catch {
        return null;
      }
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}

const envRoot = findProjectRoot(__dirname) ?? findProjectRoot(process.cwd());
dotenv.config(envRoot ? { path: path.join(envRoot, '.env') } : undefined);
initAzureMonitor();

export async function analyzeEvidenceLocal(
  evidence: string,
  caseId?: string
): Promise<LocalAnalyzeResponse> {
  if (typeof evidence !== 'string' || evidence.trim().length === 0) {
    throw new Error('evidence must be a non-empty string');
  }
  if (evidence.length > MAX_LOCAL_EVIDENCE_CHARS) {
    throw new Error(`evidence exceeds ${MAX_LOCAL_EVIDENCE_CHARS} characters`);
  }
  const { text } = redactSensitiveIdentifiers(evidence);
  const id = caseId ?? randomUUID();
  const result = await AgentOrchestrator.analyze(text, id);
  return { case_id: id, ...result };
}

export async function chatLocal(
  ctx: CaseContext,
  messages: ChatMessage[]
): Promise<LocalChatResponse> {
  if (!ctx || typeof ctx !== 'object') {
    throw new Error('case context is required');
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    throw new Error('messages must contain 1-40 chat turns');
  }

  // The conversational detective uses Foundry whenever it is configured (matches
  // the architecture: the detective is a Foundry agent with a graph_lookup tool).
  // Set VMI_CHAT_FOUNDRY_ENABLED=0 to force the deterministic fallback — e.g. to
  // cap cost/latency — without unsetting the project endpoint the pipeline uses.
  const settings = getFoundrySettings();
  const chatFoundryDisabled = process.env.VMI_CHAT_FOUNDRY_ENABLED === '0';
  const runner = settings.enabled && !chatFoundryDisabled ? new FoundryRunner(settings) : null;
  const agent = new ConversationalAgent(runner, new ToolOrchestrator());
  return agent.run(ctx, messages.slice(-12));
}

export async function uploadDocumentLocal(
  buffer: Buffer,
  originalName = 'upload'
): Promise<LocalUploadResponse> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new LocalHttpError(400, 'file is required');
  }
  if (buffer.length > 8 * 1024 * 1024) {
    throw new LocalHttpError(413, 'File is too large. Limit is 8 MB.');
  }
  if (!sniffUploadType(buffer)) {
    throw new LocalHttpError(
      415,
      'Unsupported file type. Upload a screenshot or document (JPEG, PNG, WebP, TIFF, BMP, HEIC, or PDF).'
    );
  }
  if (!ocrEnabled()) {
    throw new LocalHttpError(503, 'Document OCR is not configured');
  }
  const { text, pages } = await extractText(buffer);
  return {
    text,
    pages,
    fileName: path.basename(originalName || 'upload').slice(0, 80),
  };
}

export async function transcribeAudioLocal(
  buffer: Buffer,
  originalName = 'audio'
): Promise<LocalTranscriptionResponse> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new LocalHttpError(400, 'audio file is required');
  }
  if (buffer.length > 25 * 1024 * 1024) {
    throw new LocalHttpError(413, 'Audio file is too large. Limit is 25 MB.');
  }
  const kind = sniffAudioType(buffer);
  if (!kind) {
    throw new LocalHttpError(
      415,
      'Unsupported audio format. Record or upload WAV, MP3, M4A, OGG, FLAC, WebM, or AMR.'
    );
  }
  if (!speechEnabled()) {
    throw new LocalHttpError(503, 'Voice transcription is not configured');
  }
  try {
    const result = await transcribeAudio(
      buffer,
      SNIFFED_AUDIO_MIME[kind] ?? 'application/octet-stream',
      path.basename(originalName || `audio.${kind}`).slice(0, 80)
    );
    if (!result.text.trim()) {
      throw new LocalHttpError(
        422,
        'No speech could be recognised. Try recording again in a quieter setting.'
      );
    }
    return result;
  } catch (error) {
    if (error instanceof LocalHttpError) throw error;
    if (error instanceof TranscriptionError) {
      throw new LocalHttpError(error.clientStatus, error.message);
    }
    throw error;
  }
}

function apiKeyMatches(candidate: string | undefined): boolean {
  const expected = process.env.VMI_REPORT_API_KEY;
  if (!expected) return true;
  const got = Buffer.from(candidate ?? '');
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function submitReportLocal(
  input: unknown,
  apiKey?: string
): Promise<LocalReportResponse> {
  if (!apiKeyMatches(apiKey)) {
    throw new LocalHttpError(401, 'Invalid or missing API key');
  }
  if (!input || typeof input !== 'object') {
    throw new LocalHttpError(400, 'companyName and description are required');
  }
  const body = input as Record<string, unknown>;
  const companyName = cleanString(body.companyName, 120);
  const rawDescription = typeof body.description === 'string' ? body.description : '';
  if (!companyName || !rawDescription.trim()) {
    throw new LocalHttpError(400, 'companyName and description are required');
  }
  const report: NetworkReport = {
    reportId: `R-${Date.now()}-${randomBytes(3).toString('hex')}`,
    companyName,
    aliases: cleanStringArray(body.aliases, 10, 120),
    scamType: cleanString(body.scamType, 80) || 'User-reported scam',
    description: redactAndCap(rawDescription, 5000),
    domains: cleanStringArray(body.domains, 20, 253),
    emails: cleanStringArray(body.emails, 20, 254),
    phones: cleanStringArray(body.phones, 20, 30),
    paymentHandles: cleanStringArray(body.paymentHandles, 20, 120),
    location: cleanString(body.location, 120) || 'Unknown',
    reportedAt: new Date().toISOString().slice(0, 10),
    sourceType: 'user',
    trustLevel: 'unverified',
  };
  let indexed = false;
  if (scamNetwork.enabled) {
    // Cosmos is the durable system of record; Search is the derived vector index.
    if (cosmosEnabled()) {
      try {
        await saveReport(report);
      } catch {
        /* durable store is best-effort; the Search index still receives the report */
      }
    }
    await scamNetwork.add(report);
    indexed = await scamNetwork.waitForReport(report.reportId);
    await entityGraph.refresh();
  } else {
    await entityGraph.addLocalReport(report); // persists to Cosmos when configured
    indexed = true;
  }
  // Best-effort event for async consumers (reindex/recompute/notify). No-op when
  // Service Bus is unconfigured; never blocks or fails the submission.
  void publishEvent('report.created', { reportId: report.reportId, companyName: report.companyName });
  return { ok: true, reportId: report.reportId, indexed };
}

/**
 * Admin moderation: remove a community report from the durable corpus and refresh
 * the entity graph. AUTHORIZATION (admin role) is enforced at the HTTP boundary
 * (requireAdmin) — this core assumes the caller is already authorized. The derived
 * Search index is reconciled by the report.created/-changed event consumer.
 */
export async function deleteReportLocal(reportId: string): Promise<{ ok: true; deleted: boolean }> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'The durable report store is not configured');
  const id = cleanString(reportId, 80);
  if (!id) throw new LocalHttpError(400, 'A reportId is required');
  const deleted = await deleteReport(id);
  if (scamNetwork.enabled || cosmosEnabled()) {
    await entityGraph.refresh().catch(() => {});
  }
  return { ok: true, deleted };
}

export function healthSnapshot(): HealthSnapshot {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    subsystems: {
      foundry_agents: getFoundrySettings().enabled,
      scam_network_index: scamNetwork.enabled,
      entity_graph: true,
      document_ocr: ocrEnabled(),
      voice_transcription: speechEnabled(),
      web_research: webResearchEnabled(),
      azure_monitor: azureMonitorConfigured(),
      shared_reports: cosmosEnabled(),
      accounts: authEnabled(),
      evidence_storage: blobEnabled(),
    },
    observability: azureMonitorStatus(),
  };
}

// ── Accounts, case history & evidence (signed-in users only) ─────────────────
// All env-gated: with auth/Cosmos/Blob unconfigured these throw a clean 503 or
// no-op, so the stateless anonymous flow is unchanged.

const SNIFFED_UPLOAD_EXT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  pdf: 'pdf',
  tiff: 'tif',
  webp: 'webp',
  bmp: 'bmp',
  heic: 'heic',
};

export interface ProfileResponse {
  user: { id: string; email?: string; name?: string; provider?: string; plan: 'free'; consent: UserDoc['consent'] };
  usage: { period: string; count: number };
}

/** A user's profile + current-period usage. Requires accounts + Cosmos. */
export async function getProfileLocal(userId: string): Promise<ProfileResponse> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Accounts are not configured on this server');
  const [user, usage] = await Promise.all([getUser(userId), getUsage(userId)]);
  if (!user) throw new LocalHttpError(404, 'Account not found');
  return {
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      provider: user.provider,
      plan: 'free',
      consent: user.consent,
    },
    usage,
  };
}

/** Persist a redacted case snapshot for a signed-in user. Best-effort. */
export async function recordCaseLocal(
  userId: string,
  analysis: LocalAnalyzeResponse,
  evidenceIds: string[] = []
): Promise<void> {
  if (!cosmosEnabled()) return;
  await saveCase({
    id: analysis.case_id,
    userId,
    riskLevel: analysis.report.risk_level,
    riskScore: analysis.report.risk_score,
    caseSummary: analysis.report.case_summary,
    evidenceIds,
  });
}

export async function listCasesLocal(userId: string): Promise<CaseDoc[]> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Accounts are not configured on this server');
  return listCases(userId);
}

export async function getCaseLocal(userId: string, caseId: string): Promise<CaseDoc> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Accounts are not configured on this server');
  const found = await getCase(userId, typeof caseId === 'string' ? caseId : '');
  if (!found) throw new LocalHttpError(404, 'Case not found');
  return found;
}

/** Set a user's evidence-storage consent (POPIA explicit consent). */
export async function setConsentLocal(
  userId: string,
  storeEvidence: boolean
): Promise<{ consent: UserDoc['consent'] }> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Accounts are not configured on this server');
  const user = await upsertUser({ id: userId }, { store_evidence: storeEvidence });
  return { consent: user.consent };
}

/**
 * Store an uploaded evidence file for a consented user. Re-sniffs and caps the
 * buffer (never trust caller MIME), returns the evidenceId. 503 when storage off,
 * 403 until the user has explicitly consented to evidence storage (POPIA).
 */
export async function storeEvidenceLocal(userId: string, buffer: Buffer): Promise<{ evidenceId: string }> {
  if (!blobEnabled()) throw new LocalHttpError(503, 'Evidence storage is not configured on this server');
  // POPIA: never persist evidence without the user's explicit, recorded consent.
  if (cosmosEnabled()) {
    const user = await getUser(userId);
    if (!user?.consent?.store_evidence) {
      throw new LocalHttpError(403, 'Enable evidence storage in your privacy settings before uploading files.');
    }
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new LocalHttpError(400, 'file is required');
  const kind = sniffUploadType(buffer) ?? (sniffAudioType(buffer) ? 'audio' : null);
  if (!kind) throw new LocalHttpError(415, 'Unsupported evidence file type');
  const ext = SNIFFED_UPLOAD_EXT[kind] ?? (kind === 'audio' ? 'bin' : 'bin');
  const contentType = kind === 'pdf' ? 'application/pdf' : kind === 'audio' ? 'application/octet-stream' : `image/${kind}`;
  try {
    const evidenceId = await putEvidence(userId, buffer, contentType, ext);
    return { evidenceId };
  } catch (error) {
    if (error instanceof Error && /too large/.test(error.message)) {
      throw new LocalHttpError(413, 'Evidence file too large to store');
    }
    throw error;
  }
}

/** Stream-safe fetch of a user's own evidence file (404 when missing/not owned). */
export async function getEvidenceLocal(
  userId: string,
  evidenceId: string
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!blobEnabled()) throw new LocalHttpError(503, 'Evidence storage is not configured on this server');
  const file = await getEvidence(userId, typeof evidenceId === 'string' ? evidenceId : '');
  if (!file) throw new LocalHttpError(404, 'Evidence not found');
  return file;
}

/**
 * POPIA right to erasure: delete the account, its cases + usage, and any stored
 * evidence blobs. De-identified community reports are intentionally retained.
 */
export async function deleteAccountLocal(userId: string): Promise<{ ok: true }> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Accounts are not configured on this server');
  const { evidenceIds } = await deleteUserData(userId);
  await Promise.all(evidenceIds.map((id) => deleteEvidence(id)));
  return { ok: true };
}

/** Persist a finished (redacted) report result for sharing; returns its id. */
export async function saveSharedReportLocal(
  result: unknown
): Promise<{ id: string; expiresInDays: number }> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Sharing is not configured on this server');
  if (!result || typeof result !== 'object') {
    throw new LocalHttpError(400, 'A report result is required');
  }
  try {
    return await saveSharedReport(result);
  } catch (error) {
    if (error instanceof Error && /too large/.test(error.message)) {
      throw new LocalHttpError(413, 'This report is too large to share');
    }
    throw error;
  }
}

/** Fetch a shared report result by id (404 when missing or expired). */
export async function getSharedReportLocal(id: string): Promise<unknown> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'Sharing is not configured on this server');
  const result = await getSharedReport(typeof id === 'string' ? id : '');
  if (!result) throw new LocalHttpError(404, 'This shared report was not found or has expired');
  return result;
}

export async function networkStatsLocal(): Promise<unknown> {
  if (scamNetwork.enabled) await entityGraph.refresh();
  return entityGraph.stats();
}

export async function networkGraphLocal(params: {
  type?: unknown;
  minTrust?: unknown;
}): Promise<unknown> {
  if (scamNetwork.enabled) await entityGraph.refresh();
  const type =
    typeof params.type === 'string' && NODE_TYPES.has(params.type)
      ? (params.type as NodeType)
      : undefined;
  const minTrust =
    typeof params.minTrust === 'string' && TRUST_LEVELS.has(params.minTrust)
      ? (params.minTrust as TrustLevel)
      : undefined;
  return entityGraph.getGraph({ type, minTrust });
}

export async function graphLookupLocal(identifier: string): Promise<unknown> {
  const trimmed = identifier.trim();
  if (!trimmed) throw new Error('identifier is required');
  if (trimmed.length > 300) throw new Error('identifier is too long');
  if (scamNetwork.enabled) await entityGraph.refresh();
  return entityGraph.lookup(trimmed);
}

export async function executeVerificationToolLocal(
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  if (!RAW_TOOL_ALLOWLIST.has(toolName)) {
    throw new Error(`tool is not allowed: ${toolName}`);
  }
  return new ToolOrchestrator().execute(toolName, input);
}

export async function withLogsOnStderr<T>(work: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    return await work();
  } finally {
    console.log = originalLog;
  }
}
