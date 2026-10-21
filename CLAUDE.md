# Working on formwav

Read README.md first. The reasoning behind each change is in the code logs, `backend/HASHOUT_LOG.md`,
`frontend/HASHOUT_LOG.md` and `native/HASHOUT_LOG.md`, newest first; read the entries for the area you are changing.

Conventions this repository is built under:

- Surgical, hand-made edits to existing files; no scripted rewrites of source
- One engine owns the session: every edit is a command applied by the pure reducer in `frontend/src/engine/document.ts`;
  interface modules dispatch commands and subscribe to the engine
- Stable mounted DOM: patch in place, no flash, no layout shift (each release measures it)
- Every colour and size from a token (`frontend/src/styles/tokens.css`); inline currentColor SVG icons; no emoji
- The sparkle icon (three four-pointed stars, or any star-burst standing for AI) is banned everywhere in the app:
  agents are the robot (`agent`), chat the speech bubble (`agentChat`) and terminals the prompt (`terminal`) from
  `frontend/src/ui/icons-agent.ts`, formlit's own icons
- Preview and export run through the same audio core (`native/formwav-dsp`: WebAssembly in the browser, a Python module
  in the engine), so what plays is what exports
- No claim that was not run; if it was measured, give the number. No em dashes in Markdown
- Versions are v(major).(middle 0 to 99).(minor 0 to 9); a release moves every version site together
- No other product or company competing with formwav is named anywhere in the repository (code, comments, interface
  strings in every language, logs, docs, commit messages): describe a feature by what it does, and a file format by
  its extension (".aup", ".aup3"). Licence and copyright notices of vendored code and the model providers the engine
  actually calls are the only names kept
- Declined for patent risk, never to be added: content-aware scale (seam carving or any resize that removes or
  inserts low-energy paths) and skin protection (skin-tone detection that shields regions from an edit), in any form,
  under any name; see NOTICE

Invariants worth repeating, because breaking them is silent:

- A new command type must be dispatched by interface code somewhere, or it is dead.
- A live effect kind lives in many places at once: the core's stage list, the document's kinds and their normalising,
  the player's two maps and its automation list, the lanes' filter lists, the export table in
  `backend/app/services/render.py`, the inspector and the editor tabs. TypeScript catches some of these, not all.
- The studio processors (formwav's own library, `native/formwav-studio`) are one kind, `processor`, carrying the
  library's id and values by name; their table in `frontend/src/engine/processors.ts` must equal the core's
  (`backend/tests/test_processors.py` holds it).
- A clip's `sourceIn` counts the media's samples and its `length` the session's; they differ whenever a file's rate
  differs from the session's.
- `/api/generate` takes `freq`, not `hz`.
- A hosted plug-in on a track (kind `plugin`, the core's 21) plays only where the core is built native: native output
  and exports (`native/formwav-dsp/src/plugin.rs`); the browser's WebAssembly passes it by. The engine loads only a
  CLAP plug-in its scan found (`services/plugins.live_insert`).
- The engine binds 127.0.0.1. Only Settings > Devices on this network opens a listener, off by default, for paired
  devices; keep it that way. Its link for guests from anywhere (also off by default) opens a second one on 127.0.0.1
  only, for the user's cloudflared to tunnel to, and it admits pairing and the recording room and nothing else
  (`remote.GUEST_PATHS`); never widen that set.

Claude Code runs inside formwav (PLAN_v14 W1): `backend/app/services/claude_code.py` finds the user's `claude` and its
environment, `backend/app/routers/claude.py` streams the Agent column's chat and serves `POST /mcp` on the engine, whose
tools are the open window's (the in-app agent's tools, relayed through `/api/bridge/*`), so every agent edits the open
session as undoable steps. A new session tool is added once, in `frontend/src/ui/agent-pane.ts`, and reaches both.
Every menu bar item and session tool is a command in `frontend/src/ui/commands.ts` (W2): a new menu item becomes a
command by itself (menu.words), so give it clear words and a title; agents reach commands through `run_command`.

Agents drive formwav through two surfaces; extend them rather than adding a third. The MCP server in
`backend/formwav_mcp` (started by `backend/formwav_mcp/serve`, or from a checkout by `mcp/formwav_mcp.py`; `.mcp.json`
registers it for Claude Code, `.codex/config.toml` for Codex, `.cursor/mcp.json` for Cursor) gives 34 tools over the engine's HTTP API, six of which reach the open window's session (its 37 tools through `POST /mcp`, the catalogue through `/api/commands`, batches rolled back on failure); the in-app
agent (`frontend/src/ui/agent-pane.ts`) gives 37 tools over the session's commands (33 tools and the 4 command tools; PLAN_v13 S12 added the whole session's state and the engine's own commands, listed with their parameters by `frontend/src/engine/catalogue.ts`), placing what it makes on tracks. With no window, `./formwav cli headless run --in FILE.fmw|--demo --cmd JSON --bounce OUT.wav` applies the same engine commands to a saved session (`backend/app/headless.py`). The project skill
`.claude/skills/formwav-harness` teaches an agent to use the MCP tools well: what to check first, which tool fits, the
order of steps and how to recover; load it before driving formwav, and update its tools reference whenever a tool changes.
`.agents/skills/formwav-harness` is the same skill for agents that do not read `.claude`; copy the folder over it whenever
the skill changes, so the two stay byte for byte equal.

The look is the form family's (formvfx's): `frontend/src/styles/form-family.css`, loaded last, makes panels bordered
cards on a 4 px gutter, 32 px group heads with chip tabs, glass floating surfaces, the family's field surfaces (selects
keep the system arrow: the clipping check allows for it) and timecode colour, all from tokens so every theme follows; a new surface takes its look from there, not from the older
layers (shell.css, workspace.css, frame.css, surfaces.css, canvas.css).

The interface is in 26 languages (PLAN_v14 W7): code writes English everywhere, and `frontend/src/ui/i18n.ts` translates
text, title, aria-label, placeholder, data-empty and data-label in place from `frontend/src/i18n/<code>.json`, tables
keyed by the English with numbers as {0}, {1} and the session's names and file names as {a}, {b}. A new or changed
interface string needs an entry in all 25 languages, in new files `frontend/src/i18n/added/<topic>/<code>.json`
(every added file for a language is merged over its base table; files once written are left as they are): the
interface test
`test_every_string_on_screen_has_a_translation_in_all_twenty_five_languages...` lists what is missing. Never find an
element by its visible words or its aria-label in code (they are translated); use a data attribute. User content
(names, transcripts, the agent's messages) is never translated; mark any new such container `translate="no"`.
