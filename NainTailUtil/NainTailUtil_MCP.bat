@echo off
setlocal
cd /d "%~dp0"

set "NTU_ELECTRON=%~dp0runtime\electron\electron.exe"
call "%~dp0bootstrap\ensure-electron.cmd" 1>&2
if errorlevel 1 exit /b 2

set "ELECTRON_RUN_AS_NODE=1"
"%NTU_ELECTRON%" "%~dp0app\mcp\main.cjs"
exit /b %errorlevel%
