# Builds the formwav Windows desktop app: the Tauri shell (src-tauri) over the formwav engine frozen with PyInstaller,
# with its native helpers, packaged as an NSIS installer. Run it ON Windows 10 or 11 (x64) from the repo root:
#   powershell -ExecutionPolicy Bypass -File .\build_windows_app.ps1
# It mirrors build_macos_app step for step. The C helpers (Nyquist, Vamp, LV2) are built in MSYS2's UCRT64 shell,
# whose packages give them libsndfile, portaudio and lilv (as Homebrew does on a Mac), linked statically so each is one
# self-contained .exe; the shell, the plugin host and the audio core build with Rust's MSVC toolchain.
$ErrorActionPreference = "Stop"
function Say($text) { Write-Host "`n== $text ==" }
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is required: $hint" } }
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "failed ($LASTEXITCODE): $exe $($arguments -join ' ')" }
}
$Root = $PSScriptRoot

Say "Checking prerequisites"
Need python "Python 3.12 from https://python.org (tick 'Add python.exe to PATH')"
Need npm "Node.js from https://nodejs.org"
Need cargo "Rust from https://rustup.rs (its default MSVC toolchain)"
$Vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $Vswhere)) { throw "Visual Studio Build Tools with 'Desktop development with C++' are required: https://visualstudio.microsoft.com/visual-cpp-build-tools/" }
$Msys = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { "C:\msys64" }
$Bash = Join-Path $Msys "usr\bin\bash.exe"
$Packages = "mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-pkgconf mingw-w64-ucrt-x86_64-libsndfile mingw-w64-ucrt-x86_64-portaudio mingw-w64-ucrt-x86_64-lilv"
if (-not (Test-Path $Bash)) { throw "MSYS2 is required for the native helpers: install it from https://www.msys2.org, then in its UCRT64 shell run: pacman -S --needed $Packages" }
function InMsys($command) {
  # a login shell in UCRT64, started in the repo root, keeping Windows' PATH after its own
  $env:MSYSTEM = "UCRT64"; $env:CHERE_INVOKING = "1"; $env:MSYS2_PATH_TYPE = "inherit"
  Push-Location $Root
  try {
    & $Bash -lc $command
    if ($LASTEXITCODE -ne 0) { throw "MSYS2 step failed: $command" }
  } finally { Pop-Location }
}
InMsys ('for lib in sndfile portaudio-2.0 lilv-0; do pkg-config --exists "$lib" || { echo "MSYS2 lacks $lib: pacman -S --needed ' + $Packages + '"; exit 1; }; done')
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Write-Host "Note: formwav reads and writes most formats through ffmpeg, which it finds on your PATH and never bundles: winget install ffmpeg" }
# the Tauri CLI: cargo's if installed (cargo-tauri.exe), else the npm package (prebuilt, no compile)
$Tauri = if (Get-Command cargo-tauri -ErrorAction SilentlyContinue) { @("cargo", "tauri") } else { @("npx", "--yes", "@tauri-apps/cli@^2") }

Say "Building the interface"
Push-Location (Join-Path $Root "frontend")
Run npm @("install")
Run rustup @("target", "add", "wasm32-unknown-unknown")
# the page's audio core (WebAssembly), stripped of debug info here only (as oc_install does)
$env:CARGO_PROFILE_RELEASE_STRIP = "debuginfo"
Run cargo @("build", "--release", "--locked", "--target", "wasm32-unknown-unknown", "--lib", "--manifest-path", "..\native\formwav-dsp\Cargo.toml")
Remove-Item Env:\CARGO_PROFILE_RELEASE_STRIP
New-Item -ItemType Directory -Force -Path "public\core" | Out-Null
Copy-Item "..\native\formwav-dsp\target\wasm32-unknown-unknown\release\formwav_dsp.wasm" "public\core\formwav_dsp.wasm" -Force
Run npm @("run", "build")
if (-not (Test-Path "dist\core\formwav_dsp.wasm")) { throw "The interface was built without its audio core (dist\core\formwav_dsp.wasm): stopping." }
Write-Host "audio core: dist\core\formwav_dsp.wasm ($((Get-Item dist\core\formwav_dsp.wasm).Length) bytes)"
Pop-Location

Say "Building the engine (Python -> one binary)"
Push-Location (Join-Path $Root "backend")
Run python @("-m", "venv", ".venv-package")
$Py = ".venv-package\Scripts\python.exe"
Run $Py @("-m", "pip", "install", "--upgrade", "pip")
Run $Py @("-m", "pip", "install", "-r", "requirements_desktop.txt")
if (Test-Path wheels) { Remove-Item -Recurse -Force wheels }
# python AND native (a --features flag replaces pyproject.toml's list)
Run ".venv-package\Scripts\maturin.exe" @("build", "--release", "-m", "..\native\formwav-dsp\Cargo.toml", "--features", "python,native", "-o", "wheels")
Run $Py @("-m", "pip", "install", "--force-reinstall", (Get-ChildItem wheels\*.whl | Select-Object -First 1).FullName)
# PyInstaller's data separator on Windows is ;
Run ".venv-package\Scripts\pyinstaller.exe" @("--clean", "--noconfirm", "--onefile", "--name", "formwav-engine",
  "--collect-all", "uvicorn", "--collect-all", "formwav_dsp", "--collect-all", "app", "--hidden-import", "app.main", "--collect-all", "winpty",
  "--add-data", "..\frontend\dist;frontend_dist",
  "--add-data", "..\native\formwav-nyquist\runtime;nyquist_runtime",
  "--add-data", "..\native\formwav-nyquist\plug-ins;nyquist_plugins",
  "desktop_entry.py")
Run "dist\formwav-engine.exe" @("--selfcheck")
Pop-Location

Say "Placing the engine and the helpers for this machine's target triple"
$Triple = ((& rustc -Vv) | Where-Object { $_ -like "host:*" }) -replace "host:\s*", ""
$Bin = Join-Path $Root "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $Bin | Out-Null
Copy-Item (Join-Path $Root "backend\dist\formwav-engine.exe") (Join-Path $Bin "formwav-engine-$Triple.exe") -Force
Run cargo @("build", "--release", "--manifest-path", (Join-Path $Root "native\formwav-host\Cargo.toml"))
Copy-Item (Join-Path $Root "native\formwav-host\target\release\fwhost.exe") (Join-Path $Bin "fwhost-$Triple.exe") -Force
InMsys "native/formwav-nyquist/build_fwnyq && native/formwav-vamp/build_fwvamp && native/formwav-lv2/build_fwlv2"
foreach ($pair in @(@("formwav-nyquist", "fwnyq"), @("formwav-vamp", "fwvamp"), @("formwav-lv2", "fwlv2"))) {
  Copy-Item (Join-Path $Root "native\$($pair[0])\$($pair[1]).exe") (Join-Path $Bin "$($pair[1])-$Triple.exe") -Force
}
# fwlv2 links lilv, serd, sord, sratom and zix as DLLs (MSYS2 ships no static ones); the installer places them beside
# it (src-tauri\tauri.windows.conf.json), where Windows looks first. fwnyq and fwvamp are self-contained.
New-Item -ItemType Directory -Force -Path (Join-Path $Bin "dlls") | Out-Null
Copy-Item (Join-Path $Root "native\formwav-lv2\dlls\*.dll") (Join-Path $Bin "dlls") -Force
Get-ChildItem $Bin | ForEach-Object { Write-Host "sidecar: src-tauri\binaries\$($_.Name)" }

# the icons are committed in src-tauri\icons (regenerating them each build rewrote tracked files)

Say "Building the app bundle (this compiles Rust; the first run takes a while)"
Push-Location (Join-Path $Root "src-tauri")
Run $Tauri[0] (@($Tauri[1..($Tauri.Length - 1)]) + @("build", "--bundles", "nsis"))
Pop-Location

Say "Done"
Get-ChildItem (Join-Path $Root "src-tauri\target\release\bundle\nsis\*.exe") -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "Installer: $($_.FullName)" }
Write-Host "`nYour media, sessions and keys live in %APPDATA%\ai.nodemode.formwav"
Write-Host "(put ELEVENLABS_API_KEY, FAL_KEY or ANTHROPIC_API_KEY in a .env file there)."
