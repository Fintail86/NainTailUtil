@echo off
setlocal
cd /d "%~dp0"

set "NAITAIL_ELECTRON=%~dp0runtime\electron\electron.exe"
call "%~dp0bootstrap\ensure-electron.cmd"
if errorlevel 1 exit /b 2

"%NAITAIL_ELECTRON%" "%~dp0."
exit /b %errorlevel%
