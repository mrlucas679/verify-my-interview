import fs from 'fs';
import path from 'path';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

import {
  analyzeEvidenceLocal,
  chatLocal,
  healthSnapshot,
  LocalHttpError,
  MAX_LOCAL_EVIDENCE_CHARS,
  networkGraphLocal,
  networkStatsLocal,
  submitReportLocal,
  transcribeAudioLocal,
  uploadDocumentLocal,
  withLogsOnStderr,
} from '../local/appTools';

const STATIC_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface UploadedPart {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name?: unknown;
}

function errorStatus(error: unknown): number {
  return error instanceof LocalHttpError ? error.clientStatus : 500;
}

function isUploadedPart(value: unknown): value is UploadedPart {
  if (!isRecord(value)) return false;
  return typeof value.arrayBuffer === 'function';
}

async function readJson(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function cleanString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => cleanString(item, maxChars))
    .filter(Boolean);
}

async function readFilePart(
  request: HttpRequest,
  fieldName: string,
  fallbackName: string
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const form = await request.formData();
  const part = form.get(fieldName);
  if (!isUploadedPart(part)) return null;
  const buffer = Buffer.from(await part.arrayBuffer());
  const fileName = typeof part.name === 'string' && part.name ? part.name : fallbackName;
  return { buffer, fileName };
}

function parseChatPayload(body: unknown):
  | {
      ctx: Parameters<typeof chatLocal>[0];
      messages: Parameters<typeof chatLocal>[1];
    }
  | null {
  if (!isRecord(body) || !isRecord(body.caseContext) || !Array.isArray(body.messages)) return null;
  if (body.messages.length === 0 || body.messages.length > 40) return null;

  const messages = body.messages.slice(0, 40).map((message) => {
    if (!isRecord(message)) return null;
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null;
    const content = cleanString(message.content, 4000);
    return role && content ? { role, content } : null;
  });
  if (messages.some((message) => message === null)) return null;

  const rawCtx = body.caseContext;
  const score = Number(rawCtx.risk_score);
  return {
    ctx: {
      evidence: cleanString(rawCtx.evidence, 40_000),
      risk_level: cleanString(rawCtx.risk_level, 40) || 'Unknown',
      risk_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
      case_summary: cleanString(rawCtx.case_summary, 2_000),
      red_flags: cleanStringArray(rawCtx.red_flags, 20, 200),
      matches: Array.isArray(rawCtx.matches)
        ? rawCtx.matches.slice(0, 10).map((match) => {
            const row = isRecord(match) ? match : {};
            const similarity = Number(row.similarity);
            return {
              reportId: cleanString(row.reportId, 60),
              scamType: cleanString(row.scamType, 80),
              similarity: Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0,
            };
          })
        : [],
    },
    messages: messages as Parameters<typeof chatLocal>[1],
  };
}

async function healthHandler(): Promise<HttpResponseInit> {
  return json(200, healthSnapshot());
}

async function analyzeHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const body = await readJson(request);
  const evidence = isRecord(body) ? body.evidence : undefined;
  if (typeof evidence !== 'string' || evidence.trim().length === 0) {
    return json(400, { error: 'Field "evidence" must be a non-empty string.' });
  }
  if (evidence.length > MAX_LOCAL_EVIDENCE_CHARS) {
    return json(400, {
      error: `Evidence is too long (${evidence.length} chars). Limit is ${MAX_LOCAL_EVIDENCE_CHARS}.`,
    });
  }

  try {
    const result = await withLogsOnStderr(() => analyzeEvidenceLocal(evidence));
    return json(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.error(`Analyze failed: ${message}`);
    return json(500, { error: 'Internal server error' });
  }
}

async function networkStatsHandler(): Promise<HttpResponseInit> {
  return json(200, await withLogsOnStderr(networkStatsLocal));
}

async function networkGraphHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const result = await withLogsOnStderr(() =>
    networkGraphLocal({
      type: request.query.get('type'),
      minTrust: request.query.get('minTrust'),
    })
  );
  return json(200, result);
}

async function reportHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = await readJson(request);
    const result = await withLogsOnStderr(() =>
      submitReportLocal(body, request.headers.get('x-api-key') ?? undefined)
    );
    return json(201, result);
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`Report failed: ${message}`);
    }
    return json(status, {
      error: error instanceof Error && status < 500 ? error.message : 'Failed to submit report',
      code: status >= 500 ? 'REPORT_RUNTIME_ERROR' : 'REPORT_BAD_REQUEST',
      requestId: context.invocationId,
    });
  }
}

async function uploadHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const file = await readFilePart(request, 'file', 'upload');
    if (!file) return json(400, { error: 'file is required', code: 'UPLOAD_FILE_REQUIRED' });
    const result = await withLogsOnStderr(() =>
      uploadDocumentLocal(file.buffer, file.fileName)
    );
    return json(200, result);
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`Upload failed: ${message}`);
    }
    return json(status, {
      error: error instanceof Error && status < 500 ? error.message : 'Failed to process upload',
      code: status >= 500 ? 'UPLOAD_RUNTIME_ERROR' : 'UPLOAD_BAD_REQUEST',
      requestId: context.invocationId,
    });
  }
}

async function transcribeHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const file = await readFilePart(request, 'audio', 'recording.webm');
    if (!file) {
      return json(400, { error: 'audio file is required', code: 'TRANSCRIBE_FILE_REQUIRED' });
    }
    const result = await withLogsOnStderr(() =>
      transcribeAudioLocal(file.buffer, file.fileName)
    );
    return json(200, result);
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);
      context.error(`Transcription failed: ${message}`);
    }
    return json(status, {
      error: error instanceof Error && status < 500 ? error.message : 'Failed to transcribe audio',
      code: status >= 500 ? 'TRANSCRIBE_RUNTIME_ERROR' : 'TRANSCRIBE_BAD_REQUEST',
      requestId: context.invocationId,
    });
  }
}

async function chatHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const parsed = parseChatPayload(await readJson(request));
  if (!parsed) {
    return json(400, {
      error: 'Invalid chat payload: caseContext and messages are required.',
      code: 'CHAT_BAD_PAYLOAD',
      requestId: context.invocationId,
    });
  }

  try {
    const result = await withLogsOnStderr(() => chatLocal(parsed.ctx, parsed.messages));
    return json(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.error(`Chat failed: ${message}`);
    return json(500, {
      error: 'Chat failed',
      code: 'CHAT_RUNTIME_ERROR',
      requestId: context.invocationId,
    });
  }
}

function publicRoot(): string {
  const cwdPublic = path.join(process.cwd(), 'public');
  if (fs.existsSync(cwdPublic)) return cwdPublic;
  return path.resolve(__dirname, '../../../public');
}

function cleanStaticPath(rawPath: string | undefined): string {
  const value = rawPath && rawPath.trim() ? rawPath : 'index.html';
  const withoutQuery = value.split('?')[0] ?? '';
  const normalized = path.normalize(withoutQuery).replace(/^(\.\.[/\\])+/, '');
  return normalized === '.' || normalized === path.sep ? 'index.html' : normalized;
}

async function staticHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const routePath = request.params.path;
  const relativePath = cleanStaticPath(typeof routePath === 'string' ? routePath : undefined);
  const root = publicRoot();
  const candidate = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const safeCandidate = candidate.startsWith(rootWithSep) ? candidate : path.join(root, 'index.html');
  const file = fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile()
    ? safeCandidate
    : path.join(root, 'index.html');

  const ext = path.extname(file).toLowerCase();
  return {
    status: 200,
    headers: {
      'content-type': STATIC_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    },
    body: fs.readFileSync(file),
  };
}

app.http('health', {
  route: 'health',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: healthHandler,
});

app.http('analyze', {
  route: 'analyze',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: analyzeHandler,
});

app.http('networkStats', {
  route: 'network/stats',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: networkStatsHandler,
});

app.http('networkGraph', {
  route: 'network/graph',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: networkGraphHandler,
});

app.http('report', {
  route: 'report',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: reportHandler,
});

app.http('upload', {
  route: 'upload',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: uploadHandler,
});

app.http('transcribe', {
  route: 'transcribe',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: transcribeHandler,
});

app.http('chat', {
  route: 'chat',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: chatHandler,
});

app.http('static', {
  route: '{*path}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: staticHandler,
});
