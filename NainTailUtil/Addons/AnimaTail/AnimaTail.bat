@echo off
setlocal
cd /d "%~dp0"

set "ANIMATAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%ANIMATAIL_ELECTRON%" (
  echo [AnimaTail] Portable Electron runtime is missing.
  echo Expected: runtime\electron\electron.exe
  exit /b 2
)

"%ANIMATAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
