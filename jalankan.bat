@echo off
title JualanKu - Server Lokal
echo ============================================
echo   JualanKu - Server Lokal
echo   Buka http://localhost:8931 di browser
echo   Biarkan jendela ini tetap terbuka
echo ============================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
