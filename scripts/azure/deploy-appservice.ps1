param(
  [string]$ResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-kkgawatlh9-6623" }),
  [string]$AppName = $(if ($env:AZURE_FUNCTION_APP_NAME) { $env:AZURE_FUNCTION_APP_NAME } else { "vmi-online-3907" }),
  [string]$ZipPath = "dist-functions.zip",
  [string]$AuthAppName = $(if ($env:AUTH_APP_NAME) { $env:AUTH_APP_NAME } else { "$AppName-auth" }),
  [switch]$SkipBuild,
  [switch]$AllowMissingTelemetry
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ZipFullPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $ZipPath))

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

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

function Add-Setting {
  param(
    [System.Collections.IDictionary]$Map,
    [string]$Name,
    [string]$Value
  )
  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $Map[$Name] = $Value
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

function Require-Env {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not (Test-UsableValue $value)) {
    throw "$Name is required for live deployment and cannot be a <placeholder> value."
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

function Require-AppInsights {
  if (-not (Test-UsableValue $env:APPLICATIONINSIGHTS_CONNECTION_STRING)) {
    throw "APPLICATIONINSIGHTS_CONNECTION_STRING is required for live deployment and cannot be a <placeholder> value."
  }
  if ($env:APPLICATIONINSIGHTS_CONNECTION_STRING -notmatch "(^|;)InstrumentationKey=") {
    throw "APPLICATIONINSIGHTS_CONNECTION_STRING must be a real Azure Monitor connection string containing InstrumentationKey=."
  }
}

function Get-AzAccount {
  try {
    $json = & az account show -o json 2>$null
    $exitCode = $LASTEXITCODE
  } catch {
    throw "Azure CLI is not logged in. Run az login first, then rerun npm run azure:deploy:appservice."
  }
  if ($exitCode -ne 0 -or -not $json) {
    throw "Azure CLI is not logged in. Run az login first, then rerun npm run azure:deploy:appservice."
  }
  return $json | ConvertFrom-Json
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

function Ensure-AuthDefaults {
  param(
    [string]$TenantId,
    [string]$WebAppName,
    [string]$AuthRegistrationName
  )

  $issuerValue = [Environment]::GetEnvironmentVariable("AUTH_ISSUER", "Process")
  if (-not (Test-UsableValue $issuerValue)) {
    if (-not (Test-UsableValue $TenantId)) {
      throw "AUTH_ISSUER is missing and the Azure tenant id could not be read from az account show."
    }
    $issuerValue = "https://login.microsoftonline.com/$($TenantId.Trim())/v2.0"
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

Import-DotEnv (Join-Path $RepoRoot ".env")

$account = Get-AzAccount
Import-AppSettingsFromAzure -ResourceGroupName $ResourceGroup -WebAppName $AppName
Ensure-AuthDefaults -TenantId $account.tenantId -WebAppName $AppName -AuthRegistrationName $AuthAppName
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
if (-not $AllowMissingTelemetry) {
  Require-AppInsights
}

Write-Host "Deploying $AppName in $ResourceGroup using subscription $($account.name)"

Push-Location $RepoRoot
$SettingsJsonPath = $null
try {
  if (-not $SkipBuild) {
    Invoke-Checked { npm run build:functions }
  }
  if (-not (Test-Path -LiteralPath $ZipFullPath)) {
    throw "Deployment package not found: $ZipFullPath"
  }

  $settings = [ordered]@{}
  $settings["NODE_ENV"] = "production"
  $settings["TRUST_PROXY"] = "1"
  $settings["FUNCTIONS_EXTENSION_VERSION"] = "~4"
  $settings["FUNCTIONS_WORKER_RUNTIME"] = "node"
  $settings["WEBSITE_NODE_DEFAULT_VERSION"] = "~20"
  $settings["SCM_DO_BUILD_DURING_DEPLOYMENT"] = "false"

  Add-Setting $settings "AZURE_AI_PROJECT_ENDPOINT" $env:AZURE_AI_PROJECT_ENDPOINT
  Add-Setting $settings "AZURE_AI_MODEL_DEPLOYMENT" $env:AZURE_AI_MODEL_DEPLOYMENT
  Add-Setting $settings "AZURE_SEARCH_ENDPOINT" $env:AZURE_SEARCH_ENDPOINT
  Add-Setting $settings "AZURE_SEARCH_INDEX" $env:AZURE_SEARCH_INDEX
  Add-Setting $settings "AZURE_SEARCH_API_KEY" $env:AZURE_SEARCH_API_KEY
  Add-Setting $settings "AZURE_SEARCH_KNOWLEDGE_BASE" $env:AZURE_SEARCH_KNOWLEDGE_BASE
  Add-Setting $settings "AZURE_OPENAI_ENDPOINT" $env:AZURE_OPENAI_ENDPOINT
  Add-Setting $settings "AZURE_OPENAI_EMBED_DEPLOYMENT" $env:AZURE_OPENAI_EMBED_DEPLOYMENT
  Add-Setting $settings "AZURE_OPENAI_KEY" $env:AZURE_OPENAI_KEY
  Add-Setting $settings "AZURE_DOCINT_ENDPOINT" $env:AZURE_DOCINT_ENDPOINT
  Add-Setting $settings "AZURE_DOCINT_KEY" $env:AZURE_DOCINT_KEY
  Add-Setting $settings "AZURE_SPEECH_REGION" $env:AZURE_SPEECH_REGION
  Add-Setting $settings "AZURE_SPEECH_KEY" $env:AZURE_SPEECH_KEY
  Add-Setting $settings "AZURE_SPEECH_LOCALES" $env:AZURE_SPEECH_LOCALES
  Add-Setting $settings "APPLICATIONINSIGHTS_CONNECTION_STRING" $env:APPLICATIONINSIGHTS_CONNECTION_STRING
  Add-Setting $settings "COSMOS_CONNECTION_STRING" $env:COSMOS_CONNECTION_STRING
  Add-Setting $settings "COSMOS_PII_CONNECTION_STRING" $env:COSMOS_PII_CONNECTION_STRING
  Add-Setting $settings "COSMOS_DB" $env:COSMOS_DB
  Add-Setting $settings "COSMOS_SHARE_TTL_DAYS" $env:COSMOS_SHARE_TTL_DAYS
  Add-Setting $settings "COSMOS_CASE_RETENTION_DAYS" $env:COSMOS_CASE_RETENTION_DAYS
  Add-Setting $settings "SERVICEBUS_CONNECTION_STRING" $env:SERVICEBUS_CONNECTION_STRING
  Add-Setting $settings "SERVICEBUS_QUEUE" $env:SERVICEBUS_QUEUE
  Add-Setting $settings "URL_UNWRAP_ENABLED" $env:URL_UNWRAP_ENABLED
  Add-Setting $settings "WHOIS_LOOKUP_ENABLED" $env:WHOIS_LOOKUP_ENABLED
  Add-Setting $settings "WHOISJSON_API_KEY" $env:WHOISJSON_API_KEY
  Add-Setting $settings "DOMSCAN_API_KEY" $env:DOMSCAN_API_KEY
  Add-Setting $settings "ABSTRACT_EMAIL_REPUTATION_KEY" $env:ABSTRACT_EMAIL_REPUTATION_KEY
  Add-Setting $settings "ABSTRACT_PHONE_KEY" $env:ABSTRACT_PHONE_KEY
  Add-Setting $settings "ABSTRACT_COMPANY_KEY" $env:ABSTRACT_COMPANY_KEY
  Add-Setting $settings "ABSTRACT_IP_KEY" $env:ABSTRACT_IP_KEY
  Add-Setting $settings "OPENCORPORATES_API_KEY" $env:OPENCORPORATES_API_KEY
  Add-Setting $settings "SERPAPI_API_KEY" $env:SERPAPI_API_KEY
  Add-Setting $settings "NEWSAPI_API_KEY" $env:NEWSAPI_API_KEY
  Add-Setting $settings "GNEWS_API_KEY" $env:GNEWS_API_KEY
  Add-Setting $settings "VMI_REPORT_API_KEY" $env:VMI_REPORT_API_KEY
  Add-Setting $settings "VMI_ALLOW_PUBLIC_REPORTS" $env:VMI_ALLOW_PUBLIC_REPORTS
  Add-Setting $settings "AUTH_ISSUER" $env:AUTH_ISSUER
  Add-Setting $settings "AUTH_AUDIENCE" $env:AUTH_AUDIENCE
  Add-Setting $settings "AUTH_JWKS_URI" $env:AUTH_JWKS_URI
  Add-Setting $settings "AUTH_ANON_SALT" $env:AUTH_ANON_SALT
  Add-Setting $settings "AUTH_SIGNED_IN_MONTHLY_MAX" $env:AUTH_SIGNED_IN_MONTHLY_MAX
  Add-Setting $settings "AUTH_ANON_TRIAL_MAX" $env:AUTH_ANON_TRIAL_MAX
  Add-Setting $settings "AUTH_ANON_TRIAL_DAYS" $env:AUTH_ANON_TRIAL_DAYS
  Add-Setting $settings "AUTH_ADMIN_EMAILS" $env:AUTH_ADMIN_EMAILS
  Add-Setting $settings "VITE_AUTH_CLIENT_ID" $env:VITE_AUTH_CLIENT_ID
  Add-Setting $settings "VITE_AUTH_AUTHORITY" $env:VITE_AUTH_AUTHORITY
  Add-Setting $settings "VITE_AUTH_SCOPE" $env:VITE_AUTH_SCOPE
  Add-Setting $settings "VITE_AUTH_REDIRECT_URI" $env:VITE_AUTH_REDIRECT_URI
  Add-Setting $settings "AZURE_STORAGE_ACCOUNT" $env:AZURE_STORAGE_ACCOUNT
  Add-Setting $settings "AZURE_STORAGE_CONNECTION_STRING" $env:AZURE_STORAGE_CONNECTION_STRING

  $SettingsJsonPath = Join-Path ([System.IO.Path]::GetTempPath()) ("vmi-appsettings-" + [guid]::NewGuid().ToString("N") + ".json")
  $settings | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $SettingsJsonPath -Encoding UTF8 -NoNewline

  Invoke-Checked {
    az webapp config appsettings set `
      --resource-group $ResourceGroup `
      --name $AppName `
      --settings "@$SettingsJsonPath" `
      --output none
  }

  Invoke-Checked {
    az functionapp deployment source config-zip `
      --resource-group $ResourceGroup `
      --name $AppName `
      --src $ZipFullPath `
      --build-remote false `
      --output none
  }

  $defaultHost = az webapp show --resource-group $ResourceGroup --name $AppName --query defaultHostName -o tsv
  if (-not $defaultHost) {
    throw "Deployment completed, but Azure did not return a default hostname."
  }

  Write-Host "Deployed: https://$defaultHost"
  Write-Host "Validate: npm run online:smoke -- --url https://$defaultHost --require-foundry$(if ($AllowMissingTelemetry) { '' } else { ' --require-telemetry' })"
} finally {
  if ($SettingsJsonPath -and (Test-Path -LiteralPath $SettingsJsonPath)) {
    Remove-Item -LiteralPath $SettingsJsonPath -Force
  }
  Pop-Location
}
