@echo off
chcp 65001 >nul
title PrintPro - установка локального узла
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-local.ps1"
