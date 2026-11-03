# Contributing to FormWav

Thank you for helping. FormWav aims to be a free, local-first audio editor that records,
edits, repairs, mixes and exports with no account, no upload and no usage meter, and it
gets there through real use and real contributions.

## Where to start

- **Use it and report what goes wrong.** A clear bug report, with steps, the version
  and your platform, is one of the most useful things you can give.
- **Look at the open issues.** Comment on one before starting larger work, so nobody
  builds the same thing twice.
- **Translations** are welcome: FormWav's interface is in 26 languages, and every new or
  changed string needs all 25 besides English, in new files under
  `frontend/src/i18n/added/<topic>/<code>.json`.

## Setting up

Clone the repository and run `./formwav_oc_install`, then `./formwav` (or
`formwav_oc_install.bat` and `formwav.bat` on Windows). The first installs both sides and
builds the audio core into the engine; the second starts the engine on
http://127.0.0.1:8060 and the interface on http://localhost:3060. You need Node 20.19 or
newer, Python 3.12, Rust stable, git and ffmpeg on the PATH (and the ALSA headers on
Linux); the README's Quick Start has the details. `./formwav help` lists the rest.

The code lives in:

| Folder | What is there |
| --- | --- |
| `backend/app` | the engine (Python, FastAPI): media, effects, render, transcripts, models, the network listener |
| `backend/formwav_mcp` | the MCP server |
| `native/formwav-dsp` | the audio core (Rust): WebAssembly in the browser, a Python module in the engine |
| `frontend/src` | the interface (TypeScript, Vite) |
| `src-tauri` | the desktop shell (Rust, Tauri) |
| `backend/tests`, `frontend/tests/window` | the test suites |

## Before you open a pull request

Run the same checks CI runs (`.github/workflows/checks.yml`):

```sh
(cd frontend && npm ci && npm audit --audit-level=low && npm run build)
(cd native/formwav-dsp && cargo test --locked)
python -m pip install -r backend/requirements.txt -r backend/tests/requirements.txt "ruff==0.16.8"
maturin build --release --auditwheel skip -m native/formwav-dsp/Cargo.toml -o native-dist
python -m pip install native-dist/*.whl
cargo build --release --locked --target wasm32-unknown-unknown --lib --manifest-path native/formwav-dsp/Cargo.toml
mkdir -p frontend/public/core
cp native/formwav-dsp/target/wasm32-unknown-unknown/release/formwav_dsp.wasm frontend/public/core/formwav_dsp.wasm
(cd frontend && npm run build)
python -m playwright install chromium
python -m compileall -q -x '[/\\]\.?venv' backend/app backend/formwav_mcp backend/tests
ruff check --select E9,F63,F7,F82 --target-version py312 --extend-exclude .venv-ear backend
(cd backend && python -m pytest tests -q -rs)
python -m pytest frontend/tests/window -q -p no:cacheprovider
```

The engine tests also expect the MCP server's own venv (`backend/formwav_mcp/venv`, from
`backend/formwav_mcp/requirements.txt`) and the ADM renderer's (`backend/tests/.venv-ear`,
from `backend/tests/requirements_ear.txt`); `python tests/fetch_models.py` in `backend`
fetches the models some tests judge with, so those run instead of skipping. The window
smoke needs the Vamp host (`sh native/formwav-vamp/build_fwvamp`). CI also runs the
interface tests in Firefox (`FORMWAV_TEST_BROWSER=firefox`) and checks the desktop shell
with `cargo check --locked --manifest-path src-tauri/Cargo.toml`.

- Keep each pull request to one change, with tests for what it adds or fixes.
- Write commit subjects the way the history does, in Conventional Commits with the
  version in parentheses. Leave the version alone; a maintainer bumps every version
  site together when releasing.
- Edits are by hand, one region at a time, with no flash or layout shift; every colour
  and size comes from a token in `frontend/src/styles/tokens.css`, and icons are inline
  `currentColor` SVG. No emoji, no em dash in Markdown, no icon-library dependencies.
- Every edit is a command applied by the engine's reducer in
  `frontend/src/engine/document.ts`, and every menu item and session tool is a command
  in `frontend/src/ui/commands.ts`. Each side keeps a `HASHOUT_LOG.md`: read it before
  editing.
- Interface strings go through the translation files, in all 25 languages besides
  English. Never find an element by its visible words in code; use a data attribute.
- When an MCP tool changes, update the `formwav-harness` skill's tools reference, and
  copy `.claude/skills/formwav-harness` over `.agents/skills/formwav-harness` so the two
  stay equal.
- No other product or company competing with FormWav is named anywhere in the
  repository. Never copy another product's help text, presets, sound effects or stock
  audio, and keep demo and test voices synthetic or licensed.
- Every model, binary or data file the engine can install or fetch gets a line in
  `NOTICE` and `LICENSES.md` before it is used. Gated or non-commercial weights are never
  bundled.
- Some features were declined for patent risk and will not come back: content-aware
  scale (seam carving, or any resize that removes or inserts low-energy paths) and
  skin protection, in any form; a heal brush that repairs when the stroke ends or has
  an opacity or strength (the brush only selects, and Heal repairs as its own step);
  and a remixer that changes its costs or penalises a jump after using it.

## Maintainers

FormWav is maintained by:

- the [nodemode-dev](https://github.com/nodemode-dev) organisation on GitHub
- [@nodemode-ai](https://github.com/nodemode-ai)
- [@gbarnai](https://github.com/gbarnai)

Reach them through issues and pull requests.

## How changes land

Only a maintainer pushes to `main`. Everyone else forks the repository and opens a pull request into `main`. A pull request merges when all five CI jobs pass (the interface and engine jobs run on Linux, macOS and Windows; the Firefox job is reported, not blocking) on an up-to-date branch and a maintainer has approved it after its last push.

## Releases

A release is a version, and only a maintainer makes one: after the version is bumped on
`main`, a maintainer cuts a `compile_vX.Y.Z` branch, and formcompiler
(`nodemode-dev/formcompiler`) builds every platform and publishes them together. No push
from a contributor starts a release.

## Licensing

FormWav is licensed under the Apache License 2.0 ([LICENSE](LICENSE)). By contributing,
you agree that your contribution is licensed under the same terms. Only add code you
have the right to contribute, and name any third-party code and its licence in the pull
request.

## Patents and other people's IP

A feature may be held back or removed if it would infringe someone else's patent or
other intellectual property. The maintainers decide.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md) and the
[responsible use](USE_POLICY.md) page. Security problems go through
[SECURITY.md](SECURITY.md), never a public issue.
