@echo off
chcp 65001 >nul
cd /d %~dp0

echo [GeoLoom Agent] 启动前将自动清理目标端口...

echo [GeoLoom Agent] frontend: http://127.0.0.1:3000
echo [GeoLoom Agent] deps    : http://127.0.0.1:3411
echo [GeoLoom Agent] encoder : http://127.0.0.1:8100
echo [GeoLoom Agent] backend : http://127.0.0.1:3210
call npm run dev:v4
pause
