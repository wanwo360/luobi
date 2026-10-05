@echo off
title Luobi - AI Novel Studio
cd /d "%~dp0"

REM ensure Node.js is on PATH (only fall back to the default install dir)
where node >nul 2>nul || set "PATH=C:\Program Files\nodejs;%PATH%"

REM clear the env var that makes Electron run as plain Node
set "ELECTRON_RUN_AS_NODE="

echo ================================================
echo    Luobi - AI Novel Studio
echo    Tech with you. Infinite possibilities.
echo ================================================
echo.
echo Starting the app, first launch takes 10-20s...
echo DO NOT close this window (closing it quits the app).
echo.

call npm run dev

pause
