param(
  [string]$ResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-kkgawatlh9-6623" }),
  [string]$AppName = $(if ($env:AZURE_FUNCTION_APP_NAME) { $env:AZURE_FUNCTION_APP_NAME } else { "vmi-online-3907" }),
  [string]$ActionEmail = $env:AZURE_ALERT_EMAIL,
  [string]$ActionGroupName = "vmi-live-ops",
  [string]$ActionGroupShortName = "vmiops"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $true
}

if (-not $ActionEmail) {
  $account = az account show --query user.name -o tsv
  if ($account -and $account.Contains("@")) {
    $ActionEmail = $account
  }
}
if (-not $ActionEmail) {
  throw "Set AZURE_ALERT_EMAIL or pass -ActionEmail so Azure Monitor has a receiver."
}

function Invoke-Checked {
  param([scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

$Scope = az resource show `
  --resource-group $ResourceGroup `
  --name $AppName `
  --resource-type Microsoft.Web/sites `
  --query id `
  -o tsv

if (-not $Scope) {
  throw "Could not find Function App $AppName in $ResourceGroup."
}

Write-Host "Configuring Azure Monitor for $AppName"

Invoke-Checked {
  az monitor action-group create `
    --resource-group $ResourceGroup `
    --name $ActionGroupName `
    --short-name $ActionGroupShortName `
    --action email ops $ActionEmail `
    --output none
}

$ActionGroupId = az monitor action-group show `
  --resource-group $ResourceGroup `
  --name $ActionGroupName `
  --query id `
  -o tsv

function Set-MetricAlert {
  param(
    [string]$Name,
    [string]$Description,
    [string]$Condition,
    [int]$Severity
  )
  Invoke-Checked {
    az monitor metrics alert create `
      --resource-group $ResourceGroup `
      --name $Name `
      --description $Description `
      --scopes $Scope `
      --condition $Condition `
      --window-size 5m `
      --evaluation-frequency 1m `
      --severity $Severity `
      --action $ActionGroupId `
      --output none
  }
}

Set-MetricAlert `
  -Name "vmi-online-5xx-spike" `
  -Description "Production Function App returned more than 3 server errors in 5 minutes." `
  -Condition "total Http5xx > 3" `
  -Severity 1

Set-MetricAlert `
  -Name "vmi-online-latency-spike" `
  -Description "Average HTTP response time exceeded 30 seconds over 5 minutes." `
  -Condition "avg HttpResponseTime > 30" `
  -Severity 2

Set-MetricAlert `
  -Name "vmi-online-queue-backlog" `
  -Description "Requests are backing up in the App Service queue." `
  -Condition "avg RequestsInApplicationQueue > 5" `
  -Severity 2

Set-MetricAlert `
  -Name "vmi-online-high-4xx" `
  -Description "Client error volume spiked; investigate auth, quota, routing, or bot traffic." `
  -Condition "total Http4xx > 50" `
  -Severity 3

Write-Host "Azure Monitor alerts configured for $AppName."
Write-Host "Action group: $ActionGroupName <$ActionEmail>"
