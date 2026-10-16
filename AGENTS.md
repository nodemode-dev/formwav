# Working on formwav (for Codex, Cursor and other agents)

Read README.md first. The reasoning behind each change is in the code logs, `backend/HASHOUT_LOG.md`,
`frontend/HASHOUT_LOG.md` and `native/HASHOUT_LOG.md`, newest first; read the entries for the area you are changing.

Conventions this repository is built under:

- Surgical, hand-made edits to existing files; no scripted rewrites of source
- One engine owns the session: every edit is a command applied by the pure reducer in `frontend/src/engine/document.ts`;
  interface modules dispatch commands and subscribe to the engine
- Stable mounted DOM: patch in place, no flash, no layout shift (each release measures it)
- Every colour and size from a token (`frontend/src/styles/tokens.css`); inline currentColor SVG icons; no emoji
- Preview and export run through the same audio core (`native/formwav-dsp`: WebAssembly in the browser, a Python module
  in the engine), so what plays is what exports
- No claim that was not run; if it was measured, give the number. No em dashes in Markdown
- Versions are v(major).(middle 0 to 99).(minor 0 to 9); a release moves every version site together

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
- The engine binds 127.0.0.1. Only Settings > Devices on this network opens a listener, off by default, for paired
  devices; keep it that way.

Claude Code runs inside formwav (PLAN_v14 W1): `backend/app/services/claude_code.py` finds the user's `claude` and its
environment, `backend/app/routers/claude.py` streams the Agent column's chat and serves `POST /mcp` on the engine, whose
tools are the open window's (the in-app agent's tools, relayed through `/api/bridge/*`), so every agent edits the open
session as undoable steps. A new session tool is added once, in `frontend/src/ui/agent-pane.ts`, and reaches both.
Every menu bar item and session tool is a command in `frontend/src/ui/commands.ts` (W2): a new menu item becomes a
command by itself (menu.words), so give it clear words and a title; agents reach commands through `run_command`.

Agents drive formwav through two surfaces; extend them rather than adding a third. The MCP server in
`backend/formwav_mcp` (started by `backend/formwav_mcp/serve`, or from a checkout by `mcp/formwav_mcp.py`) gives 28 tools over the engine's HTTP API; the in-app
agent (`frontend/src/ui/agent-pane.ts`) gives 34 tools over the session's commands (30 tools and the 4 command tools), placing what it makes on tracks. The playbook in
`.claude/skills/formwav-harness/SKILL.md` (plain Markdown, with sub-skills under it) teaches an agent to use the MCP tools well: what to check first, which tool fits, the
order of steps and how to recover; read it before driving formwav, and update its tools reference whenever a tool changes.

The interface is in 26 languages: code writes English, and `frontend/src/ui/i18n.ts` translates it in place from the tables in `frontend/src/i18n/<code>.json` (keyed by
the English, numbers as {0}, names as {a}). A new interface string needs an entry in all 25 tables, which the interface test for languages lists; never find an element by
its visible words or aria-label in code, and mark containers of user content `translate="no"`.
