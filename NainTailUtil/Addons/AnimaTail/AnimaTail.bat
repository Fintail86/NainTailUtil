@echo off
setlocal
cd /d "%~dp0"

set "ANIMATAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%ANIMATAIL_ELECTRON%" (
  call "%~dp0bootstrap\ensure-electron.cmd"
  if errorlevel 1 exit /b 2
)

"%ANIMATAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
