@echo off
REM Start OmniVoice TTS Server (OpenAI-compatible HTTP API)
REM Requires: pip install omnivoice-server
REM
REM Model cache is stored at data\hf-cache\ (not C:\Users).
REM A junction is created at the default HF cache location if needed.
REM
REM Server listens on http://127.0.0.1:8880 by default.

setlocal

set HOST=127.0.0.1
set PORT=8880
set DEVICE=cuda
set MODEL_ID=k2-fsa/OmniVoice

if "%1"=="--cpu" set DEVICE=cpu
if "%1"=="--port" set PORT=%2

REM Ensure HF cache junction points to project dir (avoids filling C:)
set HF_CACHE_LOCAL=%~dp0..\data\hf-cache
for %%I in ("%HF_CACHE_LOCAL%") do set HF_CACHE_LOCAL=%%~fI
set HF_HUB_CACHE=%HF_CACHE_LOCAL%
set HUGGINGFACE_HUB_CACHE=%HF_CACHE_LOCAL%
set TRANSFORMERS_CACHE=%HF_CACHE_LOCAL%
set OMNIVOICE_MODEL_ID=%MODEL_ID%
set OMNIVOICE_DEVICE=%DEVICE%
set HF_CACHE_DEFAULT=%USERPROFILE%\.cache\huggingface\hub\models--k2-fsa--OmniVoice
if not exist "%HF_CACHE_DEFAULT%" (
    if exist "%HF_CACHE_LOCAL%\models--k2-fsa--OmniVoice" (
        echo [OmniVoice] Creating junction: HF cache -> %HF_CACHE_LOCAL%
        mklink /J "%HF_CACHE_DEFAULT%" "%HF_CACHE_LOCAL%\models--k2-fsa--OmniVoice"
    )
)

echo [OmniVoice] Starting TTS server on %HOST%:%PORT% (device=%DEVICE%)
echo [OmniVoice] Model cache: %HF_CACHE_LOCAL%
echo.

set OMNIVOICE_RUN_DIR=%TEMP%\geoloom-omnivoice
if not exist "%OMNIVOICE_RUN_DIR%" mkdir "%OMNIVOICE_RUN_DIR%"
set OMNIVOICE_LOG_DIR=%OMNIVOICE_RUN_DIR%\logs
if not exist "%OMNIVOICE_LOG_DIR%" mkdir "%OMNIVOICE_LOG_DIR%"
set OMNIVOICE_PID_FILE=%OMNIVOICE_RUN_DIR%\omnivoice-%PORT%.pid
set OMNIVOICE_STDOUT_LOG=%OMNIVOICE_LOG_DIR%\omnivoice-%PORT%.out.log
set OMNIVOICE_STDERR_LOG=%OMNIVOICE_LOG_DIR%\omnivoice-%PORT%.err.log

curl.exe -fsS "http://%HOST%:%PORT%/health" >nul 2>&1
if not errorlevel 1 (
    echo [OmniVoice] TTS server already running.
    echo [OmniVoice] Health: http://%HOST%:%PORT%/health
    endlocal
    exit /b 0
)

set OMNIVOICE_EXE=
for /f "delims=" %%I in ('where omnivoice-server 2^>nul') do (
    set OMNIVOICE_EXE=%%I
    goto :omnivoice_exe_found
)

:omnivoice_exe_found
if "%OMNIVOICE_EXE%"=="" (
    echo [OmniVoice] ERROR: omnivoice-server was not found in PATH.
    echo [OmniVoice] Install it first: pip install omnivoice-server
    endlocal
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$argsList=@('--host',$env:HOST,'--port',$env:PORT,'--device',$env:DEVICE,'--model',$env:MODEL_ID); $p=Start-Process -FilePath $env:OMNIVOICE_EXE -ArgumentList $argsList -WorkingDirectory $env:OMNIVOICE_RUN_DIR -WindowStyle Hidden -RedirectStandardOutput $env:OMNIVOICE_STDOUT_LOG -RedirectStandardError $env:OMNIVOICE_STDERR_LOG -PassThru; Set-Content -LiteralPath $env:OMNIVOICE_PID_FILE -Value $p.Id; Write-Host ('[OmniVoice] Background process started. PID=' + $p.Id)"
if errorlevel 1 (
    echo [OmniVoice] ERROR: failed to start background process.
    endlocal
    exit /b 1
)

echo [OmniVoice] PID file: %OMNIVOICE_PID_FILE%
echo [OmniVoice] stdout log: %OMNIVOICE_STDOUT_LOG%
echo [OmniVoice] stderr log: %OMNIVOICE_STDERR_LOG%
echo [OmniVoice] You can close this window now; the TTS server keeps running in background.

endlocal
