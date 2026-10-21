---
name: tools
description: "What each formwav_ tool does, its parameters and what it returns, and which of two similar tools fits. Load when choosing or calling a single formwav tool, or when a call's parameters are in doubt."
---

# The tools

## Purpose

Say which tool does a job and how to call it, without guessing names or parameters: names are case sensitive and a near miss fails at call time.

## How the tools are organised

`references/tools.md` lists all 34 in nine groups (check before working; find and measure media; repair and effects; words and speech; music and sound; recording; sessions and delivery; cloud; the open session), each with its kind, its parameters and defaults, and what it does. It is generated from the server's own listing; trust it over memory.

Three kinds, from each tool's annotations: tools that only read (status, lists, analysis, speech regions, inputs, cloud status and files) can be called freely; tools that make new media or write a file never change a source but do add media or overwrite the named file; `formwav_cloud_save` reaches the person's cloud store.

## Choosing between similar tools

- `formwav_transcribe_media` (Whisper, on this machine, no key) for words and times; `formwav_transcribe_with_speakers` (ElevenLabs Scribe) only when who said what matters and the key is there.
- `formwav_apply_effect` for a catalogue effect on one media; `formwav_debleed` when another recording leaks into this one; `formwav_separate_speech_music_ambience` when speech, music and room must be balanced separately.
- `formwav_generate_speech` with engine kokoro works with no key once Kokoro is installed; engine elevenlabs needs the key. `formwav_list_voices` for the voice names each accepts.
- `formwav_generate_music` engine elevenlabs (a key) or acestep (ACE-Step's server running here); `formwav_generate_sound_effect` is ElevenLabs only.
- `formwav_dub_media` engine local (here, once the language is installed) or elevenlabs (a key, and it waits for the job).
- `formwav_render_session` for a saved session's mix, 5.1 or ADM; `formwav_export_media` for one media.

## Conventions

Times are seconds. Media are `media_id`; sessions are their saved names. Results that are media carry `media_id`, `name`, `seconds`, `channels` and `sample_rate`.
