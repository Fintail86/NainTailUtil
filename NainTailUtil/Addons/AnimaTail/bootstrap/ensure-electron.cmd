@echo off
setlocal

set "ADDON_ELECTRON=%~dp0..\runtime\electron\electron.exe"
set "WINDOWS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%WINDOWS_POWERSHELL%" (
  echo [Electron bootstrap] Windows PowerShell is required. 1>&2
  exit /b 2
)

"%WINDOWS_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-electron.ps1"
if errorlevel 1 exit /b 2
if not exist "%ADDON_ELECTRON%" (
  echo [Electron bootstrap] Installation completed without electron.exe. 1>&2
  exit /b 2
)
exit /b 0
