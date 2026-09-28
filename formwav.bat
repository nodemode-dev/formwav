@echo off
cd /d "%~dp0"
start "formwav engine" cmd /k backend\boot_backend.bat
start "formwav interface" cmd /k frontend\boot_frontend.bat
echo formwav interface http://localhost:3060 and engine http://127.0.0.1:8060
