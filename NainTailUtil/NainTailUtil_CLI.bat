@echo off
setlocal
cd /d "%~dp0"

set "NTU_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%NTU_ELECTRON%" (
  echo {"ok":false,"error":{"code":"RUNTIME_MISSING","message":"Portable Electron runtime is missing: runtime/electron/electron.exe"}}
  exit /b 2
)

set ELECTRON_RUN_AS_NODE=1
"%NTU_ELECTRON%" "%~dp0app\cli\main.cjs" %*
exit /b %errorlevel%

