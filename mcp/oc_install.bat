@echo off
cd /d "%~dp0"
python -m venv .venv
.venv\Scripts\python -m pip install -q --upgrade pip
.venv\Scripts\python -m pip install -q -r requirements.txt
echo formwav MCP server ready. Start formwav, then register the server with your agent:
echo   command: %CD%\.venv\Scripts\python.exe
echo   args:    ["%CD%\formwav_mcp.py"]
