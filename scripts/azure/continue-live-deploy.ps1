param(
  [string]$ResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-kkgawatlh9-6623" }),
  [string]$AppName = $(if ($env:AZURE_FUNCTION_APP_NAME) { $env:AZURE_FUNCTION_APP_NAME } else { "vmi-online-3907" }),
  [string]$Subscription = $(if ($env:AZURE_SUBSCRIPTION_ID) { $env:AZURE_SUBSCRIPTION_ID } else { "f85dbc26-9b86-481a-be2e-8f5761c92813" }),
  [string]$AppInsightsName = $env:APPLICATIONINSIGHTS_NAME,
  [string]$AuthAppName = $(if ($env:AUTH_APP_NAME) { $env:AUTH_APP_NAME } else { "$AppName-auth" }),
  [switch]$SkipDeploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

function Require-Env {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not (Test-UsableValue $value)) {
    throw "$Name must be set to a real value before live deploy."
  }
}

function Require-EnvGroup {
  param([string[]]$Names)
  $missing = @()
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not (Test-UsableValue $value)) {
      $missing += $name
    }
  }
  if ($missing.Count -gt 0) {
    throw "Missing live settings that cannot be derived automatically: $($missing -join ', ')."
  }
}

function Require-PositiveIntegerEnv {
  param([string]$Name)
  Require-Env $Name
  [int]$parsed = 0
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [int]::TryParse($value, [ref]$parsed) -or $parsed -le 0) {
    throw "$Name must be a positive integer."
  }
}

function Test-UsableValue {
  param([AllowNull()][string]$Value)
  return (-not [string]::IsNullOrWhiteSpace($Value)) -and -not $Value.Contains("<") -and -not $Value.Contains(">")
}

function Set-EnvIfMissing {
  param(
    [string]$Name,
    [AllowNull()][string]$Value,
    [string]$Source
  )
  $current = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ((-not (Test-UsableValue $current)) -and (Test-UsableValue $Value)) {
    [Environment]::SetEnvironmentVariable($Name, $Value.Trim(), "Process")
    Write-Host "Derived $Name from $Source."
  }
}

function Test-PositiveIntegerValue {
  param([AllowNull()][string]$Value)
  [int]$parsed = 0
  return (Test-UsableValue $Value) -and [int]::TryParse($Value, [ref]$parsed) -and $parsed -gt 0
}

function Set-PositiveIntegerEnvDefault {
  param(
    [string]$Name,
    [int]$Value,
    [string]$Source
  )
  $current = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not (Test-PositiveIntegerValue $current)) {
    [Environment]::SetEnvironmentVariable($Name, [string]$Value, "Process")
    Write-Host "Defaulted $Name to $Value from $Source."
  }
}

function Get-FirstUsableEnvValue {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (Test-UsableValue $value) {
      return $value.Trim()
    }
  }
  return $null
}

function Get-AuthorityFromIssuer {
  param([string]$Issuer)
  return $Issuer.Trim().TrimEnd("/") -replace "/v2\.0$", ""
}

function Get-AuthClientIdCandidate {
  $clientId = Get-FirstUsableEnvValue @("AUTH_CLIENT_ID", "VITE_AUTH_CLIENT_ID")
  if (Test-UsableValue $clientId) {
    return $clientId
  }

  $audience = [Environment]::GetEnvironmentVariable("AUTH_AUDIENCE", "Process")
  if (-not (Test-UsableValue $audience)) {
    return $null
  }

  foreach ($entry in ($audience -split ",")) {
    $candidate = $entry.Trim()
    if ($candidate.StartsWith("api://")) {
      $candidate = $candidate.Substring(6)
    }
    if ($candidate -match "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$") {
      return $candidate
    }
  }
  return $null
}

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Ensure-BetaLaunchDefaults {
  Set-EnvIfMissing "NODE_ENV" "production" "live deploy defaults"
  Set-EnvIfMissing "TRUST_PROXY" "1" "Azure App Service ingress"
  Set-PositiveIntegerEnvDefault "AUTH_SIGNED_IN_MONTHLY_MAX" 25 "public beta quota default"
  Set-PositiveIntegerEnvDefault "AUTH_ANON_TRIAL_MAX" 1 "public beta quota default"
  Set-PositiveIntegerEnvDefault "AUTH_ANON_TRIAL_DAYS" 30 "public beta quota default"
  Set-PositiveIntegerEnvDefault "COSMOS_SHARE_TTL_DAYS" 30 "public beta retention default"
  Set-PositiveIntegerEnvDefault "COSMOS_CASE_RETENTION_DAYS" 365 "public beta retention default"

  $salt = [Environment]::GetEnvironmentVariable("AUTH_ANON_SALT", "Process")
  if (-not (Test-UsableValue $salt)) {
    [Environment]::SetEnvironmentVariable("AUTH_ANON_SALT", (New-RandomSecret), "Process")
    Write-Host "Generated AUTH_ANON_SALT for this live deployment."
  }

  if (-not (Test-UsableValue $env:VMI_REPORT_API_KEY) -and $env:VMI_ALLOW_PUBLIC_REPORTS -ne "1") {
    [Environment]::SetEnvironmentVariable("VMI_ALLOW_PUBLIC_REPORTS", "1", "Process")
    Write-Host "Enabled public report intake for the public beta."
  }
}

function ConvertFrom-AzJson {
  param([AllowNull()][string]$Json)
  if (-not (Test-UsableValue $Json) -or $Json.Trim() -eq "null") {
    return $null
  }
  return $Json | ConvertFrom-Json
}

function Get-EntraAuthApp {
  param([string]$DisplayName)
  $json = az ad app list `
    --display-name $DisplayName `
    --query "[0].{appId:appId,id:id,displayName:displayName}" `
    -o json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not search Entra app registrations. Check that your signed-in account can read app registrations."
  }
  return ConvertFrom-AzJson $json
}

function New-EntraAuthApp {
  param([string]$DisplayName)
  Write-Host "Creating Entra auth app registration: $DisplayName"
  $json = az ad app create `
    --display-name $DisplayName `
    --sign-in-audience AzureADMyOrg `
    --query "{appId:appId,id:id,displayName:displayName}" `
    -o json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the Entra app registration. Create one manually, then set AUTH_CLIENT_ID to its Application/client ID."
  }
  return ConvertFrom-AzJson $json
}

function Get-AccessAsUserScopeId {
  param([string]$AppId)
  $scopeId = az ad app show `
    --id $AppId `
    --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" `
    -o tsv
  if ($LASTEXITCODE -ne 0 -or -not (Test-UsableValue $scopeId)) {
    return [guid]::NewGuid().ToString()
  }
  return $scopeId.Trim()
}

function Set-EntraAuthAppManifest {
  param(
    [string]$ObjectId,
    [string]$AppId,
    [string]$RedirectUri
  )
  $scopeId = Get-AccessAsUserScopeId -AppId $AppId
  $manifest = [ordered]@{
    identifierUris = @("api://$AppId")
    spa = @{
      redirectUris = @($RedirectUri)
    }
    api = @{
      requestedAccessTokenVersion = 2
      oauth2PermissionScopes = @(
        [ordered]@{
          adminConsentDescription = "Allow Verify My Interview to access the API on behalf of the signed-in user."
          adminConsentDisplayName = "Access Verify My Interview"
          id = $scopeId
          isEnabled = $true
          type = "User"
          userConsentDescription = "Allow Verify My Interview to verify job opportunities on your behalf."
          userConsentDisplayName = "Use Verify My Interview"
          value = "access_as_user"
        }
      )
    }
  }

  $manifestPath = Join-Path ([System.IO.Path]::GetTempPath()) ("vmi-auth-app-" + [guid]::NewGuid().ToString("N") + ".json")
  try {
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 -NoNewline
    az rest `
      --method PATCH `
      --uri "https://graph.microsoft.com/v1.0/applications/$ObjectId" `
      --headers "Content-Type=application/json" `
      --body "@$manifestPath" `
      --output none
    if ($LASTEXITCODE -ne 0) {
      throw "Could not configure the Entra auth app manifest."
    }
  } finally {
    if (Test-Path -LiteralPath $manifestPath) {
      Remove-Item -LiteralPath $manifestPath -Force
    }
  }
}

function Ensure-EntraAuthApp {
  param(
    [string]$DisplayName,
    [string]$RedirectUri
  )
  $app = Get-EntraAuthApp -DisplayName $DisplayName
  if (-not $app) {
    $app = New-EntraAuthApp -DisplayName $DisplayName
  } else {
    Write-Host "Using Entra auth app registration: $($app.displayName)"
  }
  if (-not (Test-UsableValue $app.appId) -or -not (Test-UsableValue $app.id)) {
    throw "The Entra app registration did not return a usable appId/object id."
  }
  Set-EntraAuthAppManifest -ObjectId $app.id -AppId $app.appId -RedirectUri $RedirectUri
  return $app.appId
}

function Ensure-AuthDefaults {
  param(
    [string]$WebAppName,
    [string]$AuthRegistrationName
  )

  $issuerValue = [Environment]::GetEnvironmentVariable("AUTH_ISSUER", "Process")
  if (-not (Test-UsableValue $issuerValue)) {
    $tenantId = az account show --query tenantId -o tsv
    if ($LASTEXITCODE -ne 0 -or -not (Test-UsableValue $tenantId)) {
      throw "AUTH_ISSUER is missing and the Azure tenant id could not be read. Run az login, then rerun this command."
    }
    $issuerValue = "https://login.microsoftonline.com/$($tenantId.Trim())/v2.0"
    [Environment]::SetEnvironmentVariable("AUTH_ISSUER", $issuerValue, "Process")
    Write-Host "Derived AUTH_ISSUER from current Azure tenant: $issuerValue"
  }

  Set-EnvIfMissing "VITE_AUTH_AUTHORITY" (Get-AuthorityFromIssuer $issuerValue) "AUTH_ISSUER"
  Set-EnvIfMissing "VITE_AUTH_REDIRECT_URI" "https://$WebAppName.azurewebsites.net/auth/callback" "App Service URL"

  $clientId = Get-AuthClientIdCandidate
  if (-not (Test-UsableValue $clientId)) {
    $redirectUri = Get-FirstUsableEnvValue @("VITE_AUTH_REDIRECT_URI")
    $clientId = Ensure-EntraAuthApp -DisplayName $AuthRegistrationName -RedirectUri $redirectUri
  }
  if (Test-UsableValue $clientId) {
    Set-EnvIfMissing "AUTH_CLIENT_ID" $clientId "existing auth configuration"
    Set-EnvIfMissing "VITE_AUTH_CLIENT_ID" $clientId "existing auth configuration"
    Set-EnvIfMissing "AUTH_AUDIENCE" "$clientId,api://$clientId" "auth client id"
    Set-EnvIfMissing "VITE_AUTH_SCOPE" "api://$clientId/access_as_user" "auth client id"
  }
}

function Import-DotEnv {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }
    $idx = $trimmed.IndexOf("=")
    $name = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
    if ($name -and -not [Environment]::GetEnvironmentVariable($name, "Process")) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Select-AppInsightsName {
  param(
    [string[]]$Names,
    [string]$RequestedName,
    [string]$WebAppName
  )
  if ($RequestedName) {
    return $RequestedName
  }
  if ($Names.Count -eq 0) {
    throw "No Application Insights resource found in $ResourceGroup. Create one or pass -AppInsightsName."
  }

  $preferred = @(
    $WebAppName,
    "$WebAppName-appinsights",
    "$WebAppName-ai"
  )
  foreach ($candidate in $preferred) {
    if ($Names -contains $candidate) {
      return $candidate
    }
  }

  if ($Names.Count -eq 1) {
    return $Names[0]
  }

  throw "Multiple Application Insights resources found: $($Names -join ', '). Rerun with -AppInsightsName <name>."
}

function Import-AppSettingsFromAzure {
  param(
    [string]$ResourceGroupName,
    [string]$WebAppName
  )
  $json = az webapp config appsettings list `
    --resource-group $ResourceGroupName `
    --name $WebAppName `
    -o json
  if ($LASTEXITCODE -ne 0 -or -not $json) {
    Write-Warning "Could not read existing App Service settings for $WebAppName."
    return
  }
  $settings = $json | ConvertFrom-Json
  foreach ($setting in $settings) {
    if (-not $setting.name) {
      continue
    }
    $current = [Environment]::GetEnvironmentVariable($setting.name, "Process")
    if ([string]::IsNullOrWhiteSpace($current) -and -not [string]::IsNullOrWhiteSpace($setting.value)) {
      [Environment]::SetEnvironmentVariable($setting.name, [string]$setting.value, "Process")
    }
  }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Import-DotEnv (Join-Path $RepoRoot ".env")

Write-Host "Selecting subscription $Subscription"
Invoke-Checked { az account set --subscription $Subscription }
Invoke-Checked { az account show -o table }

if (-not $AppInsightsName) {
  $names = @(az resource list `
    --resource-group $ResourceGroup `
    --resource-type Microsoft.Insights/components `
    --query "[].name" `
    -o tsv)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not list Application Insights resources."
  }
  $AppInsightsName = Select-AppInsightsName -Names $names -RequestedName $AppInsightsName -WebAppName $AppName
}

Write-Host "Using Application Insights: $AppInsightsName"
$env:APPLICATIONINSIGHTS_CONNECTION_STRING = az monitor app-insights component show `
  --resource-group $ResourceGroup `
  --app $AppInsightsName `
  --query connectionString `
  -o tsv
if ($LASTEXITCODE -ne 0 -or -not $env:APPLICATIONINSIGHTS_CONNECTION_STRING) {
  throw "Could not read Application Insights connection string for $AppInsightsName."
}

Import-AppSettingsFromAzure -ResourceGroupName $ResourceGroup -WebAppName $AppName
Ensure-AuthDefaults -WebAppName $AppName -AuthRegistrationName $AuthAppName
Ensure-BetaLaunchDefaults

Require-EnvGroup @(
  "AZURE_AI_PROJECT_ENDPOINT",
  "AZURE_AI_MODEL_DEPLOYMENT",
  "COSMOS_CONNECTION_STRING",
  "AUTH_ISSUER",
  "AUTH_AUDIENCE",
  "VITE_AUTH_CLIENT_ID",
  "VITE_AUTH_AUTHORITY",
  "VITE_AUTH_SCOPE",
  "AUTH_ANON_SALT",
  "TRUST_PROXY"
)
Require-PositiveIntegerEnv "AUTH_SIGNED_IN_MONTHLY_MAX"

Push-Location $RepoRoot
try {
  Invoke-Checked { npm run azure:doctor -- --require-live }
  if (-not $SkipDeploy) {
    Invoke-Checked { npm run azure:deploy:appservice }
  }
  Invoke-Checked {
    npm run online:smoke -- --url "https://$AppName.azurewebsites.net" --require-foundry --require-telemetry
  }
} finally {
  Pop-Location
}
