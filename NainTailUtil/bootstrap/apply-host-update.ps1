[CmdletBinding()]
param(
  [string]$TransactionPath = "",
  [string]$ProductRoot = "",
  [int]$WaitForPid = 0,
  [string]$ReadyPath = "",
  [switch]$Restart,
  [switch]$ResumeOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($TransactionPath)) {
  $TransactionPath = $env:NAINTAIL_HOST_UPDATE_TRANSACTION
}
if ($WaitForPid -le 0 -and $env:NAINTAIL_HOST_UPDATE_WAIT_PID -match '^\d+$') {
  $WaitForPid = [int]$env:NAINTAIL_HOST_UPDATE_WAIT_PID
}
if ([string]::IsNullOrWhiteSpace($ReadyPath)) {
  $ReadyPath = $env:NAINTAIL_HOST_UPDATE_READY
}
if ($env:NAINTAIL_HOST_UPDATE_RESTART -eq "1") {
  $Restart = $true
}

$requestedProductRoot = $ProductRoot

function Resolve-FullPath([string]$Value) {
  return [System.IO.Path]::GetFullPath($Value).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Write-Transaction([string]$Path, $Transaction, [string]$Phase) {
  $Transaction.phase = $Phase
  $temporary = "$Path.$PID.tmp"
  $Transaction | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-DirectChild([string]$Parent, [string]$Candidate, [string]$Label) {
  if ([System.IO.Path]::GetDirectoryName($Candidate) -ne $Parent) {
    throw "$Label must be a direct child of the product parent."
  }
}

function Assert-Inside([string]$Parent, [string]$Candidate, [string]$Label) {
  $prefix = $Parent + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label is outside the approved update boundary."
  }
}

if ([string]::IsNullOrWhiteSpace($TransactionPath)) {
  if ([string]::IsNullOrWhiteSpace($ProductRoot)) {
    $ProductRoot = Split-Path -Parent $PSScriptRoot
  }
  $resolvedProduct = Resolve-FullPath $ProductRoot
  $productParent = [System.IO.Path]::GetDirectoryName($resolvedProduct)
  $productName = [System.IO.Path]::GetFileName($resolvedProduct)
  $TransactionPath = Join-Path $productParent ".$productName.host-update.json"
}
$TransactionPath = Resolve-FullPath $TransactionPath
if (-not (Test-Path -LiteralPath $TransactionPath -PathType Leaf)) {
  exit 0
}

$transaction = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
if ($transaction.schema -ne "naintail.host-update-transaction/v1") {
  throw "Unsupported host update transaction schema."
}

$productRoot = Resolve-FullPath ([string]$transaction.productRoot)
$productParent = [System.IO.Path]::GetDirectoryName($productRoot)
$productName = [System.IO.Path]::GetFileName($productRoot)
$expectedTransaction = Join-Path $productParent ".$productName.host-update.json"
if ($TransactionPath -ne (Resolve-FullPath $expectedTransaction)) {
  throw "Host update transaction is outside the product boundary."
}
if (-not [string]::IsNullOrWhiteSpace($requestedProductRoot) -and (Resolve-FullPath $requestedProductRoot) -ne $productRoot) {
  throw "Host update transaction targets a different product root."
}

$stagedRoot = Resolve-FullPath ([string]$transaction.stagedRoot)
$workRoot = Resolve-FullPath ([string]$transaction.workRoot)
$backupRoot = Resolve-FullPath ([string]$transaction.backupRoot)
Assert-DirectChild $productParent $productRoot "Product root"
Assert-DirectChild $productParent $workRoot "Work root"
Assert-DirectChild $productParent $backupRoot "Backup root"
Assert-Inside $workRoot $stagedRoot "Staged root"

$allowedPreserve = @("Addons", "config", "outputs", "runtime")
$preservePaths = @($transaction.preservePaths)
if ($preservePaths.Count -ne $allowedPreserve.Count -or @($preservePaths | Select-Object -Unique).Count -ne $allowedPreserve.Count) {
  throw "Host update preservation contract is incomplete."
}
foreach ($relative in $preservePaths) {
  if ($allowedPreserve -notcontains [string]$relative) {
    throw "Host update preservation path is not allowed: $relative"
  }
}

$targetVersion = [string]$transaction.targetVersion
if ($targetVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "Host update target version is invalid."
}
$launcher = [string]$transaction.launcher
if ($launcher -ne "NainTailUtil.bat") {
  throw "Host update launcher is invalid."
}

if (-not [string]::IsNullOrWhiteSpace($ReadyPath)) {
  $resolvedReadyPath = Resolve-FullPath $ReadyPath
  Assert-Inside $workRoot $resolvedReadyPath "Updater ready marker"
  "ready" | Set-Content -LiteralPath $resolvedReadyPath -Encoding ASCII
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while (Test-Path -LiteralPath $resolvedReadyPath) {
    if ([DateTime]::UtcNow -ge $readyDeadline) {
      throw "Host update handoff acknowledgement timed out."
    }
    Start-Sleep -Milliseconds 25
  }
}

if ($WaitForPid -gt 0) {
  try {
    $process = Get-Process -Id $WaitForPid -ErrorAction Stop
    $process.WaitForExit()
  } catch {
    # The host may already have exited before the updater reached this point.
  }
}

function Restore-PreviousHost {
  if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    return $false
  }
  foreach ($relative in $preservePaths) {
    $source = Join-Path $productRoot $relative
    $destination = Join-Path $backupRoot $relative
    if ((-not (Test-Path -LiteralPath $destination)) -and (Test-Path -LiteralPath $source)) {
      New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
      Move-Item -LiteralPath $source -Destination $destination
    }
  }
  if (Test-Path -LiteralPath $productRoot) {
    Remove-Item -LiteralPath $productRoot -Recurse -Force
  }
  Move-Item -LiteralPath $backupRoot -Destination $productRoot
  return $true
}

try {
  if ([string]$transaction.phase -ne "committed") {
    if (-not (Test-Path -LiteralPath $backupRoot)) {
      if (-not (Test-Path -LiteralPath $productRoot -PathType Container)) {
        throw "Current host folder is missing before update."
      }
      Move-Item -LiteralPath $productRoot -Destination $backupRoot
      Write-Transaction $TransactionPath $transaction "previous-parked"
    }

    if (-not (Test-Path -LiteralPath $productRoot)) {
      if (-not (Test-Path -LiteralPath $stagedRoot -PathType Container)) {
        throw "Staged host folder is missing."
      }
      Move-Item -LiteralPath $stagedRoot -Destination $productRoot
    }
    Write-Transaction $TransactionPath $transaction "new-active"

    foreach ($relative in $preservePaths) {
      $source = Join-Path $backupRoot $relative
      $destination = Join-Path $productRoot $relative
      if (-not (Test-Path -LiteralPath $source)) {
        continue
      }
      if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
      }
      New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
      Move-Item -LiteralPath $source -Destination $destination
    }
    Write-Transaction $TransactionPath $transaction "data-restored"

    $packagePath = Join-Path $productRoot "package.json"
    $launcherPath = Join-Path $productRoot $launcher
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf) -or -not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
      throw "Updated host validation failed."
    }
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ([string]$package.name -ne "naintailutil" -or [string]$package.version -ne $targetVersion) {
      throw "Updated host package version does not match the transaction."
    }
    Write-Transaction $TransactionPath $transaction "committed"
  }

  if (Test-Path -LiteralPath $backupRoot) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $TransactionPath) {
    Remove-Item -LiteralPath $TransactionPath -Force
  }
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }

  if ($Restart -and -not $ResumeOnly) {
    $launcherPath = Join-Path $productRoot $launcher
    Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "`"$launcherPath`"") -WorkingDirectory $productRoot -WindowStyle Hidden
  }
  exit 0
} catch {
  $failure = $_
  $rolledBack = $false
  try {
    if ([string]$transaction.phase -ne "committed") {
      $rolledBack = Restore-PreviousHost
    }
  } catch {
    $rolledBack = $false
  }
  if ($rolledBack) {
    if (Test-Path -LiteralPath $TransactionPath) {
      Remove-Item -LiteralPath $TransactionPath -Force
    }
    if (Test-Path -LiteralPath $workRoot) {
      Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
    $errorRoot = Join-Path $productRoot "runtime"
    New-Item -ItemType Directory -Path $errorRoot -Force | Out-Null
    [string]$failure | Set-Content -LiteralPath (Join-Path $errorRoot "host-update-error.txt") -Encoding UTF8
  }
  throw $failure
}
