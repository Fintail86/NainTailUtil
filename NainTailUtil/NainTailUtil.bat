@echo off
setlocal
cd /d "%~dp0"

set "NTU_ELECTRON=%~dp0runtime\electron\electron.exe"
if not exist "%NTU_ELECTRON%" (
  echo [NainTailUtil] Portable Electron runtime is missing.
  echo Expected: runtime\electron\electron.exe
  exit /b 2
)

rem `%~dp0` ends with a backslash. Passing that value directly as a quoted
rem argument makes Windows preserve the closing quote as part of the path.
rem Appending `.` keeps the argument inside the product root without a
rem trailing backslash: C:\portable\NainTailUtil\.
"%NTU_ELECTRON%" "%~dp0."
exit /b %errorlevel%
