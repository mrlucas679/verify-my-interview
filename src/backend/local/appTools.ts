import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { AgentOrchestrator, AnalysisResult, PipelineTrace } from '../agent/orchestrator';
import { CaseContext, ChatMessage, ConversationalAgent } from '../agent/agents/conversationalAgent';
import { FoundryRunner, getFoundrySettings } from '../agent/foundryRunner';
import { entityGraph } from '../network/entityGraph';
import { scamNetwork } from '../network/scamNetwork';
import { NetworkReport, NodeType, TrustLevel } from '../network/types';
import { EntityGraph, GraphEdge, GraphNode, NetworkMatch } from '../network/types';
import { extractText, ocrEnabled } from '../ocr/documentIntelligence';
import { speechEnabled, transcribeAudio, TranscriptionError } from '../speech/speechToText';
import { webResearchEnabled } from '../research/webResearch';
import { redactAndCap, redactSensitiveIdentifiers } from '../privacy/redaction';
import { ToolOrchestrator } from '../tools';
import { ToolResult } from '../../types/tool_results';
import { GuidanceCitation, RiskLevel, RiskReport, StructuredSignal } from '../../types/report';
import { azureMonitorConfigured, azureMonitorStatus, initAzureMonitor } from '../observability/telemetry';
import {
  cosmosEnabled,
  deletePendingReport,
  deleteReport,
  deleteUserData,
  getCase,
  getPendingReport,
  getSharedReport,
  getUsage,
  listCases,
  listPendingReports,
  saveCase,
  savePendingReport,
  saveReport,
  saveSharedReport,
  type PendingReportDoc,
  type CaseDoc,
  type UserDoc,
} from '../data/cosmos';
import { getUser, upsertUser } from '../data/cosmos';
import {
  AuthError,
  adminViaEmailAllowlist,
  authEnabled,
  isAdmin,
  verifyToken,
  type Identity,
} from '../auth/identity';
import { blobEnabled, deleteEvidence, getEvidence, putEvidence } from '../storage/blob';
import { publishEvent } from '../events/serviceBus';
import { cleanString, cleanStringArray, sanitizeHttpUrl, sniffAudioType, sniffUploadType } from '../http/guard';

export const MAX_LOCAL_EVIDENCE_CHARS = 40_000;

export interface LocalAnalyzeResponse extends AnalysisResult {
  case_id: string;
}

export interface LocalAnalyzeOptions {
  signal?: AbortSignal;
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

export interface AuthClientConfigResponse {
  enabled: boolean;
  clientId?: string;
  authority?: string;
  scope?: string;
  redirectUri?: string;
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
  status: 'pending_review' | 'indexed';
}

export interface PendingReportsResponse {
  reports: PendingReportDoc[];
}

export interface ModerateReportResponse {
  ok: true;
  reportId: string;
  action: 'approved' | 'rejected';
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
const RISK_LEVELS: ReadonlySet<string> = new Set<RiskLevel>([
  'Low Risk',
  'Needs More Verification',
  'Suspicious',
  'Likely Scam',
  'Inconclusive',
]);
const ENGINE_MODES = new Set(['foundry', 'deterministic', 'mixed']);
const MAX_LOCAL_PENDING_REPORTS = 200;
const localPendingReports = new Map<string, PendingReportDoc>();

const SNIFFED_AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  amr: 'audio/amr',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthority(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/oauth2\/v2\.0$/i, '')
    .replace(/\/v2\.0$/i, '');
}

function safeHttpsOrigin(value: string | undefined): string {
  const raw = cleanEnv(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function cleanRiskLevel(value: unknown): RiskLevel {
  return typeof value === 'string' && RISK_LEVELS.has(value) ? (value as RiskLevel) : 'Inconclusive';
}

function cleanUnitNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function cleanScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function cleanSignedPoints(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0;
}

function cleanSharedText(value: unknown, max: number): string {
  return redactAndCap(cleanString(value, max), max);
}

function cleanGuidance(value: unknown): GuidanceCitation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((item) => {
    const row = isRecord(item) ? item : {};
    return {
      title: cleanSharedText(row.title, 180),
      source: cleanSharedText(row.source, 80),
      url: sanitizeHttpUrl(row.url, 500),
      excerpt: cleanSharedText(row.excerpt, 500),
      matched_signals: cleanStringArray(row.matched_signals, 12, 160),
    };
  }).filter((item) => item.title && item.source && item.url);
}

function cleanRiskReport(value: unknown): RiskReport | null {
  if (!isRecord(value)) return null;
  const rawEntities = isRecord(value.entities) ? value.entities : {};
  return {
    risk_score: cleanScore(value.risk_score),
    risk_level: cleanRiskLevel(value.risk_level),
    confidence: cleanUnitNumber(value.confidence),
    case_summary: cleanSharedText(value.case_summary, 1_500),
    entities: {
      companies: cleanStringArray(rawEntities.companies, 20, 120),
      people: [],
      emails: cleanStringArray(rawEntities.emails, 20, 254),
      domains: cleanStringArray(rawEntities.domains, 20, 253),
      urls: cleanStringArray(rawEntities.urls, 20, 500),
      phones: cleanStringArray(rawEntities.phones, 20, 30),
      money_requests: cleanStringArray(rawEntities.money_requests, 20, 160),
      job_titles: cleanStringArray(rawEntities.job_titles, 20, 120),
      reply_to: cleanString(rawEntities.reply_to, 254) || undefined,
      sender_ip: cleanString(rawEntities.sender_ip, 64) || undefined,
    },
    verified_facts: cleanStringArray(value.verified_facts, 20, 500).map((item) => redactAndCap(item, 500)),
    red_flags: cleanStringArray(value.red_flags, 20, 220).map((item) => redactAndCap(item, 220)),
    positive_signals: cleanStringArray(value.positive_signals, 20, 220).map((item) => redactAndCap(item, 220)),
    missing_evidence: cleanStringArray(value.missing_evidence, 20, 220).map((item) => redactAndCap(item, 220)),
    recommended_next_steps: cleanStringArray(value.recommended_next_steps, 12, 280).map((item) => redactAndCap(item, 280)),
    tool_results_used: cleanStringArray(value.tool_results_used, 20, 80),
    guidance_citations: cleanGuidance(value.guidance_citations),
  };
}

function cleanSignal(value: unknown): StructuredSignal | null {
  if (!isRecord(value)) return null;
  const category = value.category === 'positive' ? 'positive' : value.category === 'red' ? 'red' : null;
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const id = cleanString(value.id, 80);
  const label = cleanSharedText(value.label, 220);
  if (!id || !label || !category) return null;
  return {
    id,
    label,
    category,
    points: cleanSignedPoints(value.points),
    evidence: {
      source: cleanString(evidence.source, 80),
      detail: cleanSharedText(evidence.detail, 500),
    },
  };
}

function cleanNetworkMatch(value: unknown): NetworkMatch | null {
  if (!isRecord(value)) return null;
  const reportId = cleanString(value.reportId, 80);
  if (!reportId) return null;
  const trustLevel = typeof value.trustLevel === 'string' && TRUST_LEVELS.has(value.trustLevel)
    ? (value.trustLevel as TrustLevel)
    : undefined;
  return {
    reportId,
    companyName: cleanSharedText(value.companyName, 120),
    scamType: cleanSharedText(value.scamType, 120),
    description: cleanSharedText(value.description, 800),
    location: cleanSharedText(value.location, 120),
    reportedAt: cleanString(value.reportedAt, 40),
    similarity: cleanUnitNumber(value.similarity),
    reasons: cleanStringArray(value.reasons, 8, 180).map((item) => redactAndCap(item, 180)),
    trustLevel,
  };
}

function cleanGraph(value: unknown): EntityGraph {
  if (!isRecord(value)) return { nodes: [], edges: [], generatedAt: new Date().toISOString() };
  const nodes = Array.isArray(value.nodes) ? value.nodes.slice(0, 120).map((item): GraphNode | null => {
    if (!isRecord(item) || typeof item.type !== 'string' || !NODE_TYPES.has(item.type)) return null;
    const trust = typeof item.trust === 'string' && TRUST_LEVELS.has(item.trust) ? (item.trust as TrustLevel) : undefined;
    return {
      id: cleanString(item.id, 180),
      type: item.type as NodeType,
      label: cleanSharedText(item.label, 180),
      trust,
      reportCount: cleanScore(item.reportCount),
      firstSeen: cleanString(item.firstSeen, 40),
      lastSeen: cleanString(item.lastSeen, 40),
      scamType: cleanSharedText(item.scamType, 120) || undefined,
    };
  }).filter((item): item is GraphNode => !!item && !!item.id && !!item.label) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(value.edges) ? value.edges.slice(0, 160).map((item): GraphEdge | null => {
    if (!isRecord(item)) return null;
    const source = cleanString(item.source, 180);
    const target = cleanString(item.target, 180);
    if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
    return {
      source,
      target,
      type: cleanString(item.type, 40) as GraphEdge['type'],
      weight: cleanScore(item.weight) || 1,
    };
  }).filter((item): item is GraphEdge => !!item) : [];
  return { nodes, edges, generatedAt: cleanString(value.generatedAt, 40) || new Date().toISOString() };
}

function minimalTrace(value: unknown): PipelineTrace {
  const raw = isRecord(value) ? value : {};
  const mode = typeof raw.engine_mode === 'string' && ENGINE_MODES.has(raw.engine_mode)
    ? (raw.engine_mode as PipelineTrace['engine_mode'])
    : 'deterministic';
  return {
    engine_mode: mode,
    coverage: cleanUnitNumber(raw.coverage),
    stages: [],
    tool_calls: [],
    investigator_reasoning: '',
    critique: '',
    removed_claims: [],
    degraded_stages: [],
  };
}

export function sanitizeSharedAnalysisResult(result: unknown): LocalAnalyzeResponse | null {
  if (!isRecord(result)) return null;
  const report = cleanRiskReport(result.report);
  if (!report) return null;
  return {
    case_id: cleanString(result.case_id, 96) || 'shared',
    report,
    trace: minimalTrace(result.trace),
    signals: Array.isArray(result.signals) ? result.signals.map(cleanSignal).filter((item): item is StructuredSignal => !!item).slice(0, 40) : [],
    matches: Array.isArray(result.matches) ? result.matches.map(cleanNetworkMatch).filter((item): item is NetworkMatch => !!item).slice(0, 20) : [],
    graph: cleanGraph(result.graph),
    multiPass: isRecord(result.multiPass)
      ? {
          status: result.multiPass.status === 'escalated' ? 'escalated' : 'single_pass_sufficient',
          reason: cleanSharedText(result.multiPass.reason, 240),
          outcome: cleanSharedText(result.multiPass.outcome, 80) as LocalAnalyzeResponse['multiPass']['outcome'],
          agreement: result.multiPass.agreement === 'low' || result.multiPass.agreement === 'medium' ? result.multiPass.agreement : 'high',
          uncertainty: cleanStringArray(result.multiPass.uncertainty, 8, 180).map((item) => redactAndCap(item, 180)),
          reviews: [],
        }
      : {
          status: 'single_pass_sufficient',
          reason: '',
          outcome: 'Insufficient Evidence',
          agreement: 'medium',
          uncertainty: [],
          reviews: [],
        },
  };
}

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
  caseId?: string,
  options: LocalAnalyzeOptions = {}
): Promise<LocalAnalyzeResponse> {
  if (typeof evidence !== 'string' || evidence.trim().length === 0) {
    throw new Error('evidence must be a non-empty string');
  }
  if (evidence.length > MAX_LOCAL_EVIDENCE_CHARS) {
    throw new Error(`evidence exceeds ${MAX_LOCAL_EVIDENCE_CHARS} characters`);
  }
  const { text } = redactSensitiveIdentifiers(evidence);
  const id = caseId ?? randomUUID();
  const result = await AgentOrchestrator.analyze(text, id, options);
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
  if (!expected) {
    return process.env.NODE_ENV !== 'production' || process.env.VMI_ALLOW_PUBLIC_REPORTS === '1';
  }
  const got = Buffer.from(candidate ?? '');
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

function reportApiKeyConfigured(): boolean {
  return Boolean(process.env.VMI_REPORT_API_KEY);
}

function canAcceptPublicReport(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.VMI_ALLOW_PUBLIC_REPORTS === '1';
}

function trustedReportSubmission(apiKey?: string): boolean {
  return reportApiKeyConfigured() && apiKeyMatches(apiKey);
}

async function indexReviewedReport(report: NetworkReport): Promise<boolean> {
  if (cosmosEnabled()) {
    await saveReport(report);
    await entityGraph.markDirty('report.approved');
  }
  if (scamNetwork.enabled) {
    await scamNetwork.add(report);
    const indexed = await scamNetwork.waitForReport(report.reportId);
    await entityGraph.refresh();
    return indexed;
  }
  await entityGraph.addLocalReport(report);
  return true;
}

function toPendingReport(report: NetworkReport): PendingReportDoc {
  return {
    ...report,
    _id: report.reportId,
    status: 'pending_review',
    submittedAt: new Date().toISOString(),
  };
}

async function queuePendingReport(report: NetworkReport): Promise<void> {
  if (cosmosEnabled()) {
    await savePendingReport(report);
    return;
  }
  if (localPendingReports.size >= MAX_LOCAL_PENDING_REPORTS) {
    const oldest = localPendingReports.keys().next().value;
    if (oldest) localPendingReports.delete(oldest);
  }
  localPendingReports.set(report.reportId, toPendingReport(report));
}

async function pendingReportById(reportId: string): Promise<PendingReportDoc | null> {
  if (cosmosEnabled()) return getPendingReport(reportId);
  return localPendingReports.get(reportId) ?? null;
}

async function removePendingReport(reportId: string): Promise<boolean> {
  if (cosmosEnabled()) return deletePendingReport(reportId);
  return localPendingReports.delete(reportId);
}

export async function submitReportLocal(
  input: unknown,
  apiKey?: string
): Promise<LocalReportResponse> {
  const trustedSubmission = trustedReportSubmission(apiKey);
  if (!trustedSubmission && !canAcceptPublicReport()) {
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
    trustLevel: trustedSubmission ? 'verified' : 'unverified',
  };
  if (!trustedSubmission) {
    await queuePendingReport(report);
    void publishEvent('report.created', {
      reportId: report.reportId,
      companyName: report.companyName,
      status: 'pending_review',
    });
    return { ok: true, reportId: report.reportId, indexed: false, status: 'pending_review' };
  }
  let indexed = false;
  if (scamNetwork.enabled) {
    // Cosmos is the durable system of record; Search is the derived vector index.
    if (cosmosEnabled()) {
      try {
        await saveReport(report);
        await entityGraph.markDirty('report.created');
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
  return { ok: true, reportId: report.reportId, indexed, status: 'indexed' };
}

/** Admin moderation queue: list public reports awaiting review. */
export async function listPendingReportsLocal(): Promise<PendingReportsResponse> {
  if (cosmosEnabled()) return { reports: await listPendingReports() };
  return { reports: [...localPendingReports.values()].slice(0, MAX_LOCAL_PENDING_REPORTS) };
}

/** Admin moderation: approve moves a pending report into the graph; reject drops it. */
export async function moderateReportLocal(
  reportId: string,
  action: 'approve' | 'reject',
  reviewerId?: string
): Promise<ModerateReportResponse> {
  const id = cleanString(reportId, 80);
  if (!id) throw new LocalHttpError(400, 'A reportId is required');
  const pending = await pendingReportById(id);
  if (!pending) throw new LocalHttpError(404, 'Pending report not found');

  if (action === 'reject') {
    await removePendingReport(id);
    void publishEvent('report.created', {
      reportId: id,
      status: 'rejected',
      reviewerId: cleanString(reviewerId, 96),
    });
    return { ok: true, reportId: id, action: 'rejected', indexed: false };
  }

  const approved: NetworkReport = {
    reportId: pending.reportId,
    companyName: pending.companyName,
    aliases: pending.aliases,
    scamType: pending.scamType,
    description: pending.description,
    domains: pending.domains,
    emails: pending.emails,
    phones: pending.phones ?? [],
    paymentHandles: pending.paymentHandles,
    location: pending.location,
    reportedAt: pending.reportedAt,
    sourceType: pending.sourceType,
    trustLevel: 'verified',
  };
  const indexed = await indexReviewedReport(approved);
  await removePendingReport(id);
  void publishEvent('report.created', {
    reportId: id,
    companyName: approved.companyName,
    status: 'approved',
    reviewerId: cleanString(reviewerId, 96),
  });
  return { ok: true, reportId: id, action: 'approved', indexed };
}

/**
 * Admin moderation: remove a community report from the durable corpus and refresh
 * the entity graph. AUTHORIZATION (admin role) is enforced at the HTTP boundary
 * (requireAdmin) — this core assumes the caller is already authorized.
 */
export async function deleteReportLocal(reportId: string): Promise<{ ok: true; deleted: boolean }> {
  if (!cosmosEnabled()) throw new LocalHttpError(503, 'The durable report store is not configured');
  const id = cleanString(reportId, 80);
  if (!id) throw new LocalHttpError(400, 'A reportId is required');
  const deleted = await deleteReport(id);
  await scamNetwork.delete(id).catch(() => false);
  if (scamNetwork.enabled || cosmosEnabled()) {
    if (deleted) await entityGraph.markDirty('report.deleted');
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

export function authClientConfigLocal(requestOrigin?: string): AuthClientConfigResponse {
  const clientId = cleanEnv(process.env.VITE_AUTH_CLIENT_ID || process.env.AUTH_CLIENT_ID);
  const authority = cleanEnv(process.env.VITE_AUTH_AUTHORITY || process.env.AUTH_ISSUER);
  const scope = cleanEnv(process.env.VITE_AUTH_SCOPE);
  const configuredRedirect = cleanEnv(process.env.VITE_AUTH_REDIRECT_URI);
  const origin = safeHttpsOrigin(requestOrigin);
  const redirectUri = configuredRedirect || (origin ? `${origin}/auth/callback` : '');

  if (!authEnabled() || !clientId || !authority || !scope || !redirectUri) {
    return { enabled: false };
  }

  return {
    enabled: true,
    clientId,
    authority: normalizeAuthority(authority),
    scope,
    redirectUri,
  };
}

// ── Accounts, case history & evidence (signed-in users only) ─────────────────
// All env-gated: with auth/Cosmos/Blob unconfigured these throw a clean 503 or
// no-op, so the stateless anonymous flow is unchanged.

export async function verifyBearerTokenLocal(authorization: unknown): Promise<Identity> {
  if (!authEnabled()) throw new LocalHttpError(503, 'Accounts are not enabled on this server.');
  const header = typeof authorization === 'string' ? authorization.trim() : '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new LocalHttpError(401, 'Please sign in to access your account.');
  try {
    const identity = await verifyToken(token);
    if (cosmosEnabled()) {
      void upsertUser({
        id: identity.userId,
        email: identity.email,
        name: identity.name,
        provider: identity.provider,
      }).catch(() => {});
    }
    return identity;
  } catch (error) {
    if (error instanceof AuthError) {
      throw new LocalHttpError(401, 'Your session has expired — please sign in again.');
    }
    throw error;
  }
}

export async function verifyAdminBearerTokenLocal(authorization: unknown): Promise<Identity> {
  const identity = await verifyBearerTokenLocal(authorization);
  if (!isAdmin(identity)) {
    throw new LocalHttpError(403, 'Administrator access is required for this action.');
  }
  if (adminViaEmailAllowlist(identity)) {
    console.warn('[Auth] admin action authorized via AUTH_ADMIN_EMAILS.');
  }
  return identity;
}

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
  const snapshot = sanitizeSharedAnalysisResult(analysis);
  await saveCase({
    id: analysis.case_id,
    userId,
    riskLevel: analysis.report.risk_level,
    riskScore: analysis.report.risk_score,
    caseSummary: analysis.report.case_summary,
    evidenceIds,
    result: snapshot ?? undefined,
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
  if (!cosmosEnabled()) {
    throw new LocalHttpError(503, 'Evidence storage consent is not configured on this server');
  }
  const user = await getUser(userId);
  if (!user?.consent?.store_evidence) {
    throw new LocalHttpError(403, 'Enable evidence storage in your privacy settings before uploading files.');
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
  const sanitized = sanitizeSharedAnalysisResult(result);
  if (!sanitized) {
    throw new LocalHttpError(400, 'A report result is required');
  }
  try {
    return await saveSharedReport(sanitized);
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
  const sanitized = sanitizeSharedAnalysisResult(result);
  if (!sanitized) throw new LocalHttpError(404, 'This shared report was not found or has expired');
  return sanitized;
}

export async function networkStatsLocal(): Promise<unknown> {
  if (scamNetwork.enabled) await entityGraph.refresh(false);
  return entityGraph.stats();
}

export async function networkGraphLocal(params: {
  type?: unknown;
  minTrust?: unknown;
}): Promise<unknown> {
  if (scamNetwork.enabled) await entityGraph.refresh(false);
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
  if (scamNetwork.enabled) await entityGraph.refresh(false);
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
