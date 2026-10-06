# Workflows step by step

## Contents

- Repair a recording
- Podcast cleanup
- Transcript work
- Music and songs
- Sound effects
- Dubbing
- Recording a take
- Deliver a session
- The cloud

## Repair a recording

1. `formwav_status`.
2. The media: `formwav_list_media` (query a word of its name) or `formwav_import_audio` (path from the person).
3. `formwav_analyze_media`: note the loudness, peak and any measure the problem shows.
4. `formwav_list_effects` with a word from the problem: denoise, dereverb, declick, hum, heal, flutter, pitch.
5. `formwav_apply_effect` with the effect id and moderate parameters; for a leak from another track, `formwav_debleed` with `reference_media_id` the leaking recording.
6. `formwav_analyze_media` on the result; compare with step 3. If worse or too strong, apply again to the original (step 2's id) with other settings.
7. `formwav_export_media` to the path the person names. Report before and after.

## Podcast cleanup

1. `formwav_status`; the media as above.
2. `formwav_analyze_media`.
3. Room or music under the voice: `formwav_separate_speech_music_ambience`, and work on its speech media.
4. Noise or hum left: the repair workflow's steps 4 to 6 on that speech media.
5. `formwav_speech_regions` to report where the speech is and how long the pauses are.
6. `formwav_export_media`. Report each media id and what it is.

## Transcript work

1. `formwav_transcribe_media`: words with start and end seconds.
2. Find the words to change; take the first word's start and the last word's end.
3. `formwav_regenerate_words` with those times and the new text; engine elevenlabs, pocket or chatterbox, whichever `formwav_local_models_status` lists as ready. It returns new media with the words replaced in the speaker's voice and says how much longer or shorter it is.
4. `formwav_transcribe_media` on the new media to confirm the words.

## Music and songs

1. `formwav_local_models_status`: is elevenlabs ready, or ACE-Step's server?
2. `formwav_generate_music` with a prompt (style, mood, instruments), lyrics if it should be sung, and seconds.
3. `formwav_analyze_media` on the result; export or keep for a session.

## Sound effects

`formwav_generate_sound_effect` with a plain description, seconds (0.5 to 30) and loop for ambiences that repeat. ElevenLabs only; with no key, say there is no local path for sound effects yet.

## Dubbing

1. `formwav_local_models_status`: local dubbing languages installed, or the ElevenLabs key.
2. `formwav_dub_media` with the language code (es, fr, it, pt) and engine local or elevenlabs. It returns media the same length as the source, each sentence placed where it was said, and the sentences translated.
3. Report the translated sentences so the person can check them.

## Recording a take

1. `formwav_list_inputs`: the interfaces and their channel counts; empty means no native audio here.
2. `formwav_record` with seconds, the channels (0-based) and the device name.
3. `formwav_analyze_media` on the take.

## Deliver a session

1. `formwav_list_sessions`; `formwav_get_session` for its tracks and length.
2. `formwav_render_session` with the path, the format (wav, flac, mp3) and `what`: mix for stereo, surround51 for six channels, adm for objects and a bed (tracks must be placed on the surround pad in formwav first; paths make them move).
3. Report the path and size; `formwav_cloud_save` if the person wants it in their cloud.

## The cloud

1. `formwav_cloud_status`: which store is connected. Connecting is done once in formwav's File > Cloud, by the person.
2. Into formwav: `formwav_cloud_list_files`, then `formwav_cloud_import` with the file's id and name (a session becomes a saved session, audio becomes media).
3. Out of formwav: `formwav_cloud_save` with a session name or a media id.
