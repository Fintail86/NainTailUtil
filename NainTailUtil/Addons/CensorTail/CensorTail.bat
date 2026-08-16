@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0config\dev-assets.local.cmd" call "%~dp0config\dev-assets.local.cmd"
if exist "%~dp0runtime\electron\electron.exe" set "CENSORTAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not defined CENSORTAIL_ELECTRON if defined CENSORTAIL_SHARED_ROOT set "CENSORTAIL_ELECTRON=%CENSORTAIL_SHARED_ROOT%\runtime\electron\electron.exe"
if not exist "%CENSORTAIL_ELECTRON%" (
  echo [CensorTail] Portable Electron runtime is missing.
  echo Run: node tools\dev-setup.cjs
  echo Expected local: runtime\electron\electron.exe
  exit /b 2
)

"%CENSORTAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
