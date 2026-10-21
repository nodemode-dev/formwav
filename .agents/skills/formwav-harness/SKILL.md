---
name: formwav-harness
description: "Drives formwav, the audio editor, through its MCP server (the formwav_* tools) with the judgment the tools lack: which engine is ready, what to measure first, what each edit makes. Use whenever the user wants formwav to edit the open session (tracks, clips, menu commands, batches), repair a recording (noise, hum, clicks, reverb, a leak from another track), clean up a podcast, transcribe or rewrite words in the speaker's own voice, make speech, music, songs or sound effects, dub into another language, split speech, music and ambience, record a take, render a session as a stereo mix, 5.1 or moving ADM objects, or save to Google Drive or Dropbox; when a formwav_ tool (formwav_status, formwav_dub_media or any other) fails, says it needs a key or an install, or does not show up; and when connecting the formwav MCP server to Claude Code, Codex, Cursor or Claude Desktop, or adding or changing one of its tools. Not for formcut (video) or formvis (images), and not for audio work that does not involve formwav."
---

# formwav harness

formwav's MCP server gives an agent 34 `formwav_*` tools that reach formwav's engine: media, repairs, speech, music, dubbing, separation, recording, sessions, renders and the cloud, and, with the window open, the open session itself (its tools and every menu, key and button command). Access is not judgment. Without this harness an agent calls a generator whose engine is not installed, edits before measuring, loses track of which media came from which, or stops dead at a missing key. This pack is the judgment: what to check first, which tool fits, the order of the steps, and what to tell the person when something they must do is missing.

## How this pack is laid out

```
formwav-harness/
  SKILL.md                      you are here: routing, the three core workflows, ground rules, recovery
  EVALS.json                    evaluations and trigger tests
  sub-skills/
    harness-director/           first look: is the engine up, what is installed, which workflow
    tools/                      what each tool does; references/tools.md lists all 34, generated from the server
    session/                    editing the open session: its tools, the command catalogue, batches, the headless CLI
    workflows/                  every workflow step by step; references/workflows.md
    setup/                      connecting Claude Code, Codex, Cursor and Claude Desktop; the troubleshooting checklist
    development/                adding or changing a tool; the tool-change checklist
```

## Routing

| If the request is | Load |
| --- | --- |
| Any formwav job not covered below, or unclear which tool fits | `sub-skills/harness-director/SUB-SKILL.md` |
| What a tool does, its parameters, which of two tools to use | `sub-skills/tools/SUB-SKILL.md` |
| Changing a session: tracks, clips, effects on tracks, markers, MIDI, surround, any menu command, or a saved .fmw with no window | `sub-skills/session/SUB-SKILL.md` |
| A job with several steps: cleanup, words, music, dubbing, delivery, recording, cloud | `sub-skills/workflows/SUB-SKILL.md` |
| Connecting formwav's server to a client, or the tools do not appear | `sub-skills/setup/SUB-SKILL.md` |
| Adding a tool to the server or changing one | `sub-skills/development/SUB-SKILL.md` |

## Ground rules

These hold for every workflow, because each one prevents a failure seen in practice.

- **Check before acting.** Call `formwav_status` first: every tool needs the engine running. Before generating, call `formwav_local_models_status`, which says which engines are installed and which providers have keys, so the first generation call does not fail.
- **Media ids are the handles.** Every tool that makes audio returns a new `media_id`; keep a list of what came from what, and report it at the end.
- **Sources never change.** Every effect, repair, dub or regeneration makes new media. If a result is wrong, go back to the source with other settings rather than stacking fixes on a bad result.
- **Measure before and after.** `formwav_analyze_media` on the source and on the result; report both. A repair without numbers is a guess.
- **Paths come from the person.** `formwav_import_audio`, `formwav_export_media` and `formwav_render_session` read and write files; use paths the person gave, and ask when they gave none.

## The four core workflows

**0. Edit the open session.** With formwav's window open: `formwav_open_session_tools`, `formwav_open_session_call` with `get_session` for the ids, then a session tool, or `formwav_list_commands` and `formwav_describe_command` to find a menu command and `formwav_run_command` to run it; several dependent steps go in one `formwav_run_commands`, which takes everything back on a failure. The first call asks the person to allow the agent in the window. Details in `sub-skills/session/SUB-SKILL.md`.

**1. Repair a recording.** `formwav_status`; find the media with `formwav_list_media` or bring a file in with `formwav_import_audio`; measure with `formwav_analyze_media`; find the repair with `formwav_list_effects` and a word from the problem (dereverb, denoise, click, hum, bleed); apply it with `formwav_apply_effect` at moderate settings, or `formwav_debleed` with the leaking recording as `reference_media_id`; measure the result; export with `formwav_export_media`. When the problem is music or room under speech, `formwav_separate_speech_music_ambience` gives three media that add up to the source exactly.

**2. Work by the words.** `formwav_transcribe_media` gives every word with its times (Whisper, on this machine). From those times: `formwav_regenerate_words` replaces a span with new words in the speaker's own voice; `formwav_dub_media` speaks the whole recording in Spanish, French, Italian or Portuguese; `formwav_speech_regions` finds the pauses where a cut will not land in speech. `formwav_transcribe_with_speakers` adds who said what, through ElevenLabs.

**3. Deliver a session.** `formwav_list_sessions`, then `formwav_get_session` to see its tracks; `formwav_render_session` with `what` set to mix (stereo), surround51 (six channels) or adm (an ADM file whose tracks placed on the surround pad are objects, moving along their paths, and whose bed tracks are a 5.1 bed); then `formwav_cloud_save` when the person wants it in Google Drive or Dropbox.

The other workflows (podcast cleanup, music and songs, sound effects, recording a take, the cloud both ways) are in `sub-skills/workflows/SUB-SKILL.md`.

## When a tool fails

Every formwav tool reports failure as an instruction. Read it to the person; it is usually something only they can do.

- **The engine is not running.** The error names the address it tried. Ask the person to start formwav; nothing else will work until it answers.
- **A key or an install is missing.** ElevenLabs tools need `ELEVENLABS_API_KEY` in formwav's `backend/.env`; ACE-Step needs its own server running (`uv run acestep-api`); Kokoro, Pocket TTS, Chatterbox and dubbing languages install from formwav's Create tab. Say which, offer the engine that is ready instead (`formwav_local_models_status` lists them), and do not retry the same call.
- **A tool name does not resolve.** The server may be older than this skill. Call `formwav_status` for its version and list the tools the client sees; use only names it lists. `sub-skills/tools/references/tools.md` gives the exact names for this version.
- **A workflow stopped partway.** Nothing made so far is lost: every step made new media and kept its source. Report the media ids made, say which step failed and why, and resume from that step once the cause is fixed.

**Skill or server?** Before blaming this skill, call `formwav_status` directly. If that fails too, the problem is the connection or the engine, not the workflow: go to `sub-skills/setup/SUB-SKILL.md`.

## Installing

The skill lives in formwav's repository at `.claude/skills/formwav-harness`, where Claude Code finds it in that folder; elsewhere, upload the packaged `formwav-harness.skill`. The server it guides is connected as `sub-skills/setup/SUB-SKILL.md` describes, and formwav's README links here.
