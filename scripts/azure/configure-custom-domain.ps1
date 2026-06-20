param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$ResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-kkgawatlh9-6623" }),
  [string]$AppName = $(if ($env:AZURE_FUNCTION_APP_NAME) { $env:AZURE_FUNCTION_APP_NAME } else { "vmi-online-3907" }),
  [switch]$RootDomain,
  [switch]$DnsOnly
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

$App = az webapp show `
  --resource-group $ResourceGroup `
  --name $AppName `
  --query "{host:defaultHostName,verification:customDomainVerificationId}" `
  -o json | ConvertFrom-Json

if (-not $App.host -or -not $App.verification) {
  throw "Could not read hostname or custom-domain verification id for $AppName."
}

$ExternalIp = az webapp config hostname get-external-ip `
  --resource-group $ResourceGroup `
  --webapp-name $AppName `
  -o tsv

$firstLabel = $HostName.Split(".")[0]

Write-Host "DNS records needed before Azure can bind ${HostName}:"
if ($RootDomain) {
  Write-Host "  A     @       $ExternalIp"
  Write-Host "  TXT   asuid   $($App.verification)"
} else {
  Write-Host "  CNAME $firstLabel       $($App.host)"
  Write-Host "  TXT   asuid.$firstLabel $($App.verification)"
}
Write-Host ""
Write-Host "Create those records at your DNS provider, wait for propagation, then rerun without -DnsOnly."

if ($DnsOnly) {
  return
}

Write-Host "Binding hostname in Azure App Service..."
Invoke-Checked {
  az webapp config hostname add `
    --resource-group $ResourceGroup `
    --webapp-name $AppName `
    --hostname $HostName `
    --output none
}

Write-Host "Creating managed certificate..."
$thumbprint = az webapp config ssl create `
  --resource-group $ResourceGroup `
  --name $AppName `
  --hostname $HostName `
  --query thumbprint `
  -o tsv

if (-not $thumbprint) {
  throw "Managed certificate creation did not return a thumbprint."
}

Write-Host "Binding managed certificate with SNI..."
Invoke-Checked {
  az webapp config ssl bind `
    --resource-group $ResourceGroup `
    --name $AppName `
    --certificate-thumbprint $thumbprint `
    --ssl-type SNI `
    --output none
}

Write-Host "Custom domain configured: https://$HostName"
