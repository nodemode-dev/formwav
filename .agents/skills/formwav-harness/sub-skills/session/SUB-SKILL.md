---
name: session
description: "Editing the session open in formwav's window through the MCP server: the open session's own tools, the command catalogue (every menu, key and button action), batches that roll back, the outside-agent permission, the window's extensions and their commands, and the window-free command line for saved sessions. Load whenever the job changes tracks, clips, effects on tracks, markers, the loop, tempo, MIDI notes, surround placement or anything else inside a session rather than one media file."
---

# The open session

## Purpose

The other 28 tools make and measure media; they never touch a session's tracks or timeline. Six tools reach the session open in formwav's window, where every change is one undoable step the person can see and take back. This sub-skill says which to use and in what order.

## Preconditions

formwav is running with its window open (the desktop app, or `./formwav` and the page at localhost:3060). The six tools relay through the engine to that window; with no window they fail with "formwav's window is not open". The first call from an agent outside formwav shows the person Allow, Always allow and Block in the window; say so before the first call, and wait for them rather than retrying.

## The six tools

| Tool | Use it to |
| --- | --- |
| `formwav_open_session_tools` | list the window's own session tools (37 at v2.18.0: get_session, set_track_gain, split_clip, apply_effect_to_clip, get_transcript, delete_words, generate_music placed on a track, and the rest) with their input schemas |
| `formwav_open_session_call` | run one of those tools by name with its arguments |
| `formwav_list_commands` | find catalogue commands by `group` (File, Edit, View, Track, Clip, Event, Transport, Settings, Session) or by words in `text` |
| `formwav_describe_command` | read one command's parameters before running it |
| `formwav_run_command` | run one command, for example `track.new-track` or `edit.undo` |
| `formwav_run_commands` | run several in order; the first failure takes back everything the batch did |

Command ids are the menu and the item's words in kebab case (`track.new-track`, `track.duplicate`, `track.move-up`), plus `session.` and the tool's name in kebab case for each session tool (`session.generate-music`). Never guess an id: list, then describe.

Starting points (all `risky`: they replace the open session, so confirm with the person first, and the window asks before dropping unsaved changes):

| Command | What it does |
| --- | --- |
| `demo.open` `{"id": "mix" \| "repair" \| "produce"}` | opens one of the three demos as a new, unsaved session with its recordings: mix, a five-track field report; repair, a noisy 1917 record and three more sources, each with a repair chain; produce, 32 bars at 130 BPM with stems, loops, filter sweeps and a reverb bus |
| `template.new` `{"id": "podcast" \| "voice-over" \| "music" \| "repair" \| "dub" \| "sound-design" \| "blank"}` | starts a new session from a template: named, coloured tracks, buses, sends and effects made by the session's own commands |
| `file.new-from-template`, `help.demos`, `help.mix-demo`, `help.repair-demo`, `help.produce-demo` | the menu items: show Home at the templates or the demos, or open that demo |

## Order of work

1. `formwav_status`, then `formwav_open_session_tools`. If the window is closed, ask the person to open formwav.
2. `formwav_open_session_call` with `get_session`: tracks, clips, ids, the playhead. Keep the ids; names can repeat.
3. Pick the narrowest action: a named session tool when one fits, otherwise a catalogue command found with `formwav_list_commands`.
4. Several changes that only make sense together go in one `formwav_run_commands` batch, so a failure leaves nothing half done.
5. Read `get_session` again and report what changed. Commands flagged `risky` (delete, revert, clear) are confirmed with the person first.
6. Rendering: the person saves (or `file.save` when asked), then `formwav_render_session` by name.

## With no window

`./formwav cli headless commands [words]` lists the engine's document commands (122 at v2.18.0) with their parameters; `./formwav cli headless run --in FILE.fmw --cmd '{"type": "set-track-gain", "trackId": "t1", "gainDb": -6}' --bounce OUT.wav --save OUT.fmw --inspect` applies them to a saved session and bounces it, the same reducer the window uses. `--demo` starts from the demo session. Use this for batch work on files when the person does not need to watch.

## Extensions

formwav loads extensions made to the Form Extension Contract (installed through FormPortal, or run from a folder with form.ext); they show in the window's Extensions menu and Extensions panel. Two tools reach them:

| Tool | Use it to |
| --- | --- |
| `formwav_extensions_list` | list the loaded extensions: id, name, version, source, state (`ready`, `needs-permission`, or `refused` with the reason), permissions, panels and commands |
| `formwav_extension_command` | run one contributed command by the extension's `id` and the command's id, with `args` if it takes any |

The first run of an extension's version shows the person its permissions in the window with Allow and Not now; say so before the call and wait, as with the outside-agent permission. A refused extension cannot run: report its reason (most often "made for another app" or "needs formwav X or newer"). The same tools are the window's `extensions_list` and `extension_command` through `formwav_open_session_call` or the engine's own `/mcp`, and `./formwav cli extensions` and `./formwav cli extension <id> <command> key=value` on the command line. What extensions may do to a session is in `docs/EXTENSIONS.md`.

## Recipes

`references/recipes.md` holds worked sequences: a podcast assembly, a music arrangement pass, notes on a MIDI clip, a surround placement, and recovering from a failed batch.

## Hands back

What changed, as the session's own undo names; the ids touched; anything the person must still approve or save.
