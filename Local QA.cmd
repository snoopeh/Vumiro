@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Run-Local.ps1" %*
if errorlevel 1 pause
