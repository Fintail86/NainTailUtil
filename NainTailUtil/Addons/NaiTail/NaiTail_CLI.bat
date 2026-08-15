@echo off
setlocal
cd /d "%~dp0"

set "NAITAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%NAITAIL_ELECTRON%" (
  echo {"ok":false,"error":{"code":"RUNTIME_MISSING","message":"Portable Electron runtime is missing: runtime/electron/electron.exe"}}
  exit /b 2
)

set "ELECTRON_RUN_AS_NODE=1"
"%NAITAIL_ELECTRON%" "%~dp0standalone\cli.cjs" %*
exit /b %errorlevel%
