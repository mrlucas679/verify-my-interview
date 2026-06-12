$ErrorActionPreference = "Stop"

function Find-CommandText {
    param(
        [Parameter(Mandatory = $false)]
        $Value,
        [int] $Depth = 0
    )

    if ($null -eq $Value -or $Depth -gt 6) {
        return ""
    }

    if ($Value -is [string]) {
        return $Value
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $count = 0
        foreach ($item in $Value) {
            if ($count -ge 20) {
                break
            }
            $found = Find-CommandText -Value $item -Depth ($Depth + 1)
            if ($found) {
                return $found
            }
            $count += 1
        }
        return ""
    }

    $properties = @("command", "cmd", "script", "shell_command", "input")
    foreach ($property in $properties) {
        if ($Value.PSObject.Properties.Name -contains $property) {
            $found = Find-CommandText -Value $Value.$property -Depth ($Depth + 1)
            if ($found) {
                return $found
            }
        }
    }

    foreach ($property in $Value.PSObject.Properties) {
        $found = Find-CommandText -Value $property.Value -Depth ($Depth + 1)
        if ($found) {
            return $found
        }
    }

    return ""
}

function Test-AnyPattern {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Text,
        [Parameter(Mandatory = $true)]
        [string[]] $Patterns
    )

    foreach ($pattern in $Patterns) {
        if ($Text -match $pattern) {
            return $true
        }
    }
    return $false
}

$rawInput = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($rawInput)) {
    exit 0
}

$commandText = ""
try {
    $payload = $rawInput | ConvertFrom-Json -ErrorAction Stop
    $commandText = Find-CommandText -Value $payload
} catch {
    $commandText = $rawInput
}

if ([string]::IsNullOrWhiteSpace($commandText)) {
    exit 0
}

$normalized = ($commandText -replace "\s+", " ").Trim()
$serverAllowed = $normalized -match "VMI_ALLOW_SERVER_START\s*=\s*1"
$processAllowed = $normalized -match "VMI_ALLOW_PROCESS_CONTROL\s*=\s*1"
$secretAllowed = $normalized -match "VMI_ALLOW_SECRET_READ\s*=\s*1"

$serverPatterns = @(
    "(?i)(^|\s)npm(\.cmd)?\s+start(\s|$)",
    "(?i)(^|\s)npm(\.cmd)?\s+run\s+dev(\s|$)",
    "(?i)(^|\s)npm(\.cmd)?\s+run\s+dev:web(\s|$)",
    "(?i)(^|\s)tsx(\.cmd)?\s+watch\s+src[/\\]backend[/\\]server\.ts(\s|$)",
    "(?i)(^|\s)vite(\.cmd)?(\s|$)"
)

$processPatterns = @(
    "(?i)(^|\s)Stop-Process(\s|$)",
    "(?i)(^|\s)taskkill(\.exe)?(\s|$)",
    "(?i)(^|\s)Stop-Job(\s|$)"
)

$secretPatterns = @(
    "(?i)(Get-Content|gc|cat|type|Select-String)\s+[^;|&]*\.env(\s|$|['""])",
    "(?i)(Get-Content|gc|cat|type|Select-String)\s+[^;|&]*\.env\.(?!example\b)[^\s'""]*"
)

if (-not $serverAllowed -and (Test-AnyPattern -Text $normalized -Patterns $serverPatterns)) {
    [Console]::Error.WriteLine("Blocked by Verify My Interview guardrail: live server commands need explicit user approval. If the user approved this exact run, include VMI_ALLOW_SERVER_START=1 in the command.")
    exit 2
}

if (-not $processAllowed -and (Test-AnyPattern -Text $normalized -Patterns $processPatterns)) {
    [Console]::Error.WriteLine("Blocked by Verify My Interview guardrail: do not stop or kill running processes without explicit user approval. If approved, include VMI_ALLOW_PROCESS_CONTROL=1 in the command.")
    exit 2
}

if (-not $secretAllowed -and (Test-AnyPattern -Text $normalized -Patterns $secretPatterns)) {
    [Console]::Error.WriteLine("Blocked by Verify My Interview guardrail: do not read .env secrets. Use .env.example for names, or include VMI_ALLOW_SECRET_READ=1 only after explicit user approval.")
    exit 2
}

exit 0
