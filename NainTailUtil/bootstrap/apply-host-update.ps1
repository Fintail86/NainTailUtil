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
  if (Test-Path -LiteralPath $Path) {
    [System.IO.File]::Replace($temporary, $Path, [NullString]::Value)
  } else {
    [System.IO.File]::Move($temporary, $Path)
  }
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

$lockHash = [System.Security.Cryptography.SHA256]::Create()
try { $lockKey = [System.BitConverter]::ToString($lockHash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($TransactionPath.ToLowerInvariant()))).Replace('-', '') }
finally { $lockHash.Dispose() }
$updateMutex = New-Object System.Threading.Mutex($false, "Local\NainTailHostUpdate-$lockKey")
try { $ownsUpdate = $updateMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $ownsUpdate = $true }
if (-not $ownsUpdate) { throw "This host update is already being applied by another process." }

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
if ($workRoot -eq $productRoot -or $backupRoot -ne (Join-Path $productParent ".$productName.host-backup") -or -not ([System.IO.Path]::GetFileName($workRoot).StartsWith(".$productName.host-update-"))) {
  throw "Host update work/backup boundary is invalid."
}

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

# Keep the installation directory (and every user-data directory) in place.
# A complete code-only backup precedes any replacement; the staged files remain
# available until commit so an interrupted apply can be replayed idempotently.
function Assert-ProgramPath([string]$Root, [string]$Relative) {
  if ([string]::IsNullOrWhiteSpace($Relative) -or [System.IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.?([\\/]|$)|:') {
    throw "Invalid program path: $Relative"
  }
  $top = ($Relative -split '[\\/]')[0]
  if ($allowedPreserve -contains $top) { throw "Program update cannot modify user data: $Relative" }
  $resolved = Resolve-FullPath (Join-Path $Root $Relative)
  Assert-Inside $Root $resolved "Program file"
  $cursor = $resolved
  while ($cursor -and $cursor.Length -ge $Root.Length) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Update path must not contain a reparse point: $cursor" }
    }
    $cursor = [System.IO.Path]::GetDirectoryName($cursor)
  }
  return $resolved
}

function Get-ProgramFiles([string]$Root, [string]$Relative = "") {
  $directory = if ($Relative) { Join-Path $Root $Relative } else { $Root }
  foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
    if (-not $Relative -and $allowedPreserve -contains $entry.Name) { continue }
    $name = if ($Relative) { Join-Path $Relative $entry.Name } else { $entry.Name }
    $null = Assert-ProgramPath $Root $name
    if ($entry.PSIsContainer) { Get-ProgramFiles $Root $name } else { $name }
  }
}

function Copy-ProgramFile([string]$FromRoot, [string]$ToRoot, [string]$Relative) {
  $source = Assert-ProgramPath $FromRoot $Relative
  $destination = Assert-ProgramPath $ToRoot $Relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Program source is missing: $Relative" }
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    if ((Get-ProgramHash $source) -eq (Get-ProgramHash $destination)) { return }
  }
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  # Adjacent temp + atomic file replacement keeps the recovery BAT/script intact
  # if power is lost during copying. Never rename the installation root.
  $temporary = "$destination.host-update-tmp"
  $null = Assert-ProgramPath $ToRoot ($Relative + '.host-update-tmp')
  try {
    Copy-Item -LiteralPath $source -Destination $temporary -Force
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      try {
        if (Test-Path -LiteralPath $destination) {
          [System.IO.File]::Replace($temporary, $destination, [NullString]::Value)
        } else {
          [System.IO.File]::Move($temporary, $destination)
        }
        break
      } catch {
        if ($attempt -eq 39) { throw }
        Start-Sleep -Milliseconds 50
      }
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Get-ProgramHash([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)) }
  finally { $sha.Dispose(); $stream.Dispose() }
}

function Remove-ProgramFile([string]$Relative) {
  $file = Assert-ProgramPath $productRoot $Relative
  if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force }
}

$inPlace = $transaction.PSObject.Properties.Name -contains 'updateMode' -and $transaction.updateMode -eq 'in-place-files/v1'
if ([string]$transaction.phase -eq 'prepared' -and -not $inPlace) {
  if (Test-Path -LiteralPath $backupRoot) { throw "An existing host backup requires recovery before starting a new update." }
  $transaction | Add-Member -NotePropertyName updateMode -NotePropertyValue 'in-place-files/v1' -Force
  $transaction | Add-Member -NotePropertyName originalFiles -NotePropertyValue @(Get-ProgramFiles $productRoot) -Force
  $transaction | Add-Member -NotePropertyName incomingFiles -NotePropertyValue @(Get-ProgramFiles $stagedRoot) -Force
  Write-Transaction $TransactionPath $transaction 'in-place-backup'
  $inPlace = $true
}
if ($inPlace) {
  foreach ($required in @('package.json', $launcher)) {
    if (@($transaction.originalFiles) -notcontains $required -or @($transaction.incomingFiles) -notcontains $required) { throw "In-place update file plan is incomplete: $required" }
  }
  foreach ($relative in @($transaction.originalFiles) + @($transaction.incomingFiles)) {
    $null = Assert-ProgramPath $productRoot ([string]$relative)
    $null = Assert-ProgramPath $backupRoot ([string]$relative)
    $null = Assert-ProgramPath $stagedRoot ([string]$relative)
  }
}

function Restore-InPlaceHost {
  if ([string]$transaction.phase -eq 'in-place-backup') { return $true }
  Write-Transaction $TransactionPath $transaction 'in-place-rollback'
  foreach ($relative in @($transaction.originalFiles)) { Copy-ProgramFile $backupRoot $productRoot $relative }
  foreach ($relative in @($transaction.incomingFiles)) {
    if (@($transaction.originalFiles) -notcontains $relative) { Remove-ProgramFile $relative }
    Remove-ProgramFile ($relative + '.host-update-tmp')
  }
  return $true
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
  if ([string]$transaction.phase -notin @("committed", "rolled-back")) {
    if ($inPlace) {
      if ([string]$transaction.phase -eq 'in-place-rollback') {
        $null = Restore-InPlaceHost
        throw "Interrupted host rollback was completed; retry the update from the restored host."
      }
      if ([string]$transaction.phase -eq 'in-place-backup') {
        foreach ($relative in @($transaction.originalFiles)) { Copy-ProgramFile $productRoot $backupRoot $relative }
        Write-Transaction $TransactionPath $transaction 'in-place-applying'
      }
      if ([string]$transaction.phase -ne 'in-place-applying') { throw "Unknown in-place update phase." }
      foreach ($relative in @($transaction.incomingFiles)) { Copy-ProgramFile $stagedRoot $productRoot $relative }
      foreach ($relative in @($transaction.originalFiles)) {
        if (@($transaction.incomingFiles) -notcontains $relative) { Remove-ProgramFile $relative }
      }
    } else {
    # Compatibility only: finish transactions already interrupted by the legacy
    # directory-swap updater. Newly prepared transactions never enter this path.
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
    }

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
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $TransactionPath) {
    Remove-Item -LiteralPath $TransactionPath -Force
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
    if ([string]$transaction.phase -notin @("committed", "rolled-back")) {
      $rolledBack = if ($inPlace) { Restore-InPlaceHost } else { Restore-PreviousHost }
    }
  } catch {
    $rolledBack = $false
  }
  if ($rolledBack) {
    Write-Transaction $TransactionPath $transaction "rolled-back"
    if ($inPlace -and (Test-Path -LiteralPath $backupRoot)) {
      Remove-Item -LiteralPath $backupRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $workRoot) {
      Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $TransactionPath) {
      Remove-Item -LiteralPath $TransactionPath -Force
    }
    $errorRoot = Join-Path $productRoot "runtime"
    New-Item -ItemType Directory -Path $errorRoot -Force | Out-Null
    [string]$failure | Set-Content -LiteralPath (Join-Path $errorRoot "host-update-error.txt") -Encoding UTF8
  }
  throw $failure
}
