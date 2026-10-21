---
name: session
description: "Editing the session open in formwav's window through the MCP server: the open session's own tools, the command catalogue (every menu, key and button action), batches that roll back, the outside-agent permission, and the window-free command line for saved sessions. Load whenever the job changes tracks, clips, effects on tracks, markers, the loop, tempo, MIDI notes, surround placement or anything else inside a session rather than one media file."
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

## Order of work

1. `formwav_status`, then `formwav_open_session_tools`. If the window is closed, ask the person to open formwav.
2. `formwav_open_session_call` with `get_session`: tracks, clips, ids, the playhead. Keep the ids; names can repeat.
3. Pick the narrowest action: a named session tool when one fits, otherwise a catalogue command found with `formwav_list_commands`.
4. Several changes that only make sense together go in one `formwav_run_commands` batch, so a failure leaves nothing half done.
5. Read `get_session` again and report what changed. Commands flagged `risky` (delete, revert, clear) are confirmed with the person first.
6. Rendering: the person saves (or `file.save` when asked), then `formwav_render_session` by name.

## With no window

`./formwav cli headless commands [words]` lists the engine's document commands (122 at v2.18.0) with their parameters; `./formwav cli headless run --in FILE.fmw --cmd '{"type": "set-track-gain", "trackId": "t1", "gainDb": -6}' --bounce OUT.wav --save OUT.fmw --inspect` applies them to a saved session and bounces it, the same reducer the window uses. `--demo` starts from the demo session. Use this for batch work on files when the person does not need to watch.

## Recipes

`references/recipes.md` holds worked sequences: a podcast assembly, a music arrangement pass, notes on a MIDI clip, a surround placement, and recovering from a failed batch.

## Hands back

What changed, as the session's own undo names; the ids touched; anything the person must still approve or save.
