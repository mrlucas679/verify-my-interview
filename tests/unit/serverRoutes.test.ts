import type { Server } from 'http';
import type { Express } from 'express';

const ROUTE_ENV_KEYS = ['NODE_ENV', 'VMI_ALLOW_PUBLIC_REPORTS', 'VMI_REPORT_API_KEY'] as const;

const EXTERNAL_ENV_KEYS = [
  'AZURE_AI_PROJECT_ENDPOINT',
  'PROJECT_ENDPOINT',
  'AZURE_AI_AGENT_ID',
  'AZURE_SEARCH_ENDPOINT',
  'AZURE_SEARCH_API_KEY',
  'AZURE_SEARCH_KNOWLEDGE_BASE',
  'AZURE_SPEECH_REGION',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_LOCALES',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_KEY',
  'SERPAPI_API_KEY',
  'NEWSAPI_API_KEY',
  'GNEWS_API_KEY',
  'OPENCORPORATES_API_KEY',
  'WHOIS_XML_API_KEY',
  'ABSTRACT_API_KEY',
  'AZURE_DOCINT_ENDPOINT',
  'AZURE_DOCINT_KEY',
  'WHOIS_LOOKUP_ENABLED',
  'WHOISJSON_API_KEY',
  'DOMSCAN_API_KEY',
  'ABSTRACT_EMAIL_REPUTATION_KEY',
  'ABSTRACT_PHONE_KEY',
  'ABSTRACT_COMPANY_KEY',
  'ABSTRACT_IP_KEY',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
  'VMI_TELEMETRY_DISABLED',
  'COSMOS_CONNECTION_STRING',
  'COSMOS_PII_CONNECTION_STRING',
  'COSMOS_DB',
  'COSMOS_SHARE_TTL_DAYS',
  'COSMOS_CASE_RETENTION_DAYS',
  'URL_UNWRAP_ENABLED',
  'SERVICEBUS_CONNECTION_STRING',
  'SERVICEBUS_QUEUE',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'AUTH_JWKS_URI',
  'AUTH_ANON_TRIAL_MAX',
  'AUTH_ANON_TRIAL_DAYS',
  'AUTH_ANON_SALT',
  'AUTH_ADMIN_EMAILS',
  'AZURE_STORAGE_ACCOUNT',
  'AZURE_STORAGE_CONNECTION_STRING',
] as const;

const ALL_ENV_KEYS = [...ROUTE_ENV_KEYS, ...EXTERNAL_ENV_KEYS] as const;

interface TestServer {
  baseUrl: string;
  server: Server;
}

function snapshotEnv(keys: readonly string[]): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(keys: readonly string[], snapshot: Record<string, string | undefined>): void {
  for (const key of keys) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function deleteEnv(keys: readonly string[]): void {
  for (const key of keys) delete process.env[key];
}

async function startTestServer(app: Express): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Test server did not bind to a TCP port'));
        return;
      }
      resolve({ baseUrl: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

async function stopTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function jsonRequest(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = (await res.json()) as unknown;
  return {
    status: res.status,
    body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
  };
}

describe('HTTP route boundary failures', () => {
  let testServer: TestServer;
  const savedEnv = snapshotEnv(ALL_ENV_KEYS);

  beforeAll(async () => {
    deleteEnv(EXTERNAL_ENV_KEYS);
    const mod = await import('../../src/backend/server');
    testServer = await startTestServer(mod.default);
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.VMI_ALLOW_PUBLIC_REPORTS;
    delete process.env.VMI_REPORT_API_KEY;
    deleteEnv(EXTERNAL_ENV_KEYS);
  });

  afterAll(async () => {
    await stopTestServer(testServer.server);
    restoreEnv(ALL_ENV_KEYS, savedEnv);
  });

  it('keeps internal network APIs out of the public docs table', async () => {
    const { status, body } = await jsonRequest(testServer.baseUrl, '/docs');
    expect(status).toBe(200);
    const endpoints = body.endpoints as Record<string, string>;
    expect(Object.keys(endpoints).some((key) => key.includes('/network'))).toBe(false);
  });

  it('rejects invalid analyze payloads before the pipeline runs', async () => {
    const { status, body } = await jsonRequest(testServer.baseUrl, '/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidence: '' }),
    });
    expect(status).toBe(400);
    expect(String(body.error)).toContain('evidence');
  });

  it('rejects malformed public reports at the boundary', async () => {
    const { status, body } = await jsonRequest(testServer.baseUrl, '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: '', description: '' }),
    });
    expect(status).toBe(400);
    expect(String(body.error)).toContain('companyName');
  });

  it('requires a trusted report API key in production unless public reports are explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VMI_ALLOW_PUBLIC_REPORTS;
    delete process.env.VMI_REPORT_API_KEY;
    const { status, body } = await jsonRequest(testServer.baseUrl, '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: 'Example Pty', description: 'Asked for an upfront training fee.' }),
    });
    expect(status).toBe(401);
    expect(String(body.error)).toContain('API key');
  });

  it('redacts sensitive identifiers before analyze results leave the API', async () => {
    const saId = '8001015009087';
    const { status, body } = await jsonRequest(testServer.baseUrl, '/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evidence: `Recruiter asked for my South African ID ${saId} and a R450 starter kit fee before induction.`,
      }),
    });
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(saId);
  });

  it('rejects upload and transcription requests without files', async () => {
    const upload = await jsonRequest(testServer.baseUrl, '/upload', { method: 'POST' });
    const transcribe = await jsonRequest(testServer.baseUrl, '/transcribe', { method: 'POST' });
    expect(upload.status).toBe(400);
    expect(transcribe.status).toBe(400);
    expect(String(upload.body.error)).toContain('file');
    expect(String(transcribe.body.error)).toContain('audio');
  });

  it('fails account routes closed when auth is not configured', async () => {
    const { status, body } = await jsonRequest(testServer.baseUrl, '/me');
    expect(status).toBe(503);
    expect(String(body.error)).toContain('Accounts are not enabled');
  });
});
