// Express API server — the canonical runtime (Container Apps / App Service).
//
// This is a THIN HTTP layer: every endpoint validates the shape/size of
// UNTRUSTED input, then delegates the actual work to the shared application
// core in `local/appTools.ts` (the same core the CLI and MCP server use, so
// there is ONE source of truth for analysis, reporting, OCR, transcription and
// the network graph). HTTP concerns stay here: rate limiting, security headers +
// CSP, content-free audit log, multipart parsing, and the SPA fallback. See
// http/guard.ts for the threat-model notes.

import 'dotenv/config';
import { initAzureMonitor } from './observability/telemetry';
import path from 'path';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { scamNetwork } from './network/scamNetwork';
import { entityGraph } from './network/entityGraph';
import { startEventConsumer } from './events/serviceBus';
import type { CaseContext, ChatMessage } from './agent/agents/conversationalAgent';
import {
  LocalHttpError,
  MAX_LOCAL_EVIDENCE_CHARS,
  analyzeEvidenceLocal,
  chatLocal,
  getSharedReportLocal,
  healthSnapshot,
  networkGraphLocal,
  networkStatsLocal,
  saveSharedReportLocal,
  submitReportLocal,
  transcribeAudioLocal,
  uploadDocumentLocal,
} from './local/appTools';
import {
  auditLog,
  cleanString,
  cleanStringArray,
  rateLimit,
  securityHeaders,
} from './http/guard';

initAzureMonitor();

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy / Container Apps ingress, trust the first hop so
// req.ip is the real client and per-IP rate limits work. Off by default.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
// No ETags on JSON API responses: the SPA fetches fresh each time and does not
// do conditional caching, so a revalidating 304 (empty body) would otherwise
// surface as a client error (e.g. reopening a /shared/:id link). Static assets
// keep their own caching via express.static.
app.disable('etag');

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

const MAX_CHAT_MESSAGES = 40;
const MAX_CHAT_CONTENT = 4_000;

/** Map an error from the application core to a typed JSON HTTP response.
 *  LocalHttpError carries the intended client status; anything else is a 500. */
function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof LocalHttpError) {
    res.status(error.clientStatus).json({ error: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

/**
 * POST /upload
 * Extract text from an uploaded document/screenshot via Azure Document Intelligence.
 * Magic-byte sniffing + size cap + OCR are enforced inside uploadDocumentLocal.
 */
app.post(
  '/upload',
  rateLimit({ name: 'upload', windowMs: 60_000, max: 10 }),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) return res.status(400).json({ error: 'file is required' });
      res.json(await uploadDocumentLocal(file.buffer, file.originalname));
    } catch (error) {
      sendError(res, error, 'OCR failed');
    }
  }
);

/**
 * POST /transcribe
 * Voice Investigation — transcribe a spoken account via Azure AI Speech. Sniffing,
 * size cap, server-derived MIME and the speech call live in transcribeAudioLocal.
 */
app.post(
  '/transcribe',
  rateLimit({ name: 'transcribe', windowMs: 60_000, max: 6 }),
  audioUpload.single('audio'),
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) return res.status(400).json({ error: 'audio file is required' });
      res.json(await transcribeAudioLocal(file.buffer, file.originalname));
    } catch (error) {
      sendError(res, error, 'Transcription failed');
    }
  }
);

/**
 * POST /analyze
 * Analyze evidence and return the risk report. POPIA redaction at the boundary and
 * the full multi-agent pipeline run inside analyzeEvidenceLocal.
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
      if (evidence.length > MAX_LOCAL_EVIDENCE_CHARS) {
        return res.status(400).json({
          error: `Evidence is too long (${evidence.length} chars). Limit is ${MAX_LOCAL_EVIDENCE_CHARS} — submit the relevant excerpt.`,
        });
      }
      res.json(await analyzeEvidenceLocal(evidence));
    } catch (error) {
      sendError(res, error, 'Internal server error');
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
    evidence: cleanString(rawCtx.evidence, MAX_LOCAL_EVIDENCE_CHARS),
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
      res.json(await chatLocal(parsed.ctx, parsed.messages.slice(-12)));
    } catch (error) {
      sendError(res, error, 'Chat failed');
    }
  }
);

/**
 * POST /report
 * Submit a scam to the scam-intelligence network. The report id is generated
 * server-side and the optional VMI_REPORT_API_KEY is enforced inside the core.
 */
app.post(
  '/report',
  rateLimit({ name: 'report', windowMs: 60_000, max: 5 }),
  async (req: Request, res: Response) => {
    try {
      const result = await submitReportLocal(req.body, req.get('x-api-key') ?? undefined);
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error, 'Failed to submit report');
    }
  }
);

/**
 * POST /share
 * Opt-in: persist the finished (already redacted) report result under an
 * unguessable id so the user can revisit or share it via a link. Stores the
 * derived report only — never the raw evidence. Off when Cosmos is unconfigured.
 */
app.post(
  '/share',
  rateLimit({ name: 'share', windowMs: 60_000, max: 10 }),
  async (req: Request, res: Response) => {
    try {
      res.status(201).json(await saveSharedReportLocal(req.body?.result));
    } catch (error) {
      sendError(res, error, 'Failed to share report');
    }
  }
);

/**
 * GET /shared/:id
 * Load a previously shared report result (404 when missing or expired).
 */
app.get(
  '/shared/:id',
  rateLimit({ name: 'shared', windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
    try {
      res.json({ result: await getSharedReportLocal(req.params.id) });
    } catch (error) {
      sendError(res, error, 'Failed to load shared report');
    }
  }
);

/**
 * GET /network/graph
 * The scam-intelligence entity graph (optionally filtered by ?type=&minTrust=).
 */
app.get(
  '/network/graph',
  rateLimit({ name: 'network', windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    try {
      res.json(await networkGraphLocal({ type: req.query.type, minTrust: req.query.minTrust }));
    } catch (error) {
      sendError(res, error, 'Failed to build entity graph');
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
  async (_req: Request, res: Response) => {
    try {
      res.json(await networkStatsLocal());
    } catch (error) {
      sendError(res, error, 'Failed to compute network stats');
    }
  }
);

/**
 * GET /health
 * Health check with per-subsystem status — every capability degrades gracefully.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json(healthSnapshot());
});

/**
 * GET /docs
 * API documentation
 */
app.get('/docs', (_req: Request, res: Response) => {
  res.json({
    service: 'Verify My Interview',
    version: '0.1.0',
    endpoints: {
      'POST /analyze': 'Submit evidence for fraud investigation (returns report + trace + case subgraph)',
      'POST /chat': 'Converse with the case-aware detective',
      'POST /transcribe': 'Transcribe a voice recording (Azure AI Speech) for investigation',
      'POST /upload': 'OCR a document/screenshot via Azure Document Intelligence',
      'POST /report': 'Submit a scam report to the intelligence network',
      'POST /share': 'Save a finished report result for sharing (returns an id)',
      'GET /shared/:id': 'Load a previously shared report result',
      'GET /network/graph': 'Scam-intelligence entity graph (?type=&minTrust=)',
      'GET /network/stats': 'Threat statistics over the report corpus',
      'GET /health': 'Health check with subsystem status',
      'GET /docs': 'API documentation',
    },
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
app.use((err: any, req: Request, res: Response, _next: any) => {
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
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
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
    // Async event consumer (no-op unless Service Bus is configured): keep this
    // instance's entity graph current when another instance ingests a report.
    startEventConsumer(async (type) => {
      if (type === 'report.created') {
        await entityGraph
          .refresh()
          .catch((e) => console.warn('[Server] Event-driven refresh failed:', e?.message ?? e));
      }
    });
  });
}

export default app;
