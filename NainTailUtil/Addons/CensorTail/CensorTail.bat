@echo off
setlocal
cd /d "%~dp0"

set "CENSORTAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%CENSORTAIL_ELECTRON%" (
  echo [CensorTail] Portable Electron runtime is missing.
  echo Expected: runtime\electron\electron.exe
  exit /b 2
)

"%CENSORTAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
