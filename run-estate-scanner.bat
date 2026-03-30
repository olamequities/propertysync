@echo off
title Estate Scanner - Surrogate Court Search
echo.
echo ============================================================
echo   Estate Scanner - Surrogate Court Search
echo ============================================================
echo.

:: Check if Python is installed
py --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed.
    echo.
    echo To install: Open Microsoft Store, search "Python", click Install.
    echo Then run this file again.
    echo.
    pause
    exit /b
)

:: Install dependencies silently
echo Setting up (first run may take a minute)...
py -m pip install --quiet seleniumbase google-api-python-client google-auth >nul 2>&1
echo Ready.
echo.

:: Run the scanner
py scripts\estate-scanner.py
