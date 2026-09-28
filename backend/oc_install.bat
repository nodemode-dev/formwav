@echo off
cd /d "%~dp0"
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
where cargo >nul 2>nul || (echo formwav needs Rust to build its audio core: install it from https://rustup.rs, then run this again. & exit /b 1)
maturin develop --release -m ..\native\formwav-dsp\Cargo.toml
