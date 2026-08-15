@echo off
setlocal
cd /d "%~dp0"

set "NAITAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%NAITAIL_ELECTRON%" (
  echo [NaiTail] Portable Electron runtime is missing.
  echo Expected: runtime\electron\electron.exe
  exit /b 2
)

"%NAITAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
