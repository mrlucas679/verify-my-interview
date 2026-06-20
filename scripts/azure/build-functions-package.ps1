param(
  [string]$OutputDir = "dist-functions",
  [string]$ZipPath = "dist-functions.zip",
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PackageDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot (Join-Path $OutputDir "package")))
$ZipFullPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ZipPath))

function Assert-InRepo {
  param([string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside the repo: $full"
  }
}

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

function Write-Text {
  param([string]$Path, [string]$Value)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Set-Content -LiteralPath $Path -Value $Value -Encoding ASCII
}

function Write-JsonFile {
  param([string]$Path, [object]$Value)
  Write-Text $Path (($Value | ConvertTo-Json -Depth 12) + "`n")
}

function New-HttpFunction {
  param(
    [string]$Name,
    [string]$Route,
    [string[]]$Methods,
    [string]$Body
  )
  $dir = Join-Path $PackageDir $Name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-JsonFile (Join-Path $dir "function.json") @{
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
  }
  Write-Text (Join-Path $dir "index.js") $Body
}

function Patch-ImportMeta {
  param([string]$BundlePath)
  $content = Get-Content -Raw -LiteralPath $BundlePath
  $patched = [regex]::Replace(
    $content,
    "var (import_meta\d*) = \{\};",
    'var $1 = { url: require("url").pathToFileURL(__filename).href };'
  )
  if ($patched -eq $content) {
    Write-Warning "No import.meta shim was needed in bundle.cjs"
  }
  Set-Content -LiteralPath $BundlePath -Value $patched -Encoding UTF8
}

Assert-InRepo $PackageDir
Assert-InRepo $ZipFullPath

Push-Location $RepoRoot
try {
  if (-not $SkipBuild) {
    Invoke-Checked { npm run build }
  }

  if (Test-Path -LiteralPath $PackageDir) {
    Remove-Item -LiteralPath $PackageDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

  Write-JsonFile (Join-Path $PackageDir "host.json") @{
    version = "2.0"
    extensions = @{
      http = @{
        routePrefix = ""
      }
    }
  }

  Write-JsonFile (Join-Path $PackageDir "package.json") @{
    name = "verify-my-interview-functions"
    version = "0.1.0"
    private = $true
  }

  Copy-Item -Path (Join-Path $RepoRoot "public") -Destination (Join-Path $PackageDir "public") -Recurse

  Invoke-Checked {
    npx esbuild src/backend/local/appTools.ts --bundle --platform=node --target=node20 --format=cjs --outfile="$PackageDir\bundle.cjs" --log-level=warning
  }
  Patch-ImportMeta (Join-Path $PackageDir "bundle.cjs")

  $headers = @'
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; upgrade-insecure-requests",
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=()"
};

function securityHeaders(contentType, extra = {}) {
  return {
    "content-type": contentType,
    ...SECURITY_HEADERS,
    ...extra
  };
}

module.exports = { securityHeaders };
'@
  Write-Text (Join-Path $PackageDir "headers.js") $headers

  $jsonHelpers = @'
const { securityHeaders } = require("./headers");

function json(status, body) {
  return {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
    body: JSON.stringify(body)
  };
}

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

function errorStatus(error) {
  return Number.isInteger(error && error.clientStatus) ? error.clientStatus : 500;
}

module.exports = { errorStatus, json, readBody };
'@
  Write-Text (Join-Path $PackageDir "jsonResponse.js") $jsonHelpers

  New-HttpFunction "health" "health" @("get") @'
const { json } = require("../jsonResponse");

module.exports = async function (context) {
  const { healthSnapshot } = require("../bundle.cjs");
  context.res = json(200, healthSnapshot());
};
'@

  New-HttpFunction "analyze" "analyze" @("post") @'
const { json, readBody } = require("../jsonResponse");

module.exports = async function (context, req) {
  const { analyzeEvidenceLocal, MAX_LOCAL_EVIDENCE_CHARS, withLogsOnStderr } = require("../bundle.cjs");
  const body = readBody(req);
  const evidence = body && typeof body.evidence === "string" ? body.evidence : "";

  if (!evidence.trim()) {
    context.res = json(400, { error: 'Field "evidence" must be a non-empty string.' });
    return;
  }

  if (evidence.length > MAX_LOCAL_EVIDENCE_CHARS) {
    context.res = json(400, {
      error: `Evidence is too long (${evidence.length} chars). Limit is ${MAX_LOCAL_EVIDENCE_CHARS}.`
    });
    return;
  }

  try {
    context.res = json(200, await withLogsOnStderr(() => analyzeEvidenceLocal(evidence)));
  } catch (error) {
    context.log.error(`Analyze failed: ${error instanceof Error ? error.message : String(error)}`);
    context.res = json(500, { error: "Internal server error" });
  }
};
'@

  New-HttpFunction "chat" "chat" @("post") @'
const { json, readBody } = require("../jsonResponse");

module.exports = async function (context, req) {
  const { chatLocal, withLogsOnStderr } = require("../bundle.cjs");
  const body = readBody(req);
  const caseContext = body && body.caseContext;
  const messages = body && Array.isArray(body.messages) ? body.messages : [];

  try {
    context.res = json(200, await withLogsOnStderr(() => chatLocal(caseContext, messages)));
  } catch (error) {
    context.log.error(`Chat failed: ${error instanceof Error ? error.message : String(error)}`);
    context.res = json(500, { error: "The detective could not reply right now." });
  }
};
'@

  New-HttpFunction "report" "report" @("post") @'
const { errorStatus, json, readBody } = require("../jsonResponse");

module.exports = async function (context, req) {
  const { submitReportLocal, withLogsOnStderr } = require("../bundle.cjs");
  const body = readBody(req);

  try {
    context.res = json(201, await withLogsOnStderr(() => submitReportLocal(body || {})));
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      context.log.error(`Report failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    context.res = json(status, {
      error: error instanceof Error && status < 500 ? error.message : "Failed to file report"
    });
  }
};
'@

  New-HttpFunction "share" "share" @("post") @'
const { errorStatus, json, readBody } = require("../jsonResponse");

module.exports = async function (context, req) {
  const { saveSharedReportLocal, withLogsOnStderr } = require("../bundle.cjs");
  const body = readBody(req);

  try {
    context.res = json(201, await withLogsOnStderr(() => saveSharedReportLocal(body && body.result)));
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500) {
      context.log.error(`Share failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    context.res = json(status, {
      error: error instanceof Error && status < 500 ? error.message : "Failed to save shared report"
    });
  }
};
'@

  New-HttpFunction "shared" "shared/{id}" @("get") @'
const { errorStatus, json } = require("../jsonResponse");

module.exports = async function (context, req) {
  const { getSharedReportLocal, withLogsOnStderr } = require("../bundle.cjs");

  try {
    context.res = json(200, {
      result: await withLogsOnStderr(() => getSharedReportLocal(req.params.id || ""))
    });
  } catch (error) {
    const status = errorStatus(error);
    context.res = json(status, {
      error: error instanceof Error && status < 500 ? error.message : "Failed to load shared report"
    });
  }
};
'@

  New-HttpFunction "networkGraph" "network/graph" @("get") @'
const { json } = require("../jsonResponse");

module.exports = async function (context, req) {
  const { networkGraphLocal, withLogsOnStderr } = require("../bundle.cjs");
  const limit = Number(req.query && req.query.limit);
  context.res = json(200, await withLogsOnStderr(() => networkGraphLocal({
    limit: Number.isFinite(limit) ? limit : undefined
  })));
};
'@

  New-HttpFunction "networkStats" "network/stats" @("get") @'
const { json } = require("../jsonResponse");

module.exports = async function (context) {
  const { networkStatsLocal, withLogsOnStderr } = require("../bundle.cjs");
  context.res = json(200, await withLogsOnStderr(() => networkStatsLocal()));
};
'@

  New-HttpFunction "docs" "docs" @("get") @'
const { json } = require("../jsonResponse");

module.exports = async function (context) {
  context.res = json(200, {
    service: "Verify My Interview",
    endpoints: {
      "POST /analyze": "Investigate job/interview evidence",
      "POST /report": "File a community scam report",
      "POST /share": "Save a finished report result for sharing",
      "GET /shared/:id": "Load a previously shared report result",
      "POST /upload": "Extract text from a screenshot or document",
      "POST /transcribe": "Transcribe an audio recording",
      "GET /health": "Subsystem status"
    }
  });
};
'@

  $multipartParser = @'
function header(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function multipartBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  return match ? (match[1] || match[2]).trim() : "";
}

function bodyBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "binary");
  return Buffer.alloc(0);
}

function firstFile(req, fieldName) {
  const boundary = multipartBoundary(header(req, "content-type"));
  if (!boundary) return { status: 415, error: "Expected multipart/form-data upload." };
  const body = bodyBuffer(req);
  const marker = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(marker);
  while (cursor !== -1) {
    const partStart = cursor + marker.length + 2;
    const next = body.indexOf(marker, partStart);
    if (next === -1) break;
    const splitAt = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (splitAt === -1 || splitAt > next) break;
    const rawHeaders = body.subarray(partStart, splitAt).toString("latin1");
    let contentEnd = next;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;
    const disposition = rawHeaders
      .split(/\r\n/)
      .find((line) => line.toLowerCase().startsWith("content-disposition:")) || "";
    if (disposition.includes(`name="${fieldName}"`) && /filename="/i.test(disposition)) {
      const filename = (/filename="([^"]*)"/i.exec(disposition) || [])[1] || "upload.bin";
      return { file: body.subarray(splitAt + 4, contentEnd), filename };
    }
    cursor = next;
  }
  return { status: 400, error: "file is required" };
}

module.exports = { firstFile };
'@
  Write-Text (Join-Path $PackageDir "multipart.js") $multipartParser

  New-HttpFunction "upload" "upload" @("post") @'
const { json } = require("../jsonResponse");
const { firstFile } = require("../multipart");

module.exports = async function (context, req) {
  const { uploadDocumentLocal, withLogsOnStderr } = require("../bundle.cjs");
  const file = firstFile(req, "file");
  if (!file.file) {
    context.res = json(file.status || 400, { error: file.error || "file is required" });
    return;
  }

  try {
    context.res = json(200, await withLogsOnStderr(() => uploadDocumentLocal(file.file, file.filename)));
  } catch (error) {
    context.log.error(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    context.res = json(500, { error: "Could not read that file." });
  }
};
'@

  New-HttpFunction "transcribe" "transcribe" @("post") @'
const { json } = require("../jsonResponse");
const { firstFile } = require("../multipart");

module.exports = async function (context, req) {
  const { transcribeAudioLocal, withLogsOnStderr } = require("../bundle.cjs");
  const file = firstFile(req, "audio");
  if (!file.file) {
    context.res = json(file.status || 400, { error: file.error || "audio file is required" });
    return;
  }

  try {
    context.res = json(200, await withLogsOnStderr(() => transcribeAudioLocal(file.file, file.filename)));
  } catch (error) {
    context.log.error(`Transcribe failed: ${error instanceof Error ? error.message : String(error)}`);
    context.res = json(500, { error: "Could not transcribe that audio." });
  }
};
'@

  New-HttpFunction "static" "{*path}" @("get") @'
const fs = require("fs");
const path = require("path");
const { securityHeaders } = require("../headers");

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
    headers: securityHeaders(TYPES[ext] || "application/octet-stream", {
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
    }),
    body: fs.readFileSync(file)
  };
};
'@

  Get-ChildItem -LiteralPath $PackageDir -Directory | ForEach-Object {
    $index = Join-Path $_.FullName "index.js"
    if (Test-Path -LiteralPath $index) {
      Invoke-Checked { node --check $index }
    }
  }
  Invoke-Checked { node --check (Join-Path $PackageDir "headers.js") }
  Invoke-Checked { node --check (Join-Path $PackageDir "jsonResponse.js") }
  Invoke-Checked { node --check (Join-Path $PackageDir "multipart.js") }
  Invoke-Checked { node -e "const b=require(process.argv[1]); if(!b.healthSnapshot||!b.analyzeEvidenceLocal||!b.saveSharedReportLocal||!b.getSharedReportLocal){process.exit(1)}" (Join-Path $PackageDir "bundle.cjs") }

  if (Test-Path -LiteralPath $ZipFullPath) {
    Remove-Item -LiteralPath $ZipFullPath -Force
  }
  Compress-Archive -Path (Join-Path $PackageDir "*") -DestinationPath $ZipFullPath -Force

  Write-Host "Built Azure Functions package:"
  Write-Host "  Package: $PackageDir"
  Write-Host "  Zip:     $ZipFullPath"
} finally {
  Pop-Location
}
