@echo off
setlocal
cd /d "%~dp0"
node scripts\restart-3201.mjs
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
