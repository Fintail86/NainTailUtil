param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$DestinationRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z][A-Za-z0-9.-]*$')][string]$ExpectedRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archiveFull = [System.IO.Path]::GetFullPath($ArchivePath)
$destinationFull = [System.IO.Path]::GetFullPath($DestinationRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$zip = [System.IO.Compression.ZipFile]::OpenRead($archiveFull)
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$totalBytes = [Int64]0

try {
  if ($zip.Entries.Count -eq 0 -or $zip.Entries.Count -gt 100000) { throw '애드온 ZIP의 파일 수가 올바르지 않습니다.' }
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name.Contains(':')) { throw "허용되지 않는 ZIP 경로입니다: $name" }
    $segments = $name.Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($segments.Count -eq 0 -or $segments[0] -cne $ExpectedRoot -or $segments -contains '..' -or $segments -contains '.') {
      throw "애드온 ZIP 경계가 올바르지 않습니다: $name"
    }
    if (-not $seen.Add($name)) { throw "중복 ZIP 경로입니다: $name" }
    $totalBytes += $entry.Length
    if ($totalBytes -gt 25GB) { throw '압축 해제 크기가 제한을 초과합니다.' }
    $target = [System.IO.Path]::GetFullPath((Join-Path $DestinationRoot ($segments -join [System.IO.Path]::DirectorySeparatorChar)))
    if (-not $target.StartsWith($destinationFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw "ZIP 경로가 설치 폴더를 벗어납니다: $name" }
  }
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    $segments = $name.Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
    $target = [System.IO.Path]::GetFullPath((Join-Path $DestinationRoot ($segments -join [System.IO.Path]::DirectorySeparatorChar)))
    if ($name.EndsWith('/')) {
      [System.IO.Directory]::CreateDirectory($target) | Out-Null
      continue
    }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
    $source = $entry.Open()
    $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $source.CopyTo($output) } finally { $output.Dispose(); $source.Dispose() }
  }
} finally {
  $zip.Dispose()
}
