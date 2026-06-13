param(
  [string]$OutputPath = (Join-Path $env:TEMP "vmi-functions-v3-package.zip"),
  [string]$StagePath = (Join-Path $env:TEMP "vmi-functions-v3-package"),
  [switch]$BundleRuntime,
  [switch]$IncludeNodeModules,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Copy-Tree {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing required path: $Source"
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  robocopy $Source $Destination /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed for $Source with exit code $LASTEXITCODE"
  }
}

function Write-Function {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Route,
    [Parameter(Mandatory = $true)][string[]]$Methods,
    [Parameter(Mandatory = $true)][string]$Script
  )

  $dir = Join-Path $StagePath $Name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $functionJson = @{
    bindings = @(
      @{
        authLevel = "anonymous"
        type = "httpTrigger"
        direction = "in"
        name = "req"
        methods = $Methods
        route = $Route
      },
      @{
        type = "http"
        direction = "out"
        name = "res"
      }
    )
  } | ConvertTo-Json -Depth 6
  Set-Content -LiteralPath (Join-Path $dir "function.json") -Value $functionJson -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dir "index.js") -Value $Script -Encoding UTF8
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

if (-not $SkipBuild) {
  npm run build
}

if (Test-Path -LiteralPath $StagePath) {
  Remove-Item -LiteralPath $StagePath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $StagePath | Out-Null

if ($BundleRuntime) {
  $esbuild = Join-Path $repoRoot "node_modules\.bin\esbuild.cmd"
  if (-not (Test-Path -LiteralPath $esbuild)) {
    throw "Missing esbuild at $esbuild. Run npm install before packaging."
  }
  $bundleOut = Join-Path $StagePath "bundle.cjs"
  & $esbuild "src/backend/local/appTools.ts" `
    --bundle `
    --platform=node `
    --target=node20 `
    --format=cjs `
    "--outfile=$bundleOut"
  if ($LASTEXITCODE -ne 0) {
    throw "esbuild failed with exit code $LASTEXITCODE"
  }
} else {
  Copy-Tree -Source (Join-Path $repoRoot "dist") -Destination (Join-Path $StagePath "dist")
}

Copy-Tree -Source (Join-Path $repoRoot "public") -Destination (Join-Path $StagePath "public")
if ($IncludeNodeModules) {
  Copy-Tree -Source (Join-Path $repoRoot "node_modules") -Destination (Join-Path $StagePath "node_modules")
}
if ($BundleRuntime) {
  @{
    name = "verify-my-interview-functions"
    version = "0.0.0"
    private = $true
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $StagePath "package.json") -Encoding UTF8
} else {
  Copy-Item -LiteralPath (Join-Path $repoRoot "package.json") -Destination (Join-Path $StagePath "package.json")
  Copy-Item -LiteralPath (Join-Path $repoRoot "package-lock.json") -Destination (Join-Path $StagePath "package-lock.json")
}

@{
  version = "2.0"
  extensions = @{
    http = @{
      routePrefix = ""
    }
  }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $StagePath "host.json") -Encoding UTF8

$runtimeRequire = if ($BundleRuntime) { "../bundle.cjs" } else { "../dist/src/backend/local/appTools" }

$healthScript = @'
module.exports = async function (context) {
  const { healthSnapshot } = require("__RUNTIME_REQUIRE__");
  context.res = {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(healthSnapshot())
  };
};
'@

$analyzeScript = @'
function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.rawBody === "string" && req.rawBody.trim()) {
    try {
      return JSON.parse(req.rawBody);
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = async function (context, req) {
  const {
    analyzeEvidenceLocal,
    MAX_LOCAL_EVIDENCE_CHARS,
    withLogsOnStderr
  } = require("__RUNTIME_REQUIRE__");
  const body = readBody(req);
  const evidence = body && typeof body.evidence === "string" ? body.evidence : "";

  if (!evidence.trim()) {
    context.res = {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Field \"evidence\" must be a non-empty string." })
    };
    return;
  }

  if (evidence.length > MAX_LOCAL_EVIDENCE_CHARS) {
    context.res = {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: `Evidence is too long (${evidence.length} chars). Limit is ${MAX_LOCAL_EVIDENCE_CHARS}.`
      })
    };
    return;
  }

  try {
    const result = await withLogsOnStderr(() => analyzeEvidenceLocal(evidence));
    context.res = {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log.error(`Analyze failed: ${message}`);
    context.res = {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
'@

$networkStatsScript = @'
module.exports = async function (context) {
  const { networkStatsLocal, withLogsOnStderr } = require("__RUNTIME_REQUIRE__");
  const stats = await withLogsOnStderr(networkStatsLocal);
  context.res = {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(stats)
  };
};
'@

$networkGraphScript = @'
module.exports = async function (context, req) {
  const { networkGraphLocal, withLogsOnStderr } = require("__RUNTIME_REQUIRE__");
  try {
    const graph = await withLogsOnStderr(() =>
      networkGraphLocal({
        type: req.query && req.query.type,
        minTrust: req.query && req.query.minTrust,
      })
    );
    context.res = {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(graph)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log.error(`Graph failed: ${message}`);
    context.res = {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Failed to build entity graph" })
    };
  }
};
'@

$reportScript = @'
function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.rawBody === "string" && req.rawBody.trim()) {
    try {
      return JSON.parse(req.rawBody);
    } catch {
      return null;
    }
  }
  return null;
}

function header(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function errorStatus(error) {
  return Number.isInteger(error && error.clientStatus) ? error.clientStatus : 500;
}

module.exports = async function (context, req) {
  const { submitReportLocal, withLogsOnStderr } = require("__RUNTIME_REQUIRE__");
  try {
    const result = await withLogsOnStderr(() =>
      submitReportLocal(readBody(req), header(req, "x-api-key"))
    );
    context.res = {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result)
    };
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);
      context.log.error(`Report failed: ${message}`);
    }
    context.res = {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: error instanceof Error && status < 500 ? error.message : "Failed to submit report"
      })
    };
  }
};
'@

$uploadScript = @'
function header(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function rawBuffer(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "binary");
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  return Buffer.alloc(0);
}

function multipartBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  return match ? (match[1] || match[2] || "").trim() : "";
}

function parseFile(req, fieldName, maxBytes) {
  const body = rawBuffer(req);
  if (!body.length) return { status: 400, error: "file is required" };
  if (body.length > maxBytes + 4096) return { status: 413, error: "File is too large. Limit is 8 MB." };

  const boundary = multipartBoundary(header(req, "content-type"));
  if (!boundary) return { status: 415, error: "Expected multipart/form-data upload." };
  const marker = Buffer.from(`--${boundary}`, "latin1");
  const headerBreak = Buffer.from("\r\n\r\n", "latin1");
  let cursor = body.indexOf(marker);
  let scanned = 0;

  while (cursor >= 0 && scanned++ < 8) {
    let partStart = cursor + marker.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    const splitAt = body.indexOf(headerBreak, partStart);
    if (splitAt < 0) break;
    const contentStart = splitAt + headerBreak.length;
    const next = body.indexOf(marker, contentStart);
    if (next < 0) break;
    const rawHeaders = body.subarray(partStart, splitAt).toString("latin1");
    let contentEnd = next;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;
    const disposition = rawHeaders
      .split(/\r\n/)
      .find((line) => /^content-disposition:/i.test(line)) || "";
    const name = /name="([^"]+)"/i.exec(disposition);
    if (!name || name[1] !== fieldName) {
      cursor = next;
      continue;
    }
    const filename = /filename="([^"]*)"/i.exec(disposition);
    const buffer = Buffer.from(body.subarray(contentStart, contentEnd));
    if (!buffer.length) return { status: 400, error: "file is required" };
    if (buffer.length > maxBytes) return { status: 413, error: "File is too large. Limit is 8 MB." };
    return { buffer, fileName: filename && filename[1] ? filename[1] : "upload" };
  }
  return { status: 400, error: "file is required" };
}

function errorStatus(error) {
  return Number.isInteger(error && error.clientStatus) ? error.clientStatus : 500;
}

module.exports = async function (context, req) {
  const { uploadDocumentLocal, withLogsOnStderr } = require("__RUNTIME_REQUIRE__");
  const file = parseFile(req, "file", 8 * 1024 * 1024);
  if (!file.buffer) {
    context.res = {
      status: file.status || 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: file.error || "file is required" })
    };
    return;
  }

  try {
    const result = await withLogsOnStderr(() => uploadDocumentLocal(file.buffer, file.fileName));
    context.res = {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result)
    };
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);
      context.log.error(`Upload failed: ${message}`);
    }
    context.res = {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: error instanceof Error && status < 500 ? error.message : "OCR failed"
      })
    };
  }
};
'@

$transcribeScript = @'
function header(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function rawBuffer(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "binary");
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  return Buffer.alloc(0);
}

function multipartBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  return match ? (match[1] || match[2] || "").trim() : "";
}

function parseFile(req, fieldName, maxBytes) {
  const body = rawBuffer(req);
  if (!body.length) return { status: 400, error: "audio file is required" };
  if (body.length > maxBytes + 4096) return { status: 413, error: "Audio file is too large. Limit is 25 MB." };

  const boundary = multipartBoundary(header(req, "content-type"));
  if (!boundary) return { status: 415, error: "Expected multipart/form-data upload." };
  const marker = Buffer.from(`--${boundary}`, "latin1");
  const headerBreak = Buffer.from("\r\n\r\n", "latin1");
  let cursor = body.indexOf(marker);
  let scanned = 0;

  while (cursor >= 0 && scanned++ < 8) {
    let partStart = cursor + marker.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;
    const splitAt = body.indexOf(headerBreak, partStart);
    if (splitAt < 0) break;
    const contentStart = splitAt + headerBreak.length;
    const next = body.indexOf(marker, contentStart);
    if (next < 0) break;
    const rawHeaders = body.subarray(partStart, splitAt).toString("latin1");
    let contentEnd = next;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;
    const disposition = rawHeaders
      .split(/\r\n/)
      .find((line) => /^content-disposition:/i.test(line)) || "";
    const name = /name="([^"]+)"/i.exec(disposition);
    if (!name || name[1] !== fieldName) {
      cursor = next;
      continue;
    }
    const filename = /filename="([^"]*)"/i.exec(disposition);
    const buffer = Buffer.from(body.subarray(contentStart, contentEnd));
    if (!buffer.length) return { status: 400, error: "audio file is required" };
    if (buffer.length > maxBytes) return { status: 413, error: "Audio file is too large. Limit is 25 MB." };
    return { buffer, fileName: filename && filename[1] ? filename[1] : "recording.webm" };
  }
  return { status: 400, error: "audio file is required" };
}

function errorStatus(error) {
  return Number.isInteger(error && error.clientStatus) ? error.clientStatus : 500;
}

module.exports = async function (context, req) {
  const { transcribeAudioLocal, withLogsOnStderr } = require("__RUNTIME_REQUIRE__");
  const file = parseFile(req, "audio", 25 * 1024 * 1024);
  if (!file.buffer) {
    context.res = {
      status: file.status || 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: file.error || "audio file is required" })
    };
    return;
  }

  try {
    const result = await withLogsOnStderr(() => transcribeAudioLocal(file.buffer, file.fileName));
    context.res = {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result)
    };
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      const message = error instanceof Error ? error.message : String(error);
      context.log.error(`Transcription failed: ${message}`);
    }
    context.res = {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: error instanceof Error && status < 500 ? error.message : "Transcription failed"
      })
    };
  }
};
'@

$chatScript = @'
function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.rawBody === "string" && req.rawBody.trim()) {
    try {
      return JSON.parse(req.rawBody);
    } catch {
      return null;
    }
  }
  return null;
}

function cleanString(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanStringArray(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => cleanString(item, maxChars))
    .filter(Boolean);
}

function parseChatPayload(body) {
  if (!body || typeof body !== "object") return null;
  const rawCtx = body.caseContext;
  const rawMessages = body.messages;
  if (!rawCtx || typeof rawCtx !== "object" || !Array.isArray(rawMessages)) return null;
  if (rawMessages.length === 0 || rawMessages.length > 40) return null;

  const messages = [];
  for (const message of rawMessages) {
    const role = message && message.role === "assistant"
      ? "assistant"
      : message && message.role === "user"
        ? "user"
        : null;
    const content = cleanString(message && message.content, 4000);
    if (!role || !content) return null;
    messages.push({ role, content });
  }

  const score = Number(rawCtx.risk_score);
  const matches = Array.isArray(rawCtx.matches)
    ? rawCtx.matches.slice(0, 10).map((match) => ({
        reportId: cleanString(match && match.reportId, 60),
        scamType: cleanString(match && match.scamType, 80),
        similarity: Number.isFinite(Number(match && match.similarity))
          ? Math.max(0, Math.min(1, Number(match.similarity)))
          : 0,
      }))
    : [];

  return {
    ctx: {
      evidence: cleanString(rawCtx.evidence, 40000),
      risk_level: cleanString(rawCtx.risk_level, 40) || "Unknown",
      risk_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
      case_summary: cleanString(rawCtx.case_summary, 2000),
      red_flags: cleanStringArray(rawCtx.red_flags, 20, 200),
      matches,
    },
    messages,
  };
}

module.exports = async function (context, req) {
  const { chatLocal, withLogsOnStderr } = require("__RUNTIME_REQUIRE__");
  const parsed = parseChatPayload(readBody(req));
  if (!parsed) {
    context.res = {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error:
          "Invalid chat payload: caseContext and messages (1-40 user/assistant turns) are required.",
        code: "CHAT_BAD_PAYLOAD",
        requestId: context.invocationId
      })
    };
    return;
  }

  try {
    const result = await withLogsOnStderr(() => chatLocal(parsed.ctx, parsed.messages));
    context.res = {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log.error(`Chat failed: ${message}`);
    context.res = {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "Chat failed",
        code: "CHAT_RUNTIME_ERROR",
        requestId: context.invocationId
      })
    };
  }
};
'@

$staticScript = @'
const fs = require("fs");
const path = require("path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function clean(raw) {
  const value = raw && String(raw).trim() ? String(raw) : "index.html";
  const normalized = path.normalize(value.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
  return normalized === "." || normalized === path.sep ? "index.html" : normalized;
}

module.exports = async function (context, req) {
  const root = path.join(process.cwd(), "public");
  const requested = clean(req.params.path);
  const candidate = path.resolve(root, requested);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const safeCandidate = candidate.startsWith(rootPrefix) ? candidate : path.join(root, "index.html");
  const file = fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile()
    ? safeCandidate
    : path.join(root, "index.html");
  const ext = path.extname(file).toLowerCase();

  context.res = {
    status: 200,
    headers: {
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
    },
    body: fs.readFileSync(file)
  };
};
'@

$healthScript = $healthScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$analyzeScript = $analyzeScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$networkStatsScript = $networkStatsScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$networkGraphScript = $networkGraphScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$reportScript = $reportScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$uploadScript = $uploadScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$transcribeScript = $transcribeScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)
$chatScript = $chatScript.Replace("__RUNTIME_REQUIRE__", $runtimeRequire)

Write-Function -Name "health" -Route "health" -Methods @("get") -Script $healthScript
Write-Function -Name "analyze" -Route "analyze" -Methods @("post") -Script $analyzeScript
Write-Function -Name "networkStats" -Route "network/stats" -Methods @("get") -Script $networkStatsScript
Write-Function -Name "networkGraph" -Route "network/graph" -Methods @("get") -Script $networkGraphScript
Write-Function -Name "report" -Route "report" -Methods @("post") -Script $reportScript
Write-Function -Name "upload" -Route "upload" -Methods @("post") -Script $uploadScript
Write-Function -Name "transcribe" -Route "transcribe" -Methods @("post") -Script $transcribeScript
Write-Function -Name "chat" -Route "chat" -Methods @("post") -Script $chatScript
Write-Function -Name "static" -Route "{*path}" -Methods @("get") -Script $staticScript

if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force
}
Compress-Archive -Path (Join-Path $StagePath "*") -DestinationPath $OutputPath -Force

Write-Output $OutputPath
