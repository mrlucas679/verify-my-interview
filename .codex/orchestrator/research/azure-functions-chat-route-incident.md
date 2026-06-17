# Azure Functions chat route incident

Date: 2026-06-13

## Question

Why does the deployed VerifyMyInterview UI show the detective chat fallback
message after a report is generated?

## Decision

Decide whether this is a Foundry chat-agent failure, a frontend bug, or an Azure
Functions deployment/routing gap, then fix the smallest production path.

## Evidence Bar

- Reproduce the live failure.
- Download Azure logs and identify the HTTP status/root path.
- Check official Azure Functions routing docs for `function.json` HTTP triggers.
- Compare deployed function list with frontend/backend expected routes.

## Findings

1. The detective chat fallback was not a UI rendering bug. The frontend
   correctly posts `{ caseContext, messages }` to `POST /chat`.
2. The first production root cause was an Azure Functions packaging gap:
   the generated serverless package did not include a `chat/function.json`
   HTTP trigger. Live `POST /chat` returned 404, and the downloaded IIS
   detailed error showed:
   - Requested URL: `https://vmi-api-3907:80/chat`
   - Physical path: `C:\Program Files (x86)\SiteExtensions\Functions\4.1048.200\32bit\chat`
3. After adding the route, the first chat implementation could still hang
   because it entered the Foundry chat runner. Detective chat is now
   deterministic by default and only uses Foundry when
   `VMI_CHAT_FOUNDRY_ENABLED=1`.
4. The same Azure package was also missing live routes used by the UI:
   `/upload`, `/transcribe`, `/report`, and `/network/graph`. These now have
   Functions wrappers and share the backend validation/provider helpers.
5. A final live smoke exposed that `/analyze` could exceed a 120-second client
   timeout when Foundry was enabled but slow, filtered, or degraded. Foundry
   specialist turns now have a wall-clock deadline controlled by
   `VMI_FOUNDRY_TURN_TIMEOUT_MS` (default `10000`) before deterministic
   fallback takes over.

## Official References

- Microsoft Learn, Azure Functions HTTP trigger: v3 `function.json` declares
  the HTTP binding and `route`; `host.json` can remove the default `api`
  prefix with `extensions.http.routePrefix`.
  https://learn.microsoft.com/azure/azure-functions/functions-bindings-http-webhook-trigger
- Microsoft Learn, Zip deployment for Azure Functions: the zip must contain
  `host.json` at package root and the function app files expected by the
  language stack; the Azure CLI deploys the zip with
  `az functionapp deployment source config-zip`.
  https://learn.microsoft.com/azure/azure-functions/deployment-zip-push

## Changes Made

- `src/backend/local/appTools.ts`
  - Added `chatLocal`, deterministic by default.
  - Added shared helpers for upload OCR, voice transcription, report submit,
    and network graph retrieval.
- `src/backend/server.ts`
  - Reused `chatLocal` for Express `/chat` so local/App Service behavior
    matches the serverless package.
- `src/backend/agent/foundryRunner.ts`
  - Added per-turn Foundry deadline with late-promise suppression.
- `scripts/azure/package-functions-v3.ps1`
  - Added generated Functions for `chat`, `upload`, `transcribe`, `report`,
    and `network/graph`.
- `.env.example`
  - Documented `VMI_CHAT_FOUNDRY_ENABLED` and
    `VMI_FOUNDRY_TURN_TIMEOUT_MS`.

## Live Azure Verification

Function App: `vmi-api-3907`
Resource Group: `rg-kkgawatlh9-6623`

- Deployment `99d0ff5690fa49aaab863b9796c0507f` succeeded.
- Azure now lists:
  `analyze`, `chat`, `health`, `networkGraph`, `networkStats`, `report`,
  `static`, `transcribe`, `upload`.
- `GET /health`: `200`.
- `POST /chat`: `200` in 3.82s, `engine: deterministic`.
- `POST /analyze`: `200` in 19.14s after Foundry degradation, no client
  timeout.
- `GET /network/graph?minTrust=corroborated`: `200` JSON.
- `POST /upload` without a file: `400 {"error":"file is required"}`.
- `POST /transcribe` without audio: `400 {"error":"audio file is required"}`.
- `curl -F` invalid upload/transcribe probes reached the magic-byte sniffers
  and returned `415`, proving multipart routing/parser behavior.

## Log Artifacts

- Initial 404 evidence:
  `C:\Users\Admin\AppData\Local\Temp\vmi-chat-incident-logs-20260613-103814.zip`
- First post-chat-route logs:
  `C:\Users\Admin\AppData\Local\Temp\vmi-chat-fixed-logs-20260613-110636.zip`
- Full route-set logs:
  `C:\Users\Admin\AppData\Local\Temp\vmi-final-online-logs-20260613-112234.zip`
- Final post-deadline logs:
  `C:\Users\Admin\AppData\Local\Temp\vmi-post-deadline-logs-20260613-113801.zip`

## Verification Gates

- `npm run build:backend`: pass
- `npm run lint`: pass
- `npm test -- --runInBand`: 39/39 pass
- `npm run eval`: 13/13 pass
