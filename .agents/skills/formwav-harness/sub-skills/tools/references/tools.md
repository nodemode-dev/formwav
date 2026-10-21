# formwav's MCP tools

Generated from the server's own listing (34 tools) by the harness's generator; regenerate after any tool change rather than editing by hand (the generator refuses when this grouping and the server disagree). Names are exact and case sensitive.

## Contents

- Check before working
- Find and measure media
- Repair and effects
- Words and speech
- Music and sound
- Recording
- Sessions and delivery
- Cloud
- The open session

## Check before working

### `formwav_status`

Kind: reads only. Parameters: none.

The engine's version and health, and how many media and saved sessions it holds. Call this first to check the engine is reachable; every other tool needs it running.

### `formwav_local_models_status`

Kind: reads only. Parameters: none.

What can make sound on this machine and in the cloud: the local speech engines (Kokoro, Pocket TTS, Chatterbox) and whether each is installed, the dubbing languages installed, whether ACE-Step's server answers, and which cloud providers have their keys; and for every model its source, the licence of its code and weights, where it runs and what leaves the machine. Call it before generating, to pick an engine that will work and that the person may use.

## Find and measure media

### `formwav_list_media`

Kind: reads only. Parameters: `query` (string, default ''), `limit` (integer, default 50), `offset` (integer, default 0).

Stored media, newest first: media_id, name, length in seconds, channels and sample rate. `query` keeps names that contain it (case-insensitive); page with `limit` (1 to 500) and `offset`. Use it to find the media_id another tool needs.

### `formwav_import_audio`

Kind: makes new media or writes a file. Parameters: `path` (string).

Imports an audio or video file from this machine (any format ffmpeg reads) and returns its media. `path` is an absolute path or one starting with ~.

### `formwav_analyze_media`

Kind: reads only. Parameters: `media_id` (string).

Levels of one media: peak and RMS in dBFS, integrated loudness in LUFS, DC offset, clipped samples and length. Measure before and after a repair to show what it changed.

### `formwav_speech_regions`

Kind: reads only. Parameters: `media_id` (string).

Where someone speaks in a media, in seconds (Silero VAD on this machine; under music too). Use it to find pauses for cuts: a cut inside a region lands in speech.

## Repair and effects

### `formwav_list_effects`

Kind: reads only. Parameters: `query` (string, default '').

The effects and repairs formwav can apply, by group, each with its id and its parameters (id, label, min, max, default, unit). `query` keeps effects whose id or label contains it. Pass an effect's id and parameters to formwav_apply_effect; repairs include De-reverb, Spot heal, Wow and flutter, Pitch correction, Dialogue contour, De-click and denoisers.

### `formwav_apply_effect`

Kind: makes new media or writes a file. Parameters: `media_id` (string), `effect` (string), `params` (object/null, default None).

Applies one effect or repair to a media and returns the new media (the source is kept). `effect` is an id from formwav_list_effects; `params` maps that effect's parameter ids to numbers (missing ones take their defaults, values are kept inside their ranges). Example: effect "dereverb", params {"amount": 70, "rt60": 0.8, "floor": 18}. For a CLAP or VST3 plug-in (effect "plugin:clap:..." or "plugin:vst3:..."), params also take "state" (the base64 state a previous run returned as plugin.state, loaded first) and "automation" ({"p<id>": [[seconds, value], ...]}, the parameter moving along the media); the result then carries plugin {name, state}.

### `formwav_debleed`

Kind: makes new media or writes a file. Parameters: `media_id` (string), `reference_media_id` (string), `offset_samples` (integer, default 0), `amount` (number, default 100).

Removes what leaked into a recording from another recording (headphone spill, a backing track, an amp in the vocal mic) and returns the new media. `reference_media_id` is the source of the leak; `offset_samples` is the reference's sample at the recording's first sample (0 when both start together); `amount` 0 to 100 percent.

### `formwav_separate_speech_music_ambience`

Kind: makes new media or writes a file. Parameters: `media_id` (string).

Splits a media into speech, music and effects, three new media that add up to it exactly, on this machine: DeepFilterNet3's speech, then music by the trained TIGER-DnR separator where it is installed (method "trained"; the effects part comes back under ambience) or by harmonic-percussive masks (method "rule").

## Words and speech

### `formwav_transcribe_media`

Kind: makes new media or writes a file. Parameters: `media_id` (string).

Transcribes speech in a media: its words with start and end times in seconds (faster-whisper on this machine; cached, so a second call is instant). Fails with instructions when the speech model is not installed.

### `formwav_transcribe_with_speakers`

Kind: makes new media or writes a file. Parameters: `media_id` (string), `speakers` (integer, default 0).

Transcribes with ElevenLabs Scribe v2 (needs ELEVENLABS_API_KEY): words with times, which speaker said each, and sounds such as laughter as events; kept as the media's transcript too. `speakers` 0 lets it count them.

### `formwav_regenerate_words`

Kind: makes new media or writes a file. Parameters: `media_id` (string), `start_seconds` (number), `end_seconds` (number), `text` (string), `engine` (string, default 'elevenlabs').

Replaces the speech between two times with new words in the speaker's own voice, cloned from the recording, as new media (the source is kept): engine elevenlabs (needs ELEVENLABS_API_KEY), pocket or chatterbox (installed on this machine). Find the times with formwav_transcribe_media.

### `formwav_list_voices`

Kind: reads only. Parameters: `engine` (string, default 'kokoro').

The voices an engine speaks in: kokoro (on this machine, once installed) or elevenlabs (the account's voices, needs ELEVENLABS_API_KEY). Use a returned voice with formwav_generate_speech.

### `formwav_generate_speech`

Kind: makes new media or writes a file. Parameters: `text` (string), `engine` (string, default 'kokoro'), `voice` (string, default '').

Speech from text, as new media: engine kokoro (on this machine; voice a Kokoro voice such as af_heart) or elevenlabs (voice an ElevenLabs voice_id, needs ELEVENLABS_API_KEY).

### `formwav_dub_media`

Kind: makes new media or writes a file. Parameters: `media_id` (string), `language` (string, default 'es'), `engine` (string, default 'local'), `own_voice` (boolean, default false).

Dubs a media's speech into another language, as new media the same length: engine local (Whisper, Argos Translate and Kokoro on this machine; es, fr, it or pt once installed; own_voice speaks it in the speaker's own voice with Chatterbox instead, about 100 s for an 11 s clip) or elevenlabs (needs ELEVENLABS_API_KEY; waits for the job, up to 20 minutes).

## Music and sound

### `formwav_generate_music`

Kind: makes new media or writes a file. Parameters: `prompt` (string), `lyrics` (string, default ''), `seconds` (number, default 30), `engine` (string, default 'elevenlabs').

Music or a song from a prompt, with lyrics sung when given, as new media: engine elevenlabs (needs ELEVENLABS_API_KEY; 3 s to 10 min) or acestep (ACE-Step 1.5's server on this machine, uv run acestep-api; 10 s to 10 min).

### `formwav_generate_sound_effect`

Kind: makes new media or writes a file. Parameters: `description` (string), `seconds` (number, default 5), `loop` (boolean, default False).

A sound effect from a description, 0.5 to 30 s, looping seamlessly when asked, as new media (ElevenLabs, needs ELEVENLABS_API_KEY; there is no open-weight path on this machine).

## Recording

### `formwav_list_inputs`

Kind: reads only. Parameters: none.

The audio interfaces formwav's engine can record from natively, each with its channel count (every channel of an interface, where a browser takes two). Empty when the engine has no native audio here.

### `formwav_record`

Kind: makes new media or writes a file. Parameters: `seconds` (number), `channels` (array/null, default None), `device` (string, default '').

Records a take of `seconds` (at most 600) from a native input (formwav_list_inputs names them; `device` empty for the default), the channels listed (0-based; default the first), as new media.

## Sessions and delivery

### `formwav_list_sessions`

Kind: reads only. Parameters: none.

Saved formwav sessions (.fmw), each with its name; pass a name to formwav_get_session or formwav_render_session.

### `formwav_get_session`

Kind: reads only. Parameters: `name` (string).

One saved session: its sample rate, length, and each track with its realtime effect chain (the Effects tab's: each effect's kind, parameters and whether it is bypassed) and its clips (media_id, media name, where the clip starts on the timeline and how long it is, in seconds).

### `formwav_render_session`

Kind: makes new media or writes a file. Parameters: `name` (string), `path` (string), `format` (string, default 'wav'), `what` (string, default 'mix'), `start` (number/null, default None), `end` (number/null, default None), `normalize` (number/null, default None), `dither` (boolean, default True).

Renders a saved session's mix (every track, its effects and automation, as the app plays it) to a file on this machine: `format` wav (32-bit float), wav32, wav24, wav16, aiff (24-bit), aiff16, aifc (32-bit float), flac (24-bit), flac16, mp3, mp3-192, ogg or m4a; `path` the file to write in an existing folder (replaced if present). `what`: mix (stereo, the default), surround51 (six channels, L R C LFE Ls Rs), surround (the session's own layout, stereo to 9.1.6, one channel per speaker with the WAVE speaker mask) or adm (an ADM BWF: tracks placed on the surround pad as objects, moving along their paths, and tracks marked Bed as a 5.1 bed; always WAV). `start` and `end`, in seconds, render that range only (a mix, surround51 or surround; an end past the last clip keeps the effects' tails); `normalize`, in dBFS, sets the mix's highest sample (-0.1 is usual); `dither` (on unless false) adds TPDF dither to the 16 and 24-bit formats. A WAV carries the session's timecode start in its BWF bext chunk. Returns the file, and for a mix its sample peak, true peak and loudness as written.

### `formwav_export_media`

Kind: makes new media or writes a file. Parameters: `media_id` (string), `path` (string).

Writes one media to a WAV file on this machine and returns the path written and its length. `path` is the file to write (its folder must exist); an existing file there is replaced.

## Cloud

### `formwav_cloud_status`

Kind: reads only. Parameters: none.

Which cloud stores (Google Drive, Dropbox) are set up and connected for saving and opening sessions and media. Connecting is done once in formwav's File > Cloud.

### `formwav_cloud_list_files`

Kind: reads only. Parameters: `provider` (string), `folder` (string, default '').

The files in a connected cloud store's formwav folder (provider google or dropbox): ids and names, to import with formwav_cloud_import.

### `formwav_cloud_import`

Kind: makes new media or writes a file. Parameters: `provider` (string), `file_id` (string), `name` (string).

Brings a file from a connected cloud store into formwav: a session (.fmw) becomes a saved session, audio becomes new media.

### `formwav_cloud_save`

Kind: reaches the cloud. Parameters: `provider` (string), `session` (string, default ''), `media_id` (string, default '').

Saves a saved session (by name) or a media (by id) to a connected cloud store (google or dropbox).

## The open session

### `formwav_open_session_tools`

Kind: reads only. Parameters: none.

The tools of the session open in formwav's window (tracks, clips, effects, transcript, markers, loop, the command catalogue): names, descriptions and input schemas. They run inside the open window, so formwav must be open with a session; call formwav_open_session_call with a name from this list.

### `formwav_open_session_call`

Kind: makes new media or writes a file. Parameters: `tool` (string), `arguments` (object/null, default None).

Runs one tool of the open session (from formwav_open_session_tools), for example get_session, set_track_gain, split_clip or apply_effect_to_clip. Every change is one undoable step in the window.

### `formwav_list_commands`

Kind: reads only. Parameters: `group` (string, default ''), `text` (string, default '').

The open session's command catalogue: every menu, key and button action, with its id and group. Filter by group or by words in text. Needs formwav's window open.

### `formwav_describe_command`

Kind: reads only. Parameters: `command_id` (string).

One catalogue command's parameters, defaults and what it does, before running it with formwav_run_command.

### `formwav_run_command`

Kind: makes new media or writes a file. Parameters: `command_id` (string), `params` (object/null, default None).

Runs one catalogue command on the open session with its params (see formwav_describe_command). One undo step.

### `formwav_run_commands`

Kind: makes new media or writes a file. Parameters: `commands` (array).

Runs several catalogue commands in order, each {"id": ..., "params": {...}}; stops at the first that fails and takes back everything the batch did, so the session is never left half-edited.
