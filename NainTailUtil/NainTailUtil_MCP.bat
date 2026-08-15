@echo off
setlocal
cd /d "%~dp0"

set "NTU_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%NTU_ELECTRON%" (
  echo [NainTailUtil MCP] Portable Electron runtime is missing: runtime/electron/electron.exe 1>&2
  exit /b 2
)

set "ELECTRON_RUN_AS_NODE=1"
"%NTU_ELECTRON%" "%~dp0app\mcp\main.cjs"
exit /b %errorlevel%
