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
- A clip's `sourceIn` counts the media's samples and its `length` the session's; they differ whenever a file's rate
  differs from the session's.
- `/api/generate` takes `freq`, not `hz`.
- The engine binds 127.0.0.1. Only Settings > Devices on this network opens a listener, off by default, for paired
  devices; keep it that way.

Agents drive formwav through two surfaces; extend them rather than adding a third. The MCP server in
`backend/formwav_mcp` (started by `backend/formwav_mcp/serve`) gives 28 tools over the engine's HTTP API; the in-app
agent (`frontend/src/ui/agent-pane.ts`) gives 21 tools over the session's commands. The playbook in
`.claude/skills/formwav-harness/SKILL.md` (plain Markdown, with sub-skills under it) teaches an agent to use the MCP tools well: what to check first, which tool fits, the
order of steps and how to recover; read it before driving formwav, and update its tools reference whenever a tool changes.
