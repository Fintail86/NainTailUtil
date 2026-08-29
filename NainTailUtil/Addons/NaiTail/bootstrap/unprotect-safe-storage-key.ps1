param(
  [Parameter(Mandatory = $true)]
  [string]$LocalStatePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$state = Get-Content -Raw -LiteralPath $LocalStatePath | ConvertFrom-Json
$wrapped = [Convert]::FromBase64String([string]$state.os_crypt.encrypted_key)
$prefix = [Text.Encoding]::ASCII.GetString($wrapped, 0, [Math]::Min(5, $wrapped.Length))
if ($prefix -ne "DPAPI") {
  throw "지원하지 않는 Windows safeStorage 키 형식입니다."
}

$payload = New-Object byte[] ($wrapped.Length - 5)
[Array]::Copy($wrapped, 5, $payload, 0, $payload.Length)
$key = [Security.Cryptography.ProtectedData]::Unprotect(
  $payload,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($key))
