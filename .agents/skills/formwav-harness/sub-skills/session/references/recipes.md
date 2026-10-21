# Session recipes

Each recipe assumes `formwav_status` answered and `formwav_open_session_tools` listed tools. Ids below are examples: read the real ones from `get_session` and `formwav_list_commands` first.

## Podcast assembly

1. `formwav_import_audio` for each recording (media ids back).
2. `formwav_open_session_call` `generate_*` or the window's import places media on tracks; or ask the person to drag them in.
3. `get_transcript` on the main clip, then `remove_fillers` and `delete_words` for the cuts the person approves.
4. `set_track_effects` with the cleanup chain, `set_track_gain` to balance.
5. `formwav_list_commands` text "loudness" and run the loudness command the person picks.

## Music arrangement pass

1. `get_session` for tracks and tempo.
2. `formwav_run_commands` with `track.new-track` for each new part, then `rename_track` per track (`formwav_open_session_call`).
3. `generate_music` (placed on a track by the window) or `formwav_generate_music` for media to import.
4. `add_marker` at each section, `set_loop` on the chorus to audition.

## MIDI notes

1. `formwav_list_commands` group "Event" for the note operations (quantize, velocity, duration, split notes to a track).
2. `formwav_describe_command` before each: quantize takes a note value and strength.
3. Run them as one batch, then `get_session` to read the clip's note count.

## Surround placement

1. `formwav_list_commands` text "surround" for the format and fold-down commands.
2. Set the master format first, then each track's placement.
3. `formwav_render_session` with `what` surround51 or adm after the person saves.

## A batch failed

`formwav_run_commands` returns `ok: false` and one result per command; the failing one says why ("There is no command ...; list_commands gives the ids"). Everything before it was taken back, so fix that one command and send the whole batch again. Do not re-send the commands that succeeded on their own.
