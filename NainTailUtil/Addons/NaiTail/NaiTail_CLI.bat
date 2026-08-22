@echo off
setlocal
cd /d "%~dp0"

set "NAITAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
call "%~dp0bootstrap\ensure-electron.cmd" 1>&2
if errorlevel 1 exit /b 2

set "ELECTRON_RUN_AS_NODE=1"
"%NAITAIL_ELECTRON%" "%~dp0standalone\cli.cjs" %*
exit /b %errorlevel%
