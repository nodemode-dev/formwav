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

Lyrics on a note clip (v2.19.6): `apply_document_commands` with `set-note-lyrics` (trackId, clipId, from: the index of the first note in the clip's notes, text: the whole line; one syllable lands on each note in time order, a hyphen splits a word where typed, "-" alone holds the syllable before), `shift-lyrics` (from, by 1 or -1) to fix a line that landed one note off, and `set-sing-syllable` ("da", the default, or "la") for what notes without a lyric sing. Lyrics do not re-render the clip; read them back from `get_session_state`. A note's pronunciation (v2.19.7): `set-note-phonemes` (trackId, clipId, index into the clip's notes, phonemes as ARPAbet with stress digits on vowels, such as ["T", "W", "IH1", "NG"], or null for the lyric's own); the engine gives a word's own with `POST /api/midi/phonemes` {"words": [...]} (source dictionary, derived or guess: correct a guess by hand). Singing (v2.19.8): SoulX-Singer on this machine, installed with `POST /api/providers/local-speech/soulx-singer/install` (2.82 GB, about two minutes; `GET /api/midi/singers` says when it is ready and lists the stock singers, vocalset_f1 a soprano and vocalset_m1 a baritone); `POST /api/midi/sing` {notes: [{start, length (seconds), pitch, phonemes or lyric}], singer, rate, name} answers new media and where its first sample belongs; it takes minutes on a CPU (about 100 s a phrase on two cores), phrases already sung come from a cache, so sing again after an edit rather than starting over. Import the media and place it at `start`. In the window (v2.19.9) it is simpler: select the note clip and run the Event menu's Sing this clip (`formwav_list_commands` group Event); the sung track appears under the note clip, and an edit to the clip sings it again by itself. The singer is the session's (Singer…; `set-singer`). A person's own voice as a singer needs their permission: never confirm it on their behalf; New singer from a recording asks the person in the window, and `POST /api/midi/singers` refuses without `permission: true`.

## Surround placement

1. `formwav_list_commands` text "surround" for the format and fold-down commands.
2. Set the master format first, then each track's placement.
3. `formwav_render_session` with `what` surround51 or adm after the person saves.

## A plug-in live on a track (v2.18.5)

1. `formwav_list_effects` with query "CLAP" (or the window's `list_effects`) for the installed CLAP plug-ins: each is named `plugin:clap:<path>`.
2. `get_session` for the track's chain as it is, then `set_track_effects` with that chain plus `{ "kind": "plugin", "name": "plugin:clap:<path>", "values": { "p<id>": value } }`. Pass a plug-in already in the chain back unchanged, or its saved state goes.
3. Say where it is heard: native output (Settings) and every export, every track lined up for its delay, the fader after it. The browser's engine plays the track without it. Only CLAP plays live; a VST3 or LV2 plug-in is rendered onto the clip with `formwav_apply_effect` instead.
4. To check it, `formwav_render_session` and measure: an insert that could not load fails the render with its reason.
5. A plug-in's own editor (v2.18.6, CLAP on Linux) is the person's: its row's Edit opens the window and Done or closing it keeps the state on the insert. Do not try to drive the window; set values with `values` instead. VST3 and LV2 editors, and windows on macOS and Windows, do not open yet.

## A VST3 instrument on a note track (v2.18.6)

VST3 instruments are listed beside CLAP ones (the window's instrument choice, `/api/midi/instruments`): pick one as the note track's instrument and its clips render through it, notes placed to the sample.

## A batch failed

`formwav_run_commands` returns `ok: false` and one result per command; the failing one says why ("There is no command ...; list_commands gives the ids"). Everything before it was taken back, so fix that one command and send the whole batch again. Do not re-send the commands that succeeded on their own.
