@echo off
cd /d "%~dp0"
if exist backend call backend\oc_install.bat || exit /b 1
cd /d "%~dp0"
if exist frontend call frontend\oc_install.bat || exit /b 1
cd /d "%~dp0"
echo formwav installed. Run formwav.bat to start it.
