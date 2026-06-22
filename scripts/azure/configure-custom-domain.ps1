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

function Normalize-DnsValue {
  param([AllowNull()][string]$Value)
  if (-not $Value) {
    return ""
  }
  return $Value.Trim().TrimEnd(".").ToLowerInvariant()
}

function Test-DnsValue {
  param(
    [string[]]$Values,
    [string]$Expected
  )
  $normalizedExpected = Normalize-DnsValue $Expected
  foreach ($value in $Values) {
    if ((Normalize-DnsValue $value) -eq $normalizedExpected) {
      return $true
    }
  }
  return $false
}

function Get-DnsCnameValues {
  param([string]$Name)
  $records = @(Resolve-DnsName $Name -Type CNAME -ErrorAction SilentlyContinue)
  return @($records | Where-Object { $_.NameHost } | ForEach-Object { [string]$_.NameHost })
}

function Get-DnsAValues {
  param([string]$Name)
  $records = @(Resolve-DnsName $Name -Type A -ErrorAction SilentlyContinue)
  return @($records | Where-Object { $_.IP4Address } | ForEach-Object { [string]$_.IP4Address })
}

function Get-DnsTxtValues {
  param([string]$Name)
  $records = @(Resolve-DnsName $Name -Type TXT -ErrorAction SilentlyContinue)
  $values = @()
  foreach ($record in $records) {
    if ($record.Strings) {
      $values += @($record.Strings | ForEach-Object { [string]$_ })
    }
  }
  return $values
}

function Assert-DnsReady {
  param(
    [string]$Name,
    [string]$DefaultHost,
    [string]$VerificationId,
    [string]$ExternalIpAddress,
    [bool]$IsRootDomain
  )
  $txtHost = "asuid.$Name"
  $txtValues = Get-DnsTxtValues $txtHost
  if (-not (Test-DnsValue -Values $txtValues -Expected $VerificationId)) {
    throw "DNS TXT $txtHost is not ready. Expected $VerificationId."
  }

  if ($IsRootDomain) {
    $aValues = Get-DnsAValues $Name
    if (-not (Test-DnsValue -Values $aValues -Expected $ExternalIpAddress)) {
      throw "DNS A $Name is not ready. Expected $ExternalIpAddress."
    }
    return
  }

  $cnameValues = Get-DnsCnameValues $Name
  if (-not (Test-DnsValue -Values $cnameValues -Expected $DefaultHost)) {
    throw "DNS CNAME $Name is not ready. Expected $DefaultHost."
  }
}

function Test-HostNameBound {
  param(
    [string]$ResourceGroupName,
    [string]$WebAppName,
    [string]$Name
  )
  $json = az webapp config hostname list `
    --resource-group $ResourceGroupName `
    --webapp-name $WebAppName `
    -o json
  if ($LASTEXITCODE -ne 0 -or -not $json) {
    throw "Could not read existing hostnames for $WebAppName."
  }
  $hosts = $json | ConvertFrom-Json
  foreach ($hostEntry in $hosts) {
    if ($hostEntry.name -and (Normalize-DnsValue $hostEntry.name) -eq (Normalize-DnsValue $Name)) {
      return $true
    }
  }
  return $false
}

function Get-ExistingCertificateThumbprint {
  param(
    [string]$ResourceGroupName,
    [string]$Name
  )
  $json = az webapp config ssl list `
    --resource-group $ResourceGroupName `
    -o json
  if ($LASTEXITCODE -ne 0 -or -not $json) {
    return $null
  }
  $certificates = $json | ConvertFrom-Json
  foreach ($certificate in $certificates) {
    $hostNames = @($certificate.hostNames | ForEach-Object { Normalize-DnsValue ([string]$_) })
    if ($hostNames -contains (Normalize-DnsValue $Name) -and $certificate.thumbprint) {
      return [string]$certificate.thumbprint
    }
  }
  return $null
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

Assert-DnsReady `
  -Name $HostName `
  -DefaultHost $App.host `
  -VerificationId $App.verification `
  -ExternalIpAddress $ExternalIp `
  -IsRootDomain $RootDomain

Write-Host "Binding hostname in Azure App Service..."
if (Test-HostNameBound -ResourceGroupName $ResourceGroup -WebAppName $AppName -Name $HostName) {
  Write-Host "Hostname is already bound; skipping hostname add."
} else {
  Invoke-Checked {
    az webapp config hostname add `
      --resource-group $ResourceGroup `
      --webapp-name $AppName `
      --hostname $HostName `
      --output none
  }
}

Write-Host "Finding or creating managed certificate..."
$thumbprint = Get-ExistingCertificateThumbprint -ResourceGroupName $ResourceGroup -Name $HostName
if (-not $thumbprint) {
  $thumbprint = az webapp config ssl create `
    --resource-group $ResourceGroup `
    --name $AppName `
    --hostname $HostName `
    --query thumbprint `
    -o tsv
}

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
