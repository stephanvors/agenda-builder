@echo off
title SGB/SMT Agenda Builder
color 1F
echo.
echo  ============================================
echo   SGB/SMT Strategy Meeting - Agenda Builder
echo   Meeting Date: 21 August 2026
echo   Authentication: PIN-based (15 members)
echo  ============================================
echo.
echo  Starting server...

cd /d "c:\Apps\AgendaBuilder"

:: Start the Node server in the background
start /B node server.js

:: Wait for server to be ready
timeout /t 4 /nobreak >nul

echo  Server running on http://localhost:3000
echo.
echo  ============================================
echo   MEMBER PINs (for private distribution)
echo  ============================================
echo.

:: Display PINs
powershell -Command "try { $pins = Invoke-RestMethod -Uri 'http://localhost:3000/api/admin/pins'; foreach($p in $pins) { Write-Host ('  {0,-22} {1,-22} PIN: {2}' -f $p.name, $p.role, $p.pin) } } catch { Write-Host '  Could not retrieve PINs' }"

echo.
echo  ============================================
echo.

:: Open the local app in the browser
start http://localhost:3000

echo  Starting public tunnel...
echo.

:: Run localtunnel in the foreground so the window stays open
npx -y localtunnel --port 3000
