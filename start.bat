@echo off
title Aurea
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0boot.ps1"
echo.
pause
