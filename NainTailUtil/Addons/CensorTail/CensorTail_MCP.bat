@echo off
setlocal
cd /d "%~dp0"

set "CENSORTAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%CENSORTAIL_ELECTRON%" (
  call "%~dp0bootstrap\ensure-electron.cmd" 1>&2
  if errorlevel 1 exit /b 2
)

set "ELECTRON_RUN_AS_NODE=1"
"%CENSORTAIL_ELECTRON%" "%~dp0standalone\mcp.cjs"
exit /b %errorlevel%
