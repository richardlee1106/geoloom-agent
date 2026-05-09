@echo off
setlocal
cd /d "%~dp0"

echo [GeoLoom Narrative] Preparing narrative dev stack...
echo.
echo ============================================
echo   Frontend:
echo   http://127.0.0.1:5173/narrative
echo   Backend API:
echo   http://127.0.0.1:3210
echo   TTS Service:
echo   http://127.0.0.1:8880
echo ============================================
echo.

curl.exe -fsS "http://127.0.0.1:8880/health" >nul 2>&1
if errorlevel 1 (
    echo [OmniVoice] Starting TTS server in background...
    start "OmniVoice TTS" /min cmd /c ""%~dp0scripts\start-omnivoice.bat""
    echo [OmniVoice] TTS loading in parallel, no blocking wait.
) else (
    echo [OmniVoice] TTS server already running.
)

call npm run dev:narrative
pause
endlocal
