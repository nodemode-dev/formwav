@echo off
cd /d "%~dp0"
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip || exit /b 1
pip install -r requirements.txt || exit /b 1
where cargo >nul 2>nul || (echo formwav needs Rust to build its audio core: install it from https://rustup.rs, then run this again. & exit /b 1)
maturin develop --release -m ..\native\formwav-dsp\Cargo.toml || exit /b 1
cargo build --release --manifest-path ..\native\formwav-host\Cargo.toml || exit /b 1
call venv\Scripts\deactivate.bat
python -m venv formwav_mcp\venv || exit /b 1
formwav_mcp\venv\Scripts\python.exe -m pip install --upgrade pip || exit /b 1
formwav_mcp\venv\Scripts\python.exe -m pip install -r formwav_mcp\requirements.txt || exit /b 1
