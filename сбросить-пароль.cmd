@echo off
chcp 65001 >nul
title PrintPro - аварийный сброс пароля
cd /d "%~dp0printpro-api"
echo.
echo ====== PrintPro: сброс пароля сотрудника ======
echo (запускается на компьютере, где работает сервер)
echo.
set /p LOGIN=Логин сотрудника (напр. admin):
set /p PWD=Новый пароль:
echo.
node scripts\reset-password.mjs %LOGIN% %PWD%
echo.
pause
