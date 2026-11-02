@echo off
setlocal enabledelayedexpansion
title Lumen dev

rem ---------------------------------------------------------------------
rem  One-click launcher for Windows: starts the API (8015) + web app (5185).
rem  All output is ASCII on purpose: a Chinese console code page would
rem  garble the Node log lines.
rem ---------------------------------------------------------------------

set "NODE_EXE="

rem 1) Preferred: node already on PATH.
for /f "delims=" %%I in ('where node 2^>nul') do (
    set "NODE_EXE=%%I"
    goto :run
)

rem 2) Fallback: the Node runtime bundled with WorkBuddy. This machine has no
rem    global Node install, so a plain `node` call would fail here.
for /f "delims=" %%D in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do (
    if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe" (
        set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe"
        goto :run
    )
)

echo.
echo   [error] Node.js was not found.
echo           Install Node 20 or newer, or add it to PATH,
echo           then run start.cmd again.
echo.
pause
exit /b 1

:run
"%NODE_EXE%" "%~dp0scripts\dev.mjs" %*
if errorlevel 1 pause
