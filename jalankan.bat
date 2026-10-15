@echo off
title HargaKu - Server Lokal
echo ============================================
echo   HargaKu - Server Lokal
echo   Buka http://localhost:8931 di browser
echo   Biarkan jendela ini tetap terbuka
echo ============================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
