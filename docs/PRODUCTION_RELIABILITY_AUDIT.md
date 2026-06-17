# Production Reliability Audit

Date: 2026-06-13

Scope: production-only failure modes for Verify My Interview on Azure. This audit focuses on async control flow, AI orchestration, third-party service latency, Azure Functions/App Service behavior, frontend request races, and distributed-state consistency.

Primary Azure references:

- Azure Functions HTTP-triggered requests can time out at 230 seconds while the function keeps running: https://learn.microsoft.com/azure/azure-functions/functions-bindings-http-webhook-trigger#limits
- Azure recommends short HTTP functions, queued/asynchronous work for long operations, stateless/idempotent functions, and completing all background tasks before returning: https://learn.microsoft.com/azure/azure-functions/performance-reliability
- Azure Functions recommends reusing clients and managing outbound connections: https://learn.microsoft.com/azure/azure-functions/manage-connections
- Azure SDK for JavaScript supports abort signals for cancelling pending SDK work: https://learn.microsoft.com/azure/developer/javascript/sdk/use-azure-sdk#cancel-async-operations

## Executive findings

The most serious risk is that the Foundry timeout wrapper uses `Promise.race` without cancelling the real Foundry turn. This means the deterministic fallback can continue while the original AI run is still alive and can still call tools. That is exactly the class of bug where an AI response or tool result can arrive after downstream logic has already moved on.

The second serious class is frontend request lifecycle control. Analysis and chat requests have no request identity, cancellation, or timeout. A slow earlier request can overwrite a newer result, and chat failures are collapsed into a generic "could not respond" message, hiding the production cause.

The third serious class is Azure HTTP sync work. OCR, speech, Foundry, web research, and network graph refreshes are all performed inside request/response paths. Azure documents a 230-second response ceiling for HTTP-triggered functions and recommends async patterns for long work.

No active Socket.IO, WebSocket, Redis, or MongoDB production code was found. `src/infrastructure/db.ts` imports Mongo/Redis, but it is excluded from TypeScript compilation and the dependencies are not present. Treat it as dead/misleading infrastructure, not an active runtime subsystem.

## Findings

### P0: Foundry deadline does not cancel the live AI turn

Location:

- `src/backend/agent/foundryRunner.ts:34`
- `src/backend/agent/foundryRunner.ts:43`
- `src/backend/agent/foundryRunner.ts:46`
- `src/backend/agent/foundryRunner.ts:114`
- `src/backend/agent/foundryRunner.ts:198`

Root cause: `withDeadline()` races the Foundry work against a timer:

```ts
return await Promise.race([work, deadline]);
```

The losing promise is not cancelled. The later `void work.catch(() => undefined)` only suppresses an unhandled rejection. It does not stop `runTurnOnce()`.

Why production exposes it: Foundry calls are slower and less predictable in production due to network latency, model queueing, throttling, identity refresh, and tool-call latency. When `VMI_FOUNDRY_TURN_TIMEOUT_MS` is hit, the orchestrator may fall back or continue while the original Foundry run is still creating threads, polling runs, calling tools, and submitting tool outputs.

Impact: A late AI run can call `toolExecutor` after downstream fallback logic has already executed. Today most tools are read-heavy, but it still burns external provider budget and mutates shared per-case `ToolOrchestrator` state. If a future tool writes evidence or reports, this becomes data corruption.

Corrected implementation:

```ts
class FoundryDeadlineError extends Error {
  constructor(label: string) {
    super(`Foundry deadline reached for "${label}"`);
    this.name = 'FoundryDeadlineError';
  }
}

async function withAbortableDeadline<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FoundryDeadlineError(label)), turnDeadlineMs());
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
```

Then change `runTurn()` to call `withAbortableDeadline(options.name, signal => this.runTurnOnce(options, signal))`, and in `runTurnOnce()`:

```ts
signal.throwIfAborted();
const agent = await client.createAgent(this.settings.modelDeployment, {
  name: options.name,
  instructions: options.instructions,
  tools: toolDefinitions,
}, { abortSignal: signal });

// Before every poll, tool execution, and submit:
signal.throwIfAborted();
const result = options.toolExecutor
  ? await options.toolExecutor(toolName, args, signal)
  : { tool: toolName, success: false, error: 'No tool executor configured' };
signal.throwIfAborted();
```

If a specific Azure Agents SDK method does not accept `abortSignal`, do not return fallback while that method is still running. Move Foundry execution to a queued job with an investigation id, store stage state, and make tools idempotent.

Monitoring:

- `foundry.turn.deadline.count`
- `foundry.turn.aborted.count`
- `foundry.tool_call_after_abort.blocked.count`
- span attributes: `agent.name`, `run.status`, `turn.attempt`, `deadline_ms`, `case_id`

### P1: Analysis requests can race and overwrite newer user state

Location:

- `frontend/src/pages/Verify.tsx:238`
- `frontend/src/store/caseStore.tsx:22`
- `frontend/src/store/caseStore.tsx:28`
- `frontend/src/store/caseStore.tsx:29`
- `frontend/src/store/caseStore.tsx:35`

Root cause: `submit()` fires `void runAnalysis(value)` and navigates immediately. `runAnalysis()` has no request id, no abort controller, and always writes `setResult()` and `setLoading(false)` when its promise resolves.

Why production exposes it: production investigations can vary from a few seconds to tens of seconds depending on Foundry, Search, web research, OCR, and provider latency. If the user submits twice or edits and retries, the earlier slower response can overwrite the later investigation.

Impact: The report page can show the wrong case. This is a user-visible trust failure.

Corrected implementation:

```tsx
const requestIdRef = useRef(0);
const abortRef = useRef<AbortController | null>(null);

const runAnalysis = useCallback(async (evidence: string) => {
  const requestId = ++requestIdRef.current;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  setLoading(true);
  setError(null);
  setResult(null);
  setLastEvidence(evidence);

  try {
    const data = await analyze(evidence, { signal: controller.signal });
    if (requestId !== requestIdRef.current) return null;
    setResult(data);
    return data;
  } catch (error) {
    if (controller.signal.aborted || requestId !== requestIdRef.current) return null;
    setError(error instanceof Error ? error.message : 'Investigation failed');
    return null;
  } finally {
    if (requestId === requestIdRef.current) setLoading(false);
  }
}, []);
```

Monitoring:

- `client.analysis.started`
- `client.analysis.aborted`
- `client.analysis.stale_response_ignored`
- `client.analysis.duration_ms`

### P1: Frontend API calls have no timeout or cancellation

Location:

- `frontend/src/lib/api.ts:21`
- `frontend/src/lib/api.ts:35`
- `frontend/src/lib/api.ts:55`
- `frontend/src/lib/api.ts:70`

Root cause: every `fetch()` call waits indefinitely unless the browser or network stack fails it. No `AbortController`, no per-route timeout, and no correlation id are passed.

Why production exposes it: mobile networks, Azure cold starts, Foundry latency, Speech transcription, OCR polling, and HTTP 502s near the Azure load-balancer timeout can all leave the UI in a stuck state.

Impact: users see infinite loading or the generic detective failure message instead of a recoverable timeout.

Corrected implementation:

```ts
async function fetchJson<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(path, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
```

Suggested budgets: chat 30s, analyze 90s until moved to jobs, upload OCR 75s, transcribe 130s with progress UI.

Monitoring:

- client timeout count by route
- HTTP status by route
- request correlation id carried from frontend to backend logs

### P1: Chat failure is hidden behind a generic UI message

Location:

- `frontend/src/components/ChatPanel.tsx:39`
- `frontend/src/components/ChatPanel.tsx:47`
- `frontend/src/components/ChatPanel.tsx:49`
- `scripts/azure/package-functions-v3.ps1:546`
- `scripts/azure/package-functions-v3.ps1:558`

Root cause: the frontend catch block discards the actual HTTP status and server error. The packaged Azure Function also returns only `{ error: "Chat failed" }` on 500.

Why production exposes it: if `/chat` is missing, returns 400 from a payload mismatch, hits a cold-start timeout, or throws from the backend, the user gets the same message. This matches the observed "detective did not reply" symptom: the user-facing text cannot distinguish route failure, timeout, payload rejection, or server exception.

Impact: support and debugging are slow because the UI erases the failure class.

Corrected implementation:

```tsx
} catch (error) {
  const message = error instanceof Error ? error.message : 'Chat failed';
  setMessages((current) => [
    ...current,
    { role: 'assistant', content: humanizeChatFailure(message) },
  ]);
}
```

Backend should return a stable error code:

```js
body: JSON.stringify({
  error: "Chat failed",
  code: "CHAT_RUNTIME_ERROR",
  requestId: context.invocationId
})
```

Monitoring:

- `chat.failure.count` by `code`
- `chat.duration_ms`
- `chat.engine` foundry vs deterministic
- `chat.fallback.used`

### P1: OCR long-running operation has no deadline and creates a new client per request

Location:

- `src/backend/ocr/documentIntelligence.ts:10`
- `src/backend/ocr/documentIntelligence.ts:11`
- `src/backend/ocr/documentIntelligence.ts:15`
- `src/backend/ocr/documentIntelligence.ts:16`

Root cause: `pollUntilDone()` waits without an application deadline. A new `DocumentAnalysisClient` is created for every request.

Why production exposes it: Azure OCR latency varies with document size, page count, service load, and networking. Azure recommends reusing service clients in Functions and avoiding long-running HTTP work.

Impact: upload requests can hang until the Azure HTTP path times out. Multiple concurrent uploads can also create avoidable outbound connections.

Corrected implementation:

```ts
const client = new DocumentAnalysisClient(
  process.env.AZURE_DOCINT_ENDPOINT as string,
  new AzureKeyCredential(process.env.AZURE_DOCINT_KEY as string)
);

export async function extractText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const signal = AbortSignal.timeout(60_000);
  const poller = await client.beginAnalyzeDocument('prebuilt-read', buffer, { abortSignal: signal });
  const result = await poller.pollUntilDone({ abortSignal: signal });
  return { text: result?.content ?? '', pages: result?.pages?.length ?? 0 };
}
```

If the SDK version does not support this exact overload, wrap OCR in a background job and report `202 Accepted` plus polling.

Monitoring:

- `ocr.duration_ms`
- `ocr.timeout.count`
- `ocr.pages`
- `ocr.bytes`
- provider status/error code

### P1: Manual multipart parsing converts binary bodies into strings

Location:

- `scripts/azure/package-functions-v3.ps1:296`
- `scripts/azure/package-functions-v3.ps1:304`
- `scripts/azure/package-functions-v3.ps1:321`
- `scripts/azure/package-functions-v3.ps1:388`
- `scripts/azure/package-functions-v3.ps1:396`
- `scripts/azure/package-functions-v3.ps1:413`

Root cause: the generated Azure Function parser converts the whole request body to a `"binary"` string, splits by boundary text, then converts the part back to a Buffer.

Why production exposes it: real uploads are larger and concurrent. A 25 MB audio upload can be duplicated several times in memory. Boundary bytes can also appear inside binary data.

Impact: memory pressure, failed uploads, corrupted files, and intermittent 500/413 behavior under concurrency.

Corrected implementation: use a streaming multipart parser such as `busboy`, or use Azure Functions v4 `request.formData()` where the runtime supports it. Keep byte caps while streaming and never stringify the full binary body.

Monitoring:

- upload bytes by route
- multipart parse failure count
- memory working set
- 413/415/500 count

### P2: OpenCorporates calls have no timeout, retry, or circuit breaker

Location:

- `src/services/legacy/companyVerification.ts:67`
- `src/services/legacy/companyVerification.ts:92`

Root cause: the axios calls omit `timeout`. The helper catches errors and returns `null`, which hides timeout/provider failures as "company not found".

Why production exposes it: third-party APIs stall, throttle, and return 5xx more often under real traffic.

Impact: a registry lookup can block a whole investigation stage and then produce a misleading absence-of-evidence result.

Corrected implementation:

```ts
const response = await axios.get(url, {
  params,
  timeout: 8_000,
  validateStatus: (status) => status < 500,
});
if (response.status === 429 || response.status >= 500) {
  throw new ProviderUnavailableError('OpenCorporates unavailable');
}
```

Add one retry for 429/5xx with jitter, and return a typed provider status so the scorer can distinguish "not found" from "provider unavailable".

Monitoring:

- provider duration/status/error by provider
- retry count
- circuit breaker open/closed

### P2: Report submission refreshes the graph before Azure Search visibility is guaranteed

Location:

- `src/backend/local/appTools.ts:272`
- `src/backend/local/appTools.ts:273`
- `src/backend/local/appTools.ts:274`
- `src/backend/network/scamNetwork.ts:106`
- `src/backend/network/scamNetwork.ts:110`
- `src/backend/network/entityGraph.ts:190`
- `src/backend/network/entityGraph.ts:204`

Root cause: the code uploads a report to Azure Search and immediately rebuilds the graph from `listAll()`. Search indexing is not guaranteed to be visible immediately. The graph has no refresh lock, and fallback local reports are in-memory only.

Why production exposes it: concurrent report submissions, scale-out, and indexing delay make immediate read-after-write inconsistent. Multiple instances each have their own `entityGraph` memory.

Impact: a report can return success but not appear in the graph or detective lookup immediately. Concurrent refreshes can also produce stale graph snapshots.

Corrected implementation:

```ts
await scamNetwork.add(report);
await graphRefreshQueue.enqueue({ reportId: report.reportId, attempt: 1 });
return { ok: true, reportId: report.reportId, status: 'indexing' };
```

Worker logic should retry visibility checks with backoff, then refresh under a single-flight lock:

```ts
let refreshPromise: Promise<void> | null = null;

export function refreshOnce(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = entityGraph.refresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
```

Monitoring:

- `report.index.visibility_lag_ms`
- `graph.refresh.duration_ms`
- `graph.refresh.concurrent_suppressed`
- `report.indexing.status`

### P2: Search graph `listAll()` has a hard 1000-document ceiling

Location:

- `src/backend/network/scamNetwork.ts:113`
- `src/backend/network/scamNetwork.ts:133`
- `src/backend/network/scamNetwork.ts:136`

Root cause: the method says "Page through every report" but only asks for `top: 1000`.

Why production exposes it: once the scam network grows beyond 1000 reports, graph stats, lookups, and community intelligence silently ignore older or later records.

Impact: incomplete intelligence and false negatives.

Corrected implementation:

```ts
const results: NetworkReport[] = [];
const response = await client.search('*', { select: FIELDS } as SearchOptions<IndexedReport>);
for await (const result of response.results) {
  if (results.length >= MAX_GRAPH_REPORTS) break;
  results.push(toNetworkReport(result.document as IndexedReport));
}
return results;
```

If the Azure Search SDK supports page iteration in the current version, use continuation tokens explicitly and record whether the graph was truncated.

Monitoring:

- `graph.source_report_count`
- `graph.truncated`
- `graph.max_reports`

### P2: Alternate Functions v4 entrypoint is stale and missing live routes

Location:

- `src/backend/functions/vmiFunctions.ts:114`
- `src/backend/functions/vmiFunctions.ts:121`
- `src/backend/functions/vmiFunctions.ts:128`
- `src/backend/functions/vmiFunctions.ts:135`
- `scripts/azure/package-functions-v3.ps1:618`
- `scripts/azure/package-functions-v3.ps1:625`

Root cause: the v4 Functions file registers only `health`, `analyze`, `networkStats`, and static. The packaging script registers `health`, `analyze`, `networkStats`, `networkGraph`, `report`, `upload`, `transcribe`, `chat`, and static.

Why production exposes it: if CI/CD, Azure App Service, or a future engineer deploys the TypeScript v4 function entry instead of the v3 package script, production loses `/chat`, `/upload`, `/transcribe`, `/report`, and `/network/graph`.

Impact: the "detective did not reply" symptom can reappear as a missing `/chat` route even though local/dev testing passes.

Corrected implementation: remove the stale entrypoint or generate both deployment manifests from one route registry. Add a deployment smoke gate:

```powershell
$required = @("health","analyze","networkStats","networkGraph","report","upload","transcribe","chat","static")
$actual = az functionapp function list -g $ResourceGroup -n $FunctionApp --query "[].name" -o tsv
foreach ($name in $required) {
  if ($actual -notcontains $name) { throw "Missing deployed function: $name" }
}
```

Monitoring:

- post-deploy route inventory check
- synthetic `/chat` probe
- synthetic `/upload` probe

### P2: In-memory caches are unbounded and per-instance

Location:

- `src/backend/tools/index.ts:9`
- `src/services/legacy/domainVerificationService.ts:49`
- `src/services/legacy/companyVerification.ts:20`
- `src/backend/network/entityGraph.ts:187`

Root cause: Maps and arrays grow until process restart. They are also per-instance, so scale-out instances disagree.

Why production exposes it: Functions/App Service processes are reused, and traffic can produce many unique domains, companies, phone numbers, and reports.

Impact: memory growth and inconsistent results across instances.

Corrected implementation: replace Maps with a capped TTL LRU and cap `localReports`.

```ts
const MAX_CACHE_ENTRIES = 500;
if (this.cache.size >= MAX_CACHE_ENTRIES) {
  const oldest = this.cache.keys().next().value;
  if (oldest) this.cache.delete(oldest);
}
this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
```

Monitoring:

- cache size by cache name
- cache hit/miss
- evictions
- process memory

## Distributed systems risk map

- AI orchestration: Foundry work can continue after the app has timed out unless cancelled. This is the top risk.
- Azure HTTP limits: OCR, speech, analyze, and chat still run as synchronous HTTP work. Move the longest cases to queued jobs with polling before real launch traffic.
- Search consistency: report writes and graph reads should be treated as eventually consistent.
- Scale-out state: entity graph and local fallback reports are per-process.
- Provider reliability: OpenCorporates has no timeout; Search/OpenAI embeddings/Speech/OCR have limited or no retries depending on path.
- Client lifecycle: browser requests do not currently abort, time out, or ignore stale responses.

## Immediate fix order

1. Replace Foundry `Promise.race` deadline with real cancellation or queued execution.
2. Add request ids, AbortController support, and timeouts to frontend API calls.
3. Make `/chat` return typed error codes and expose user-safe failure text.
4. Put OCR and long investigations behind an async job/polling path or hard provider deadlines.
5. Replace manual multipart parsing with runtime form parsing or a streaming parser.
6. Add OpenCorporates timeout/retry and distinguish provider unavailable from company not found.
7. Make report indexing/graph refresh eventually-consistent by design.
8. Remove or update the stale v4 Functions entrypoint and gate route inventory in deployment.
