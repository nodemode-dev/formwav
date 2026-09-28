@echo off
cd /d "%~dp0"
npm install
where cargo >nul 2>nul || (echo formwav needs Rust to build its audio core: install it from https://rustup.rs, then run this again. & exit /b 1)
rustup target add wasm32-unknown-unknown >nul 2>nul
cargo build --release --locked --target wasm32-unknown-unknown --lib --manifest-path ..\native\formwav-dsp\Cargo.toml || exit /b 1
if not exist public\core mkdir public\core
copy /y ..\native\formwav-dsp\target\wasm32-unknown-unknown\release\formwav_dsp.wasm public\core\formwav_dsp.wasm >nul
