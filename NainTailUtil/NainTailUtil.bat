@echo off
setlocal
cd /d "%~dp0"

set "WINDOWS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
for %%I in ("%~dp0.") do set "NTU_PRODUCT_NAME=%%~nxI"
set "NTU_UPDATE_MARKER=%~dp0..\.%NTU_PRODUCT_NAME%.host-update.json"
if exist "%NTU_UPDATE_MARKER%" (
  "%WINDOWS_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0bootstrap\apply-host-update.ps1" -TransactionPath "%NTU_UPDATE_MARKER%" -ProductRoot "%~dp0." -ResumeOnly
  if errorlevel 1 (
    echo [NainTail update] Recovery failed. See runtime\host-update-error.txt if rollback completed. 1>&2
    exit /b 3
  )
)

set "NTU_ELECTRON=%~dp0runtime\electron\electron.exe"
call "%~dp0bootstrap\ensure-electron.cmd"
if errorlevel 1 exit /b 2

rem `%~dp0` ends with a backslash. Passing that value directly as a quoted
rem argument makes Windows preserve the closing quote as part of the path.
rem Appending `.` keeps the argument inside the product root without a
rem trailing backslash: C:\portable\NainTailUtil\.
"%NTU_ELECTRON%" "%~dp0."
exit /b %errorlevel%
