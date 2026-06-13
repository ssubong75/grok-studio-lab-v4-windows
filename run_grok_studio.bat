@echo off
setlocal
cd /d "%~dp0"

if not exist "python\python.exe" (
  echo The bundled Python runtime was not found.
  echo Extract the complete Grok Studio Lab Windows folder and try again.
  pause
  exit /b 1
)

if not exist "grok_studio_data_v2\logs" mkdir "grok_studio_data_v2\logs"
start "" "%~dp0python\pythonw.exe" "%~dp0windows_launcher.py"
exit /b 0
