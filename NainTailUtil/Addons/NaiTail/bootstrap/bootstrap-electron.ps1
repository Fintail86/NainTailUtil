[CmdletBinding()]
param(
  [string]$AddonRoot = "",
  [string]$ManifestPath = "",
  [string]$SourceArchive = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($AddonRoot)) {
  $AddonRoot = Split-Path -Parent $PSScriptRoot
}
$resolvedAddonRoot = [System.IO.Path]::GetFullPath($AddonRoot)
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $resolvedAddonRoot "electron-runtime-manifest.json"
}
$ManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "Electron runtime manifest is missing: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne "naintail.electron-runtime/v1") {
  throw "Unsupported Electron runtime manifest schema."
}
if ($manifest.platform -ne "win32-x64") {
  throw "Unsupported Electron runtime platform: $($manifest.platform)"
}
if ([string]::IsNullOrWhiteSpace([string]$manifest.version)) {
  throw "Electron runtime version is missing."
}
if ($manifest.entrypoint -ne "electron.exe") {
  throw "Unsupported Electron runtime entrypoint."
}

$archive = $manifest.archive
$expectedFileName = "electron-v$($manifest.version)-win32-x64.zip"
if ($archive.fileName -ne $expectedFileName) {
  throw "Electron archive name does not match the pinned version."
}
if ([System.IO.Path]::GetFileName([string]$archive.fileName) -ne $archive.fileName) {
  throw "Electron archive name must not contain a path."
}
$downloadUri = [System.Uri]$archive.url
if ($downloadUri.Scheme -ne "https" -or $downloadUri.Host -ne "github.com") {
  throw "Electron archive must use the official GitHub HTTPS release URL."
}
$expectedPath = "/electron/electron/releases/download/v$($manifest.version)/$expectedFileName"
if ($downloadUri.AbsolutePath -ne $expectedPath) {
  throw "Electron archive URL does not match the pinned official release."
}
$expectedBytes = [int64]$archive.bytes
$expectedSha256 = ([string]$archive.sha256).ToLowerInvariant()
if ($expectedBytes -le 0 -or $expectedSha256 -notmatch "^[0-9a-f]{64}$") {
  throw "Electron archive integrity metadata is invalid."
}

$runtimeRoot = Join-Path $resolvedAddonRoot "runtime"
$destinationRoot = Join-Path $runtimeRoot "electron"
$electronPath = Join-Path $destinationRoot "electron.exe"
if (Test-Path -LiteralPath $electronPath -PathType Leaf) {
  exit 0
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$lockPath = Join-Path $runtimeRoot ".electron-install.lock"
$ownsLock = $false
for ($attempt = 0; $attempt -lt 1200; $attempt += 1) {
  try {
    New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
    $ownsLock = $true
    break
  } catch {
    if (Test-Path -LiteralPath $electronPath -PathType Leaf) {
      exit 0
    }
    if ($attempt -eq 1199) {
      throw "Another Electron installation did not finish within 10 minutes."
    }
    Start-Sleep -Milliseconds 500
  }
}

$downloadRoot = Join-Path $runtimeRoot ".downloads"
$archivePath = Join-Path $downloadRoot "$expectedFileName.part"
$stagingRoot = Join-Path $runtimeRoot ".electron-staging-$PID"

try {
  if (Test-Path -LiteralPath $electronPath -PathType Leaf) {
    exit 0
  }
  New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  Write-Host "[Electron bootstrap] Downloading Electron $($manifest.version) for Windows x64..."
  if ([string]::IsNullOrWhiteSpace($SourceArchive)) {
    [System.Net.ServicePointManager]::SecurityProtocol = (
      [System.Net.ServicePointManager]::SecurityProtocol -bor
      [System.Net.SecurityProtocolType]::Tls12
    )
    $webClient = New-Object System.Net.WebClient
    try {
      $webClient.Headers.Add("User-Agent", "NainTail-Electron-Bootstrap/1")
      $webClient.DownloadFile($downloadUri.AbsoluteUri, $archivePath)
    } finally {
      $webClient.Dispose()
    }
  } else {
    Copy-Item -LiteralPath ([System.IO.Path]::GetFullPath($SourceArchive)) -Destination $archivePath
  }

  $actualBytes = (Get-Item -LiteralPath $archivePath).Length
  if ($actualBytes -ne $expectedBytes) {
    throw "Electron archive size mismatch: expected $expectedBytes, received $actualBytes."
  }
  $hashStream = [System.IO.File]::OpenRead($archivePath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($hashStream)
      $actualSha256 = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $hashStream.Dispose()
  }
  if ($actualSha256 -ne $expectedSha256) {
    throw "Electron archive SHA-256 mismatch."
  }

  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null
  Write-Host "[Electron bootstrap] Verifying and extracting..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $stagingRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot "electron.exe") -PathType Leaf)) {
    throw "Electron archive does not contain electron.exe."
  }

  if (Test-Path -LiteralPath $destinationRoot) {
    Remove-Item -LiteralPath $destinationRoot -Recurse -Force
  }
  Move-Item -LiteralPath $stagingRoot -Destination $destinationRoot
  @(
    "electron-$($manifest.version)-win32-x64"
    $expectedSha256
  ) | Set-Content -LiteralPath (Join-Path $destinationRoot ".runtime-ready") -Encoding ASCII
  Remove-Item -LiteralPath $archivePath -Force
  Write-Host "[Electron bootstrap] Electron $($manifest.version) is ready."
} catch {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  throw
} finally {
  if ($ownsLock -and (Test-Path -LiteralPath $lockPath)) {
    Remove-Item -LiteralPath $lockPath -Recurse -Force
  }
}
