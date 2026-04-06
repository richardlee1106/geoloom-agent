@echo off
cd /d %~dp0
echo [GeoLoom Agent] frontend: http://127.0.0.1:3000
echo [GeoLoom Agent] deps    : http://127.0.0.1:3410
echo [GeoLoom Agent] encoder : http://127.0.0.1:8100
echo [GeoLoom Agent] backend : http://127.0.0.1:3210
call npm run dev:stack
