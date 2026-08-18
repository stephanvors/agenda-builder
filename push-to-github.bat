@echo off
title Push Agenda Builder to GitHub
color 1F
echo.
echo ==============================================
echo  Pushing Agenda Builder to GitHub...
echo ==============================================
echo.

cd /d "c:\Apps\AgendaBuilder"

git push -u origin main

echo.
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] Code uploaded to GitHub successfully!
) else (
    echo [NOTICE] If prompted, please sign in via the browser window.
)
echo.
pause
