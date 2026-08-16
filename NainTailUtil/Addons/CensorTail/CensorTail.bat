@echo off
setlocal
cd /d "%~dp0"

set "CENSORTAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%CENSORTAIL_ELECTRON%" (
  call "%~dp0bootstrap\ensure-electron.cmd"
  if errorlevel 1 exit /b 2
)

"%CENSORTAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
