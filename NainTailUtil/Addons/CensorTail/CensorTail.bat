@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0config\dev-assets.local.cmd" call "%~dp0config\dev-assets.local.cmd"
if exist "%~dp0runtime\electron\electron.exe" set "CENSORTAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not defined CENSORTAIL_ELECTRON if defined CENSORTAIL_SHARED_ROOT set "CENSORTAIL_ELECTRON=%CENSORTAIL_SHARED_ROOT%\runtime\electron\electron.exe"
if not exist "%CENSORTAIL_ELECTRON%" (
  call "%~dp0tools\ensure-electron.cmd"
  if errorlevel 1 exit /b 2
  set "CENSORTAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
)

"%CENSORTAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
