param(
  [string]$ResourceGroup = $env:AZURE_RESOURCE_GROUP,
  [string]$Location = $(if ($env:AZURE_LOCATION) { $env:AZURE_LOCATION } else { "eastus2" }),
  [string]$AppName = $(if ($env:AZURE_CONTAINER_APP_NAME) { $env:AZURE_CONTAINER_APP_NAME } else { "verify-my-interview" }),
  [string]$ContainerEnv = $(if ($env:AZURE_CONTAINER_APP_ENV) { $env:AZURE_CONTAINER_APP_ENV } else { "vmi-env" }),
  [string]$RegistryName = $env:AZURE_CONTAINER_REGISTRY_NAME,
  [string]$ImageTag = $(Get-Date -Format "yyyyMMddHHmmss"),
  [string]$FoundryResourceId = $env:AZURE_AI_RESOURCE_ID
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

function Import-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return
  }
  foreach ($line in Get-Content $Path) {
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

Import-DotEnv (Join-Path (Get-Location) ".env")

if (-not $ResourceGroup -and $env:AZURE_RESOURCE_GROUP) {
  $ResourceGroup = $env:AZURE_RESOURCE_GROUP
}
if ($env:AZURE_LOCATION) {
  $Location = $env:AZURE_LOCATION
}
if ($env:AZURE_CONTAINER_APP_NAME) {
  $AppName = $env:AZURE_CONTAINER_APP_NAME
}
if ($env:AZURE_CONTAINER_APP_ENV) {
  $ContainerEnv = $env:AZURE_CONTAINER_APP_ENV
}
if (-not $RegistryName -and $env:AZURE_CONTAINER_REGISTRY_NAME) {
  $RegistryName = $env:AZURE_CONTAINER_REGISTRY_NAME
}
if (-not $FoundryResourceId -and $env:AZURE_AI_RESOURCE_ID) {
  $FoundryResourceId = $env:AZURE_AI_RESOURCE_ID
}

if (-not $ResourceGroup) {
  throw "AZURE_RESOURCE_GROUP or -ResourceGroup is required."
}

if (-not $RegistryName) {
  $suffix = -join ((48..57 + 97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
  $RegistryName = "vmireg$suffix"
}

$ImageName = "verify-my-interview"
$LoginServer = "$RegistryName.azurecr.io"
$Image = "$LoginServer/$ImageName`:$ImageTag"

function Test-AzResource {
  param([scriptblock]$Command)
  $previousNativePreference = $null
  if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $previousNativePreference = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }
  & $Command *> $null
  $exitCode = $LASTEXITCODE
  if ($null -ne $previousNativePreference) {
    $PSNativeCommandUseErrorActionPreference = $previousNativePreference
  }
  if ($exitCode -eq 0) {
    return $true
  } else {
    return $false
  }
}

function Ensure-ProviderRegistered {
  param([string]$Namespace)
  $state = az provider show --namespace $Namespace --query registrationState -o tsv
  if ($state -eq "Registered") {
    return
  }
  Write-Host "Registering Azure provider $Namespace"
  az provider register --namespace $Namespace --output none
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 10
    $state = az provider show --namespace $Namespace --query registrationState -o tsv
    if ($state -eq "Registered") {
      return
    }
  }
  throw "Azure provider $Namespace did not reach Registered state."
}

function Add-EnvVar {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$Name,
    [string]$Value
  )
  if ($Value) {
    $List.Add("$Name=$Value")
  }
}

function Add-Secret {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$Name,
    [string]$Value
  )
  if ($Value) {
    $List.Add("$Name=$Value")
  }
}

function Add-SecretRef {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$EnvName,
    [string]$SecretName,
    [string]$Value
  )
  if ($Value) {
    $List.Add("$EnvName=secretref:$SecretName")
  }
}

Write-Host "Deploying $AppName to Azure Container Apps in $ResourceGroup / $Location"

az config set extension.use_dynamic_install=yes_without_prompt --output none
Ensure-ProviderRegistered "Microsoft.App"
Ensure-ProviderRegistered "Microsoft.ContainerRegistry"
Ensure-ProviderRegistered "Microsoft.OperationalInsights"
az group create --name $ResourceGroup --location $Location --output none

if (-not (Test-AzResource { az acr show --name $RegistryName --resource-group $ResourceGroup })) {
  az acr create --name $RegistryName --resource-group $ResourceGroup --sku Basic --admin-enabled false --output none
}

az acr build --registry $RegistryName --image "$ImageName`:$ImageTag" . --output none

if (-not (Test-AzResource { az containerapp env show --name $ContainerEnv --resource-group $ResourceGroup })) {
  az containerapp env create --name $ContainerEnv --resource-group $ResourceGroup --location $Location --output none
}

$EnvVars = [System.Collections.Generic.List[string]]::new()
$Secrets = [System.Collections.Generic.List[string]]::new()
$EnvVars.Add("NODE_ENV=production")
$EnvVars.Add("TRUST_PROXY=1")
Add-EnvVar $EnvVars "AZURE_AI_PROJECT_ENDPOINT" $env:AZURE_AI_PROJECT_ENDPOINT
Add-EnvVar $EnvVars "AZURE_AI_MODEL_DEPLOYMENT" $env:AZURE_AI_MODEL_DEPLOYMENT
Add-EnvVar $EnvVars "AZURE_SEARCH_ENDPOINT" $env:AZURE_SEARCH_ENDPOINT
Add-EnvVar $EnvVars "AZURE_SEARCH_INDEX" $env:AZURE_SEARCH_INDEX
Add-EnvVar $EnvVars "AZURE_OPENAI_ENDPOINT" $env:AZURE_OPENAI_ENDPOINT
Add-EnvVar $EnvVars "AZURE_OPENAI_EMBED_DEPLOYMENT" $env:AZURE_OPENAI_EMBED_DEPLOYMENT
Add-EnvVar $EnvVars "AZURE_DOCINT_ENDPOINT" $env:AZURE_DOCINT_ENDPOINT
Add-EnvVar $EnvVars "AZURE_SPEECH_REGION" $env:AZURE_SPEECH_REGION
Add-EnvVar $EnvVars "AZURE_SPEECH_LOCALES" $env:AZURE_SPEECH_LOCALES
Add-EnvVar $EnvVars "WHOIS_LOOKUP_ENABLED" $env:WHOIS_LOOKUP_ENABLED

Add-Secret $Secrets "azure-search-api-key" $env:AZURE_SEARCH_API_KEY
Add-Secret $Secrets "azure-openai-key" $env:AZURE_OPENAI_KEY
Add-Secret $Secrets "azure-docint-key" $env:AZURE_DOCINT_KEY
Add-Secret $Secrets "azure-speech-key" $env:AZURE_SPEECH_KEY
Add-Secret $Secrets "appinsights-connection-string" $env:APPLICATIONINSIGHTS_CONNECTION_STRING
Add-Secret $Secrets "serpapi-api-key" $env:SERPAPI_API_KEY
Add-Secret $Secrets "newsapi-api-key" $env:NEWSAPI_API_KEY
Add-Secret $Secrets "gnews-api-key" $env:GNEWS_API_KEY
Add-Secret $Secrets "whoisjson-api-key" $env:WHOISJSON_API_KEY
Add-Secret $Secrets "domscan-api-key" $env:DOMSCAN_API_KEY
Add-Secret $Secrets "abstract-email-reputation-key" $env:ABSTRACT_EMAIL_REPUTATION_KEY
Add-Secret $Secrets "abstract-phone-key" $env:ABSTRACT_PHONE_KEY
Add-Secret $Secrets "abstract-company-key" $env:ABSTRACT_COMPANY_KEY
Add-Secret $Secrets "abstract-ip-key" $env:ABSTRACT_IP_KEY
Add-Secret $Secrets "vmi-report-api-key" $env:VMI_REPORT_API_KEY

Add-SecretRef $EnvVars "AZURE_SEARCH_API_KEY" "azure-search-api-key" $env:AZURE_SEARCH_API_KEY
Add-SecretRef $EnvVars "AZURE_OPENAI_KEY" "azure-openai-key" $env:AZURE_OPENAI_KEY
Add-SecretRef $EnvVars "AZURE_DOCINT_KEY" "azure-docint-key" $env:AZURE_DOCINT_KEY
Add-SecretRef $EnvVars "AZURE_SPEECH_KEY" "azure-speech-key" $env:AZURE_SPEECH_KEY
Add-SecretRef $EnvVars "APPLICATIONINSIGHTS_CONNECTION_STRING" "appinsights-connection-string" $env:APPLICATIONINSIGHTS_CONNECTION_STRING
Add-SecretRef $EnvVars "SERPAPI_API_KEY" "serpapi-api-key" $env:SERPAPI_API_KEY
Add-SecretRef $EnvVars "NEWSAPI_API_KEY" "newsapi-api-key" $env:NEWSAPI_API_KEY
Add-SecretRef $EnvVars "GNEWS_API_KEY" "gnews-api-key" $env:GNEWS_API_KEY
Add-SecretRef $EnvVars "WHOISJSON_API_KEY" "whoisjson-api-key" $env:WHOISJSON_API_KEY
Add-SecretRef $EnvVars "DOMSCAN_API_KEY" "domscan-api-key" $env:DOMSCAN_API_KEY
Add-SecretRef $EnvVars "ABSTRACT_EMAIL_REPUTATION_KEY" "abstract-email-reputation-key" $env:ABSTRACT_EMAIL_REPUTATION_KEY
Add-SecretRef $EnvVars "ABSTRACT_PHONE_KEY" "abstract-phone-key" $env:ABSTRACT_PHONE_KEY
Add-SecretRef $EnvVars "ABSTRACT_COMPANY_KEY" "abstract-company-key" $env:ABSTRACT_COMPANY_KEY
Add-SecretRef $EnvVars "ABSTRACT_IP_KEY" "abstract-ip-key" $env:ABSTRACT_IP_KEY
Add-SecretRef $EnvVars "VMI_REPORT_API_KEY" "vmi-report-api-key" $env:VMI_REPORT_API_KEY

$AppExists = Test-AzResource { az containerapp show --name $AppName --resource-group $ResourceGroup }
if (-not $AppExists) {
  az containerapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --environment $ContainerEnv `
    --image "mcr.microsoft.com/k8se/quickstart:latest" `
    --target-port 3000 `
    --ingress external `
    --system-assigned `
    --min-replicas 0 `
    --max-replicas 2 `
    --output none
}

$PrincipalId = az containerapp show --name $AppName --resource-group $ResourceGroup --query identity.principalId -o tsv
$AcrId = az acr show --name $RegistryName --resource-group $ResourceGroup --query id -o tsv

az role assignment create --assignee $PrincipalId --role AcrPull --scope $AcrId --output none 2>$null

if ($FoundryResourceId) {
  az role assignment create --assignee $PrincipalId --role "Azure AI Developer" --scope $FoundryResourceId --output none 2>$null
}

az containerapp registry set `
  --name $AppName `
  --resource-group $ResourceGroup `
  --server $LoginServer `
  --identity system `
  --output none

if ($Secrets.Count -gt 0) {
  az containerapp secret set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --secrets $Secrets `
    --output none
}

az containerapp update `
  --name $AppName `
  --resource-group $ResourceGroup `
  --image $Image `
  --set-env-vars $EnvVars `
  --output none

$Fqdn = az containerapp show --name $AppName --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn -o tsv
Write-Host "Deployed: https://$Fqdn"
Write-Host "Validate: npm run online:smoke -- --url https://$Fqdn --require-foundry --require-telemetry"
