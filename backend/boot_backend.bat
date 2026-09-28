@echo off
cd /d "%~dp0"
call venv\Scripts\activate.bat
if exist .env for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
if "%HOST%"=="" set HOST=127.0.0.1
if "%FORMWAV_PORT%"=="" set FORMWAV_PORT=8060
uvicorn app.main:app --reload --host %HOST% --port %FORMWAV_PORT%
