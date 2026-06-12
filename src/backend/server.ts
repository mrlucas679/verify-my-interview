// Express API server.
//
// Every endpoint follows the same defensive pattern: rate-limit → validate
// shape/type/size of UNTRUSTED input → do the work → return a typed JSON
// error on failure. Security headers + a content-free audit log apply
// globally (see http/guard.ts for the threat-model notes).

import 'dotenv/config';
import path from 'path';
import { randomUUID, randomBytes } from 'crypto';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { ocrEnabled, extractText } from './ocr/documentIntelligence';
import { speechEnabled, transcribeAudio, TranscriptionError } from './speech/speechToText';
import { AgentOrchestrator } from './agent/orchestrator';
import { scamNetwork } from './network/scamNetwork';
import { entityGraph } from './network/entityGraph';
import { NetworkReport, NodeType, TrustLevel } from './network/types';
import { getFoundrySettings, FoundryRunner } from './agent/foundryRunner';
import { ToolOrchestrator } from './tools';
import { ConversationalAgent, CaseContext, ChatMessage } from './agent/agents/conversationalAgent';
import { webResearchEnabled } from './research/webResearch';
import { redactAndCap, redactSensitiveIdentifiers } from './privacy/redaction';
import {
  apiKeyGate,
  auditLog,
  cleanString,
  cleanStringArray,
  rateLimit,
  securityHeaders,
  sniffUploadType,
  sniffAudioType,
} from './http/guard';

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy / Container Apps ingress, trust the first hop so
// req.ip is the real client and per-IP rate limits work. Off by default.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

// Global middleware. 1 MB of JSON is ample for pasted evidence (the /analyze
// cap is 40k chars) and keeps body parsing from being a memory-DoS vector.
app.use(securityHeaders);
app.use(auditLog);
app.use(express.json({ limit: '1mb' }));

// Static web UI (served from <project root>/public)
app.use(express.static(path.join(process.cwd(), 'public')));

// In-memory file upload (8 MB cap) for OCR
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
// Larger cap for voice recordings (audio is heavier than a screenshot).
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Input ceilings — generous for real evidence, hostile to abuse.
const MAX_EVIDENCE_CHARS = 40_000;
const MAX_CHAT_MESSAGES = 40;
const MAX_CHAT_CONTENT = 4_000;

/**
 * POST /upload
 * Extract text from an uploaded document/screenshot via Azure Document Intelligence.
 */
app.post(
  '/upload',
  rateLimit({ name: 'upload', windowMs: 60_000, max: 10 }),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) return res.status(400).json({ error: 'file is required' });

      // Magic-byte sniffing — never trust the client's MIME type or extension.
      const kind = sniffUploadType(file.buffer);
      if (!kind) {
        return res.status(415).json({
          error: 'Unsupported file type. Upload a screenshot or document (JPEG, PNG, WebP, TIFF, BMP, HEIC, or PDF).',
        });
      }
      if (!ocrEnabled()) {
        return res.status(503).json({ error: 'Document OCR is not configured' });
      }
      const { text, pages } = await extractText(file.buffer);
      // Echo only a sanitized basename (originalname is attacker-controlled).
      const safeName = path.basename(file.originalname || 'upload').slice(0, 80);
      res.json({ text, pages, fileName: safeName });
    } catch (error) {
      console.error('Upload/OCR error:', error);
      res.status(500).json({ error: 'OCR failed' });
    }
  }
);

/**
 * POST /transcribe
 * Voice Investigation — transcribe a spoken account via Azure AI Speech so it
 * can be investigated like any other evidence. Returns the transcript only;
 * the client then submits it to /analyze (keeps the pipeline single-purpose).
 */
app.post(
  '/transcribe',
  rateLimit({ name: 'transcribe', windowMs: 60_000, max: 6 }),
  audioUpload.single('audio'),
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } })
        .file;
      if (!file) return res.status(400).json({ error: 'audio file is required' });

      // Magic-byte sniffing — never trust the client's declared audio MIME type.
      const kind = sniffAudioType(file.buffer);
      if (!kind) {
        return res.status(415).json({
          error: 'Unsupported audio format. Record or upload WAV, MP3, M4A, OGG, FLAC, WebM, or AMR.',
        });
      }
      if (!speechEnabled()) {
        return res.status(503).json({ error: 'Voice transcription is not configured' });
      }
      // Send the MIME derived from the SNIFFED kind, never the client's header
      // (defense-in-depth: keeps untrusted strings out of the provider request).
      const sniffedMime: Record<string, string> = {
        wav: 'audio/wav',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        webm: 'audio/webm',
        amr: 'audio/amr',
      };
      const { text, durationSec, locale } = await transcribeAudio(
        file.buffer,
        sniffedMime[kind] ?? 'application/octet-stream',
        `audio.${kind}`
      );
      if (!text.trim()) {
        return res.status(422).json({
          error: 'No speech could be recognised. Try recording again in a quieter setting.',
        });
      }
      res.json({ text, durationSec, locale });
    } catch (error) {
      if (error instanceof TranscriptionError) {
        return res.status(error.clientStatus).json({ error: error.message });
      }
      console.error('Transcription error:', error);
      res.status(500).json({ error: 'Transcription failed' });
    }
  }
);

/**
 * POST /analyze
 * Analyzes evidence and returns risk report
 */
app.post(
  '/analyze',
  rateLimit({ name: 'analyze', windowMs: 60_000, max: 10 }),
  async (req: Request, res: Response) => {
    try {
      const evidence = req.body?.evidence;
      if (typeof evidence !== 'string' || evidence.trim().length === 0) {
        return res.status(400).json({ error: 'Field "evidence" must be a non-empty string.' });
      }
      if (evidence.length > MAX_EVIDENCE_CHARS) {
        return res.status(400).json({
          error: `Evidence is too long (${evidence.length} chars). Limit is ${MAX_EVIDENCE_CHARS} — submit the relevant excerpt.`,
        });
      }

      // POPIA boundary (CLAUDE.md rule 4): strip the reporter's/bystanders'
      // sensitive identifiers (SA ID, bank, card numbers) before ANY pipeline
      // processing, for every evidence channel — typed, OCR'd, or transcribed.
      // Scam IOCs (emails/domains/phones) are intentionally preserved.
      const { text: redactedEvidence } = redactSensitiveIdentifiers(evidence);

      const caseId = randomUUID();
      console.log(`[${caseId}] Analyzing evidence...`);

      const { report, trace, signals, matches, graph } = await AgentOrchestrator.analyze(
        redactedEvidence,
        caseId
      );

      res.json({
        case_id: caseId,
        report,
        trace,
        signals,
        matches,
        graph
      });
    } catch (error) {
      console.error('Error analyzing evidence:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  }
);

/** Validate and cap the client-supplied chat payload (all of it is untrusted). */
function parseChatBody(body: any): { ctx: CaseContext; messages: ChatMessage[] } | null {
  if (!body || typeof body !== 'object') return null;
  const rawCtx = body.caseContext;
  const rawMessages = body.messages;
  if (!rawCtx || typeof rawCtx !== 'object' || !Array.isArray(rawMessages)) return null;
  if (rawMessages.length === 0 || rawMessages.length > MAX_CHAT_MESSAGES) return null;

  const messages: ChatMessage[] = [];
  for (const m of rawMessages) {
    const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null;
    const content = cleanString(m?.content, MAX_CHAT_CONTENT);
    if (!role || !content) return null;
    messages.push({ role, content });
  }

  const score = Number(rawCtx.risk_score);
  const ctx: CaseContext = {
    evidence: cleanString(rawCtx.evidence, MAX_EVIDENCE_CHARS),
    risk_level: cleanString(rawCtx.risk_level, 40) || 'Unknown',
    risk_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    case_summary: cleanString(rawCtx.case_summary, 2_000),
    red_flags: cleanStringArray(rawCtx.red_flags, 20, 200),
    matches: Array.isArray(rawCtx.matches)
      ? rawCtx.matches.slice(0, 10).map((m: any) => ({
          reportId: cleanString(m?.reportId, 60),
          scamType: cleanString(m?.scamType, 80),
          similarity: Number.isFinite(Number(m?.similarity))
            ? Math.max(0, Math.min(1, Number(m.similarity)))
            : 0,
        }))
      : [],
  };
  return { ctx, messages };
}

/**
 * POST /chat
 * Continue a conversation with the detective about an investigated case.
 */
app.post(
  '/chat',
  rateLimit({ name: 'chat', windowMs: 60_000, max: 20 }),
  async (req: Request, res: Response) => {
    try {
      const parsed = parseChatBody(req.body);
      if (!parsed) {
        return res.status(400).json({
          error:
            'Invalid chat payload: caseContext (object) and messages (1-40 of {role: "user"|"assistant", content: string}) are required.',
        });
      }
      const settings = getFoundrySettings();
      const runner = settings.enabled ? new FoundryRunner(settings) : null;
      const agent = new ConversationalAgent(runner, new ToolOrchestrator());
      const { reply, engine } = await agent.run(parsed.ctx, parsed.messages.slice(-12));
      res.json({ reply, engine });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Chat failed' });
    }
  }
);

/**
 * POST /report
 * Submit a scam to the scam-intelligence network. The report id is ALWAYS
 * generated server-side — a client-supplied id could overwrite existing
 * intelligence (the index upserts by id).
 */
app.post(
  '/report',
  rateLimit({ name: 'report', windowMs: 60_000, max: 5 }),
  apiKeyGate('VMI_REPORT_API_KEY'),
  async (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      const companyName = cleanString(b.companyName, 120);
      const rawDescription = typeof b.description === 'string' ? b.description : '';
      if (!companyName || !rawDescription.trim()) {
        return res.status(400).json({ error: 'companyName and description are required' });
      }
      const report: NetworkReport = {
        reportId: `R-${Date.now()}-${randomBytes(3).toString('hex')}`,
        companyName,
        aliases: cleanStringArray(b.aliases, 10, 120),
        scamType: cleanString(b.scamType, 80) || 'User-reported scam',
        // POPIA minimality: strip the reporter's/bystanders' sensitive identifiers
        // (SA ID, bank, card numbers) before this free text is indexed or graphed.
        // Scam IOCs (domains/emails/phones) are captured in their own fields below.
        description: redactAndCap(rawDescription, 5000),
        domains: cleanStringArray(b.domains, 20, 253),
        emails: cleanStringArray(b.emails, 20, 254),
        phones: cleanStringArray(b.phones, 20, 30),
        paymentHandles: cleanStringArray(b.paymentHandles, 20, 120),
        location: cleanString(b.location, 120) || 'Unknown',
        reportedAt: new Date().toISOString().slice(0, 10),
        sourceType: 'user',
        trustLevel: 'unverified',
      };
      if (scamNetwork.enabled) {
        await scamNetwork.add(report);
        await entityGraph.refresh();
      } else {
        // Indexed network unavailable — keep the report in the in-memory graph
        // so structural matching still works for this session.
        await entityGraph.addLocalReport(report);
      }
      res.status(201).json({ ok: true, reportId: report.reportId });
    } catch (error) {
      console.error('Error submitting report:', error);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  }
);

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

/**
 * GET /network/graph
 * The scam-intelligence entity graph (optionally filtered).
 */
app.get(
  '/network/graph',
  rateLimit({ name: 'network', windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    try {
      const type = typeof req.query.type === 'string' && NODE_TYPES.has(req.query.type)
        ? (req.query.type as NodeType)
        : undefined;
      const minTrust =
        typeof req.query.minTrust === 'string' && TRUST_LEVELS.has(req.query.minTrust)
          ? (req.query.minTrust as TrustLevel)
          : undefined;
      const graph = await entityGraph.getGraph({ type, minTrust });
      res.json(graph);
    } catch (error) {
      console.error('Graph error:', error);
      res.status(500).json({ error: 'Failed to build entity graph' });
    }
  }
);

/**
 * GET /network/stats
 * Aggregate threat statistics over the report corpus.
 */
app.get(
  '/network/stats',
  rateLimit({ name: 'network', windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    try {
      res.json(await entityGraph.stats());
    } catch (error) {
      console.error('Stats error:', error);
      res.status(500).json({ error: 'Failed to compute network stats' });
    }
  }
);

/**
 * GET /health
 * Health check with per-subsystem status — every capability degrades gracefully.
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    subsystems: {
      foundry_agents: getFoundrySettings().enabled,
      scam_network_index: scamNetwork.enabled,
      entity_graph: true, // in-memory; always available (seed-backed fallback)
      document_ocr: ocrEnabled(),
      voice_transcription: speechEnabled(),
      web_research: webResearchEnabled(),
    }
  });
});

/**
 * GET /docs
 * API documentation
 */
app.get('/docs', (req: Request, res: Response) => {
  res.json({
    service: 'Verify My Interview',
    version: '0.1.0',
    endpoints: {
      'POST /analyze': 'Submit evidence for fraud investigation (returns report + trace + case subgraph)',
      'POST /chat': 'Converse with the case-aware detective',
      'POST /transcribe': 'Transcribe a voice recording (Azure AI Speech) for investigation',
      'POST /upload': 'OCR a document/screenshot via Azure Document Intelligence',
      'POST /report': 'Submit a scam report to the intelligence network',
      'GET /network/graph': 'Scam-intelligence entity graph (?type=&minTrust=)',
      'GET /network/stats': 'Threat statistics over the report corpus',
      'GET /health': 'Health check with subsystem status',
      'GET /docs': 'API documentation'
    }
  });
});

// SPA fallback: serve the built React app for any non-API GET route.
// Missing hashed assets must 404 (a stale cached index.html would otherwise
// receive HTML where it expects CSS/JS and break with a MIME error).
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/assets/')) {
    return res.status(404).json({ error: 'Asset not found — reload the page (Ctrl+Shift+R).' });
  }
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Error handler — typed JSON errors, no stack traces or internals in responses.
app.use((err: any, req: Request, res: Response, next: any) => {
  // Body too large / malformed JSON from express.json arrive here.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large (1 MB limit).' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  if (err instanceof (multer as any).MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      // Limits differ per route (8 MB documents on /upload, 25 MB audio on /transcribe).
      const limit = req.path === '/transcribe' ? '25 MB' : '8 MB';
      return res.status(413).json({ error: `File too large (${limit} limit).` });
    }
    // Wrong/extra multipart field etc. — a malformed request, not an oversized one.
    return res.status(400).json({ error: 'Upload rejected.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] Verify My Interview API listening on port ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    console.log(`[Server] Documentation: http://localhost:${PORT}/docs`);
    if (scamNetwork.enabled) {
      scamNetwork
        .ensureIndex()
        .then(() => console.log('[Server] Scam-intelligence network index ready.'))
        .catch((e) => console.warn('[Server] Network index check failed:', e?.message ?? e));
    }
    entityGraph
      .refresh()
      .catch((e) => console.warn('[Server] Entity graph build failed:', e?.message ?? e));
  });
}

export default app;
