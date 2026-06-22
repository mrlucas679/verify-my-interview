param(
  [string]$Url = $(if ($env:VMI_LIVE_URL) { $env:VMI_LIVE_URL } else { "https://vmi-online-3907.azurewebsites.net" }),
  [string]$OutputDir,
  [string]$BrowserPath,
  [int]$RenderTimeoutMs = 15000,
  [switch]$SkipScreenshots
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $OutputDir) {
  $OutputDir = Join-Path $RepoRoot "output\playwright"
}

function Join-UrlPath {
  param(
    [string]$BaseUrl,
    [string]$Path
  )
  return "$($BaseUrl.TrimEnd('/'))/$($Path.TrimStart('/'))"
}

function Get-BrowserPath {
  param([AllowNull()][string]$RequestedPath)
  if ($RequestedPath -and (Test-Path -LiteralPath $RequestedPath)) {
    return $RequestedPath
  }
  $paths = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) {
      return $path
    }
  }
  throw "Could not find Microsoft Edge or Google Chrome. Install one browser or pass -BrowserPath."
}

function ConvertTo-ProcessArgument {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value -or $Value.Length -eq 0) {
    return '""'
  }
  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $result = '"'
  $backslashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq '\') {
      $backslashes += 1
      continue
    }
    if ($char -eq '"') {
      $result += ('\' * (($backslashes * 2) + 1))
      $result += '"'
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      $result += ('\' * $backslashes)
      $backslashes = 0
    }
    $result += $char
  }
  if ($backslashes -gt 0) {
    $result += ('\' * ($backslashes * 2))
  }
  $result += '"'
  return $result
}

function Invoke-BrowserProcess {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [string]$Description
  )
  $processTimeoutMs = [Math]::Max($RenderTimeoutMs + 15000, 30000)
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $startInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' '

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Could not start browser for $Description."
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($processTimeoutMs)) {
    try {
      $process.Kill($true)
    } catch {
      $process.Kill()
    }
    throw "Browser timed out during $Description after $processTimeoutMs ms."
  }
  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Stdout = $stdoutTask.GetAwaiter().GetResult()
    Stderr = $stderrTask.GetAwaiter().GetResult()
  }
}

function Format-BrowserOutput {
  param([pscustomobject]$Result)
  $parts = @()
  if ($Result.Stdout) {
    $parts += $Result.Stdout
  }
  if ($Result.Stderr) {
    $parts += $Result.Stderr
  }
  return $parts -join "`n"
}

function Invoke-BrowserScreenshot {
  param(
    [string]$Executable,
    [string]$TargetUrl,
    [string]$Path,
    [int]$Width,
    [int]$Height
  )
  $profileDir = Join-Path $OutputDir "browser-profile-$Width-$Height"
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  $args = @(
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--user-data-dir=$profileDir",
    "--virtual-time-budget=$RenderTimeoutMs",
    "--window-size=$Width,$Height",
    "--screenshot=$Path",
    $TargetUrl
  )
  $result = Invoke-BrowserProcess -Executable $Executable -Arguments $args -Description "screenshot $Width x $Height"
  if ($result.ExitCode -ne 0) {
    throw "Browser screenshot failed for $TargetUrl with exit code $($result.ExitCode). Output: $(Format-BrowserOutput -Result $result)"
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Browser did not create screenshot: $Path"
  }
}

function Invoke-BrowserDom {
  param(
    [string]$Executable,
    [string]$TargetUrl
  )
  $profileDir = Join-Path $OutputDir "browser-profile-dom"
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  $args = @(
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--user-data-dir=$profileDir",
    "--virtual-time-budget=$RenderTimeoutMs",
    "--dump-dom",
    $TargetUrl
  )
  $result = Invoke-BrowserProcess -Executable $Executable -Arguments $args -Description "render check"
  if ($result.ExitCode -ne 0) {
    throw "Browser render check failed for $TargetUrl with exit code $($result.ExitCode). Output: $(Format-BrowserOutput -Result $result)"
  }
  return Format-BrowserOutput -Result $result
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$healthUrl = Join-UrlPath $Url "health"
$health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing
if ($health.StatusCode -ne 200) {
  throw "Health check failed: $healthUrl returned $($health.StatusCode)."
}
$healthPath = Join-Path $OutputDir "live-health.json"
$health.Content | Set-Content -LiteralPath $healthPath -Encoding UTF8

$homeResponse = Invoke-WebRequest -Uri $Url -UseBasicParsing
if ($homeResponse.StatusCode -ne 200) {
  throw "Home page failed: $Url returned $($homeResponse.StatusCode)."
}

Write-Host "Health: PASS ($healthUrl)"
Write-Host "Home:   PASS ($Url)"
Write-Host "Saved:  $healthPath"

if ($SkipScreenshots) {
  return
}

$browser = Get-BrowserPath -RequestedPath $BrowserPath
$dom = Invoke-BrowserDom -Executable $browser -TargetUrl $Url
$readyText = "Verify a job before you trust it"
$fallbackText = "Opening your check workspace"
if ($dom -notmatch [regex]::Escape($readyText)) {
  $hint = if ($dom -match [regex]::Escape($fallbackText)) {
    "The page is still showing the route-loading fallback. This usually means the JavaScript route chunk did not load, hydration is stuck, or the browser captured too early."
  } else {
    "The page returned HTML but the expected workspace content was not rendered."
  }
  throw "Live UI render check failed for $Url. Expected '$readyText'. $hint"
}

$desktopPath = Join-Path $OutputDir "live-desktop-1440.png"
$mobilePath = Join-Path $OutputDir "live-mobile-390.png"

Invoke-BrowserScreenshot -Executable $browser -TargetUrl $Url -Path $desktopPath -Width 1440 -Height 1100
Invoke-BrowserScreenshot -Executable $browser -TargetUrl $Url -Path $mobilePath -Width 390 -Height 844

Write-Host "Render: PASS ($readyText)"
Write-Host "Desktop screenshot: $desktopPath"
Write-Host "Mobile screenshot:  $mobilePath"
