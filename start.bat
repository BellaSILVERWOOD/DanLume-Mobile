@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DanLume 手机版
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js，请先安装 Node.js 18 或更新版本：https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo 第一次运行，正在安装依赖...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
node server.mjs %*
pause
