# HASHOUT_LOG · backend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the backend. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v2.12.4
Last updated: 2026-09-30 · the Space group's four echoes named as echoes (the last entry below); the header had read v0.38.0 while entries ran to v0.84.0's SAM-Audio service

---

## Org-navi-map

```
backend/
├── .env.example                 env names with local defaults, copied to .env (never committed)
├── requirements.txt             pinned set · Linux, Windows, servers (includes maturin)
├── requirements_macos.txt       same membership, unpinned · Apple Silicon
├── requirements_desktop.txt     the frozen engine's set, for the desktop builds on all three platforms
├── desktop_entry.py             the desktop app's engine entry; --selfcheck gates the builds
├── oc_install / .bat            venv, requirements, then builds the Rust audio core into the venv
├── boot_backend / .bat          loads .env, runs uvicorn on 127.0.0.1:8060
├── data/                        runtime data (never committed): media/ holds imported audio and its JSON
├── app/
│   ├── main.py                  FastAPI app, CORS, router mounts under /api
│   ├── core/
│   │   ├── config.py            env-driven settings (CORS origins)
│   │   ├── paths.py             data and media folders
│   │   └── version.py           VERSION, one of the version sites
│   ├── routers/
│   │   ├── health.py            GET /api/health, with the audio core's version
│   │   ├── media.py             POST /api/media, GET /api/media/{id}, GET /api/media/{id}/peaks, GET /api/media/{id}/audio
│   │   ├── projects.py          GET /api/projects, PUT and GET /api/projects/{name}, GET /api/projects/{name}/file
│   │   └── render.py            POST /api/render: session document in, float32 stereo WAV out
│   └── services/
│       ├── local_dub.py         dubbing on this machine: Whisper's words, Argos Translate's models, Kokoro's voices
│       ├── media.py             import, probe, atomic storage, peak levels through formwav_dsp
│       ├── projects.py          .fmw packages in data/projects: atomic save, verified open, list
│       └── render.py            clip plan from the document, native render, WAV encoding
└── tests/                       pytest, run from backend: python -m pytest tests (written on the owner's ask, v2.12.5)
    ├── requirements.txt         pytest and Playwright, pinned; requirements_ear.txt the EBU renderer's own venv
    ├── conftest.py              a fresh data folder, no paid keys, the shared speech, a real engine on a free port
    ├── fixtures/                JFK's public-domain speech and ElevenLabs' contract extract (README: their sources)
    ├── stand_ins/               ElevenLabs, ACE-Step and Anthropic answering by their own documents
    ├── test_*.py                one file per area; kinds_probe.mjs and player_plan.mjs load the interface's modules
    ├── mcp_probe.py             the MCP SDK's client against the server, run in the server's venv
    └── e2e/test_interface.py    the built interface in Chromium against a real engine
```

---

## Table of contents

- [oc_install](#oc-install)
- [boot_backend](#boot-backend)
- [requirements.txt and its platform sets](#requirements)
- [desktop_entry.py](#desktop-entry)
- [app/main.py](#app-main)
- [app/core/config.py](#app-core-config)
- [app/core/paths.py](#app-core-paths)
- [app/core/version.py](#app-core-version)
- [app/routers/health.py](#app-routers-health)
- [app/routers/media.py](#app-routers-media)
- [app/services/media.py](#app-services-media)
- [app/routers/projects.py](#app-routers-projects)
- [app/services/projects.py](#app-services-projects)
- [app/routers/render.py](#app-routers-render)
- [app/services/render.py](#app-services-render)
- [app/services/local_dub.py](#app-services-local-dub)
- [tests/requirements.txt and tests/requirements_ear.txt](#tests-requirements)
- [tests/conftest.py](#tests-conftest)
- [tests/fixtures](#tests-fixtures)
- [tests/stand_ins](#tests-stand-ins)
- [tests/test_acestep.py](#tests-acestep)
- [tests/test_adm.py](#tests-adm)
- [tests/test_agents.py](#tests-agents)
- [tests/test_cloud.py](#tests-cloud)
- [tests/test_elevenlabs.py](#tests-elevenlabs)
- [tests/test_engine.py](#tests-engine)
- [tests/test_kinds.py](#tests-kinds)
- [tests/test_local_dub.py](#tests-local-dub)
- [tests/test_local_speech.py](#tests-local-speech)
- [tests/test_mcp.py and tests/mcp_probe.py](#tests-mcp)
- [tests/test_plan_parity.py and tests/player_plan.mjs](#tests-plan-parity)
- [tests/test_remote.py](#tests-remote)
- [tests/test_restoration.py](#tests-restoration)
- [tests/test_room.py](#tests-room)
- [tests/test_speech_regions.py](#tests-speech-regions)
- [tests/test_sync.py](#tests-sync)
- [tests/test_three_way.py](#tests-three-way)
- [tests/e2e/test_interface.py](#tests-e2e-interface)

---

## boot_backend {#boot-backend}

### Settings > Agents: formwav added to Claude Code, Codex, Cursor or Claude Desktop in one click
- refers-to: backend/app/routers/agents.py; backend/app/main.py; frontend/src/ui/agents.ts; src/main.ts; src/styles/workspace.css (.fw-agents-*); .claude/skills/formwav-harness/sub-skills/setup/SUB-SKILL.md; sidecar verification/verify_agents.py
- kind: explainer
- logged: v2.12.3 (in progress) · 2026-10-06

PLAN_v11's 3.2, ported from formcut's agent_connect.py (the same author's). The engine answers with the command an MCP client runs for this copy of formwav (backend/formwav_mcp/serve; on Windows the server's Python with the module and PYTHONPATH) and each client's exact text and file, with whether formwav is in it already; it adds formwav in one click to Claude Code (through claude mcp add, when claude is installed), Codex, Cursor and Claude Desktop. Where formcut wrote Codex's file and showed the rest, formwav also merges into Cursor's and Claude Desktop's JSON, keeping every other server, leaving the previous file as a backup, and refusing a file that is not valid rather than overwriting it; a request through the network listener is refused, these being the person's own files. Checked against a scratch home folder: six clients shown and the command present; Codex's TOML still valid with its setting and its other server kept, a second add not duplicating, a backup left; Cursor's GitHub server kept beside formwav; Claude Desktop's file made; a broken file refused and left byte for byte; Claude Code without claude answered plainly; a paired device refused; and the command Cursor's written file names started by the MCP SDK's client, formwav_status answering. In Chromium (a scratch engine whose home is temporary): Settings > Agents lists the six, three Add buttons here (Claude Code's waits for claude), Copy puts formwav's entry on the clipboard, Add to Cursor writes it and the row reads formwav added, no layout shift, no page error, the real home untouched. The harness skill's setup sub-skill now names this path first.

### The formwav-harness skill, CLAUDE.md and AGENTS.md
- refers-to: .claude/skills/formwav-harness (SKILL.md, five sub-skills, references and checklists, EVALS.json); CLAUDE.md; AGENTS.md; README.md (Connect an agent); sidecar harness/ (the tools-reference generator, the trigger phrases, dist/formwav-harness.skill)
- kind: explainer
- logged: v2.12.2 (in progress) · 2026-10-06

PLAN_v11's 3.0, the owner's harness, emulating formcut's for formwav and made with the god-tier-skill-creator skill through its director (intake, architecture, description, body, payload, audit, evaluation and packaging; media skipped, none carried) with its connector specialist (mcp-skill-builder). The skill is the knowledge layer over the MCP server's 28 tools: the master body's spine is three workflows with exact tool names (repair a recording, work by the words, deliver a session), ground rules (status first, the models status before generating, sources never change, measure before and after, paths from the person), recovery for the four failures (the engine not running, a key or install missing, a tool name that does not resolve, a workflow stopped partway) and the direct-call test that tells a skill failure from a server failure. Sub-skills: harness-director, tools (its reference generated from the server's own listing, the generator refusing when its groups and the server disagree), workflows (nine, step by step), setup (Claude Code, Codex, Cursor and Claude Desktop, over stdio or HTTP, with the troubleshooting checklist), development (the tool-change checklist). Ledger: description 973 of 1024 characters, its 16 should-trigger phrases all covered, 8 near misses sharing words only where an exclusion is named or a setup phrase is generic (none names formwav, which every trigger does); body 62 of 500 lines; 11 of 200 files; 0 of 67 media; 0.04 MB of 30; validator FAIL 0, WARN 0; five evaluations with observable behaviours; packaged as formwav-harness.skill (0.02 MB, archive root formwav-harness/). The evaluations are written, not yet run by a model here. CLAUDE.md and AGENTS.md give agents working on formwav's code its conventions, the silent invariants this sprint learned (commands dispatched, an effect kind's many places, sourceIn in media samples, freq not hz, the loopback rule) and the two agent surfaces.

### The MCP server reaches what formwav has gained: 28 tools, each checked by a real MCP client
- refers-to: backend/formwav_mcp/server.py; sidecar verification/verify_mcp.py
- kind: explainer
- logged: v2.12.1 (in progress) · 2026-10-06

PLAN_v11's 3.1. The server had twelve tools (media, effects, repairs, sessions, render, Whisper). Sixteen join them, each a thin call to a route the engine already serves and its earlier checks cover: the local models' status (which engines and dubbing languages are installed, which providers have keys); voices; speech (Kokoro here or ElevenLabs); music and songs (ElevenLabs or ACE-Step's server); sound effects; speech regions (Silero VAD); transcription with speakers (Scribe v2); Regenerate in the speaker's cloned voice (ElevenLabs, Pocket TTS or Chatterbox); dubbing (here, or ElevenLabs with its job polled); speech, music and ambience as three media; native inputs and a timed native take; and the cloud's status, files, import and save. The render tool gains what: a stereo mix, 5.1, or ADM objects with their paths and the bed. Checked as an agent meets it: the MCP SDK's own client (2.2.0) starts the server over stdio, lists 28 tools and calls each against the running engine; 34 of 34 checks pass. Where it can work here it returns its result (54 Kokoro voices, speech and its regions, the JFK transcript, the Spanish dub saying ustedes, three stems of 11 s, a saved session rendered as a mix, 5.1 and ADM, that ADM 99 percent left at the start and 100 percent right at the end with its bed 100 percent centre in EAR); where a key, an install or a device is missing here it fails with what a person needs to do (ELEVENLABS_API_KEY, acestep-api, not installed, Connect Dropbox first, the audio device). Not yet tools: mixing edits on a saved session, and cutting words out of media; the in-app agent has its own word tools.

### Objects that move and a bed, checked in the EBU's own renderer
- refers-to: backend/app/services/adm.py (paths as block sequences, a 5.1 bed on the common definitions, an explicit CHNA); frontend/src/engine/document.ts (surround.path, surround.bed); src/ui/inspector-pane.ts (Add point at playhead, Clear path, Bed); sidecar verification/verify_adm_ear.py, ear_share.py, earvenv (EAR 2.1.0)
- kind: explainer
- logged: v2.12.0 (in progress) · 2026-10-06

The comparison's L2 in part. formwav's ADM BWF export wrote one still block per object and no bed. A track's surround now carries a path (points of time and place, set from the inspector: Add point at playhead takes the dot's place, Clear path, the pad's drag and the controls keeping the path) and a bed flag. The export writes a moving object as blocks: still until its first point (or for 1 ms when it starts at zero), then one block per segment whose position is the segment's end, which a renderer reaches by interpolating over the block; bed tracks are mixed by render_51, as formwav's 5.1 export mixes them, and written as six DirectSpeakers channels on BS.2094's common definitions (AP_00010003). Checked in the EBU ADM Renderer (EAR 2.1.0, BSD-3-Clause-Clear, run in its own venv): the export as it was placed static objects exactly (+30, -30 and 0 degrees in M+030, M-030 and M+000, all 100 percent), so the structure was sound; a moving object first stayed at its destination throughout, since a renderer interpolates from the previous block and the first point had none, and the 1 ms block fixed it (99 percent left at the start, 50 and 50 midway, 100 percent right after); the bed's centre and left surround 100 percent in M+000 and M+110. End to end from the interface: a path built with the buttons and the pad, a track ticked Bed, the file from the export route, the same figures in EAR, no layout shift, no page error. That test's first run measured nothing real: /api/generate takes freq, not hz, and gave two 440 Hz tones; the file itself was right. Not yet: hearing the objects inside formwav through a renderer, and an OMF reader.

### The claims audit: the README's counts checked against the code, and kept checked
- refers-to: README.md; backend/app/services/local_speech.py (engine sizes); sidecar verification/audit_claims.py (in the release gate from v2.11.8)
- kind: fix
- logged: v2.11.8 (in progress) · 2026-10-06

PLAN_v11 Phase 2's claims audit. A script reads each countable claim from the README and computes its truth from the code or the live engine: the live effect kinds (the document's kind set), formwav's own catalogue (the engine's effects less the plug-ins found on the machine, 256 here, which is why the 114 holds while the engine lists 370), the MCP server's tools, the theme profiles, the undo depth, the export formats, the memory arithmetic, the version, and whether the loopback sentence admits the network listener; it also lists the interface's and the engine's size strings for review. Its first run found the README four times saying sixteen live effect kinds (there are nineteen since de-hum, de-click and de-reverb), eight export formats (seven, MP3 at two bitrates in the dialog), "nothing listens on the network unless HOST says so" while Settings > Devices opens a listener (off by default, paired devices only), Kokoro's install as about 400 MB (570 MB measured), and Pocket TTS's and Chatterbox's sizes stated as figures nobody measured. The audit's own first faults were fixed before it was trusted (a pattern matching "the realtime effects", the Status history counted as current, a theme count of zero from a misread module). The README's descriptions were brought to what exists (the menus' Cloud, Share and Devices; the Clip tab's new actions; the agent's transcript tools; the models; the routers), and its Not built list gained every limit found since: models checked against stand-ins and not run with real keys or servers, Pocket TTS and Chatterbox unrun, Enhance speech behind Adobe, no local sound effects, shared editing and remote recording on the local network only.

### Dubbing made on this machine: Whisper's words, Argos Translate's models, Kokoro's voices
- refers-to: backend/app/services/local_dub.py; app/routers/providers.py (/api/providers/local-dub...); frontend/src/ui/models-pane.ts; sidecar verification/verify_local_dub.py
- kind: explainer
- logged: v2.11.6 (in progress) · 2026-10-06

The comparison's open-weight paths (PLAN_v11 2.M5): dubbing needed ElevenLabs. Now the clip's transcript (Whisper) is grouped into whole sentences, translated by Argos Translate's model for the pair (a CTranslate2 model and its SentencePiece tokenizer, run in the speech runtime with ctranslate2 and sentencepiece alone, since the argostranslate package brings stanza and PyTorch; the model's README names its training data, the OPUS corpora, and states no licence, so none is claimed), spoken by Kokoro in a voice of the language, and each sentence placed where it began, sped up with ffmpeg's pitch-keeping atempo by at most 1.35 times when it would run into the next. Spanish, French, Italian and Portuguese install on request (about 90 MB each). Measured on the JFK speech into Spanish, in 8.6 s here: the translation against the standard human rendering, word F1 0.93; the dub transcribed back by a multilingual Whisper told the language, word F1 0.90 against what was to be said; placed at 0.00 s, no speed-up or cut needed, the length the source's to the millisecond. The first run split the sentence at JFK's 1.4 s pause after "my fellow Americans": the second half, translated alone, came back in the informal singular (F1 0.65); sentences are now whole (end punctuation, a break over 1.5 s, or past 15 s). In the Create tab's Models: Dub a clip on this machine and Install a dubbing language, the language list following the task; in Chromium the clip dubbed onto a new track at its start and of its length, no layout shift, no page error.

### Speech, music and ambience as three faders
- refers-to: backend/app/services/three_way.py; app/routers/media.py (POST /api/media/{id}/three-way); frontend/src/ui/clip-tab.ts (Speech, music and ambience to three tracks); sidecar verification/verify_three_way.py
- kind: explainer
- logged: v2.11.4 (in progress) · 2026-10-06

The comparison's Adobe row (PLAN_v11 2.M4): a clip split into speech, music and ambience, each on its own track at the clip, so the session's faders are the three faders; the original track is muted in the same undo step when the clip is alone on it. Speech is DeepFilterNet3's dialogue (RX-16's model); the rest is split as separate.deconstruct splits a range (harmonic and percussive separation, RX's Deconstruct as reference), ported to numpy so it runs without PyTorch, with soft masks: a bin is music in proportion to how far its tonal or transient median stands over the other, all of it at twice; the ambience is defined as the remainder less the music, so the three add up to the clip sample for sample. Measured on a stereo mix with known parts (speech in the centre; chords, bass, kick and hat 8 dB under; decorrelated pink noise swelling 14 dB under): the stems' sum within 3.2e-8 of the mix (float storage); SI-SDR against each true part, speech 12.1 dB (the mix itself 7.0), music 0.7 (-8.2), ambience -3.9 (-14.5), gains of 5.1, 8.8 and 10.6 dB. Deconstruct's binary masks gave music -1.9 and ambience -5.5 on the same mix; soft masks were adopted for that and for their absence of musical noise. Music and ambience still carry each other's leakage (DeepFilterNet leaves some speech in the remainder, and a steady chord and steady noise differ only in degree); Demucs where it is installed separates music further. In Chromium: three tracks the clip's length at its place, the original muted, one undo restoring it, no layout shift, no page error.

### The agent edits by transcript: words read, cut and rewritten as the Transcript tab does
- refers-to: frontend/src/ui/agent-pane.ts (get_transcript, delete_words, remove_fillers, rewrite_words); src/ui/transcript-pane.ts (sessionWords, rangesOf exported); sidecar verification/verify_agent_transcript.md
- kind: explainer
- logged: v2.11.2 (in progress) · 2026-10-06

The comparison's Descript row: the agent could not edit by the words. It now has four tools built on the Transcript tab's own functions, so its edits behave as the person's: get_transcript (every word in session order with index, speaker, times and a filler flag; clips not yet transcribed are transcribed on this machine), delete_words (ranges of indexes cut with clear-ranges across every track, the gap closed, as Delete does), remove_fillers, and rewrite_words (words in one clip spoken again in the speaker's cloned voice through Regenerate, ElevenLabs or a cloning engine installed here, later clips on the track moved by the change). Checked with a scripted model through a scratch engine and the ElevenLabs stand-in: "my fellow" cut (0.8 s), the opening rewritten, two later clips moved, the timeline ending at 10.450 s as computed, two undos restoring the clip, no page error.

### Regenerate doubled a clip rewritten from its first word
- refers-to: backend/app/services/providers.py (_splice); sidecar verification/verify_elevenlabs.py (exact lengths at the start and the end)
- kind: fix
- logged: v2.11.2 (in progress) · 2026-10-06

Found by the agent's rewrite_words check: rewriting "And so" at the very start of the JFK clip made a clip 12 s long instead of 1 s. The splice shared one crossfade length by both ends, at least one frame: with the words starting at frame 0 it was forced to one, and x[: a - f] read as x[:-1], the whole recording, so the new media held the source and then the splice (1,068,477 frames where 540,480 were due). A rewrite of the opening is common, and the same trap sat at the very end. Each end now has its own crossfade, none where there is nothing to fade from. Measured: at the start, in the middle and to the end of the JFK media the new lengths are the source less the replaced span plus the new speech less 480 frames per faded end (none at an edge), exactly. verify_elevenlabs.py now checks exact lengths at the very start and the very end; against the code before the fix both fail (198k and 110k frames where 109,809 are due).

### Speech made on this machine: Kokoro, Pocket TTS and Chatterbox from formcut, and Regenerate's open-weight path
- refers-to: backend/app/services/local_speech.py; app/services/providers.py (_splice, shared by ElevenLabs' and local regeneration); app/routers/providers.py (/api/providers/local-speech...); frontend/src/ui/models-pane.ts; sidecar verification/verify_local_speech.py, elevenlabs_contract.py (voices/add; literal paths first), verify_elevenlabs.py (Regenerate)
- kind: explainer
- logged: v2.11.1 (in progress) · 2026-10-06

From formcut's local speech, the same author's: Kokoro (Apache-2.0, ONNX, 54 voices, no cloning), Pocket TTS (Kyutai, MIT code and CC-BY-4.0 weights, voices and cloning) and Chatterbox (Resemble AI, MIT, cloning, every output watermarked), installed on request into a speech runtime of their own in formwav's data folder, never into the engine, and run there as workers. Their cloning gives Regenerate an open-weight path: the speaker cloned from up to 20 s of the same clip around the selection, the new words made at the clip's rate and spliced in by the same code as ElevenLabs' (the splice now shared, _splice; ElevenLabs' Regenerate re-checked through its contract stand-in, which had matched /v1/voices/add as /v1/voices/{voice_id} until literal paths were tried first). Kokoro was installed here through formwav's own path (the runtime, kokoro-onnx 0.6.1, its two model files, about 570 MB) and run on this CPU: 54 voices; a sentence spoken in 4.3 s for 4.04 s of audio, which formwav's Whisper transcribed back with 92 percent of the words (the one miss, the invented word formwav heard as Form WAV). Local Regenerate's pipeline, with Kokoro standing in for the cloning model, took its reference from the same clip at its 48 kHz, replaced 3.30 to 4.38 s with 1.05 s, and the new media came to the source plus the reported delta exactly. Pocket TTS and Chatterbox bring PyTorch, about 1 and 2 GB, which this machine has no room for (629 MB free after Kokoro): their cloning is unrun here. In the Create tab's Models: speech by Kokoro with its voices, speech in a clip's voice and on-machine Regenerate for Pocket TTS and Chatterbox (each naming its install and size until installed), and Install a speech engine on this machine with its progress; Kokoro spoke from the pane in a chosen voice onto a new track, no layout shift, no page error.

### Where people speak: Silero VAD from formcut, speech regions and the speech-safe cut
- refers-to: backend/app/services/vad.py; app/routers/media.py (GET /api/media/{id}/speech, /speech/cut); frontend/src/ui/clip-tab.ts (Mark where people speak); sidecar verification/verify_vad.py
- kind: explainer
- logged: v2.11.1 (in progress) · 2026-10-06

Asked by the owner (proper speech detection), from formcut's speech module, the same author's: Silero VAD (MIT, ONNX, 2.3 MB, fetched once from Silero's repository and checked against the hash it had when this was written) gives a speech probability every 32 ms, under music too, which word times and loudness pauses cannot. From it come speech regions (above 0.5, at least 250 ms, gaps under 300 ms joined) and formcut's speech-safe cut rule (unsafe with speech on both sides within 100 ms). Measured: the JFK speech gave four stretches, 7.58 s of speech in 11 s; under a music bed 6 dB below it, chords and plucks, four stretches agreeing on 96.2 percent of the clean speech's time; the bed alone, none; a cut inside speech unsafe and one in a pause safe. In the Clip tab, Mark where people speak adds the clip's speech as regions in one undo step: in Chromium, four Speech regions matching the engine's, one undo removing them, no layout shift, no page error.

### ACE-Step 1.5 on this machine: songs, covers, repaints, layers, extraction and completion
- refers-to: backend/app/services/acestep.py; app/services/providers.py (the provider entry); app/routers/providers.py (/api/providers/acestep, /generate); frontend/src/ui/models-pane.ts; sidecar verification/acestep_contract.py, verify_acestep.py
- kind: explainer
- logged: v2.11.0 (in progress) · 2026-10-06

Asked by the owner: ACE-Step integrated locally, correctly. Until now formwav reached ACE-Step only through fal's hosted service. It now drives ACE-Step 1.5's own REST server (acestep-api, MIT), which the owner runs where a GPU or enough memory is (the standard download is 10.09 GB; this build machine has 3 GB of memory and no GPU, so it cannot run it here). Every request follows ACE-Step's API.md (research/acestep): a task released with POST /release_task, JSON for text2music and multipart with the clip as src_audio for cover, repaint, lego, extract and complete; polled with POST /query_result until its status is 1 (or 2, failed); the audio fetched from /v1/audio. One result per task in lossless WAV, where the server's default is two; the documented ranges kept (10 to 600 s, a repaint's end after its start or -1 for the end, cover strength 0 to 1); the server's bearer key sent when ACESTEP_API_KEY is set. API.md names no field for which instrument lego adds or extract takes beyond an instruction it writes from the task, so the layer is described in the prompt and no field is invented. ACE-Step is in the providers list as ready only when its server answers, and a stopped server is reported as where it was looked for and how to start it. Checked by a stand-in holding every request to API.md: all seven calls pass (a 5 s request raised to the 10 s floor, a repaint ending before its start sent as to the end), none of 30 requests breaking the document; the negative control caught an unknown field, an unknown task, 700 s, a batch of nine, a cover with no source and a missing key. In the interface, the Create tab's Models offers six ACE-Step tasks (a song; a cover with its strength; a repaint of From to To seconds in the clip, or the time selection where it falls on the clip; a layer added; a part extracted; a clip completed), each landing at the clip's start; run through it, 26 requests conforming, no layout shift, no page error; with the server stopped, each task names what it needs. Unrun on the real server here; the owner's run is what will say how they sound.

### ElevenLabs, every model the API offers, each request checked against ElevenLabs' own contract
- refers-to: backend/app/services/providers.py (elevenlabs_models, _change_voice, _music, _stems, _isolate, _sound, _transcribe, _design, _save_voice, _dialogue, _align, _dub_transcript); app/routers/providers.py; frontend/src/ui/models-pane.ts; sidecar verification/elevenlabs_contract.py, verify_elevenlabs.py
- kind: explainer
- logged: v2.10.9 (in progress) · 2026-10-06

Asked by the owner, verified as he asked: every request built from ElevenLabs' OpenAPI document (fetched from api.elevenlabs.io, research/NOTES_v11_program.md), not from memory. Added: the account's models with what each can do (the voice changer lists the voice-conversion ones rather than a hard-coded id, the document naming only an English one); the voice changer (speech to speech, background noise removed on request); music and songs (prompt, lyrics sung, 3 s to 10 min, music_v1, v2 or v2_5, instrumental only); stems (six, or vocals and the rest, unzipped into media); voice isolation; sound effects now with loop and prompt influence (eleven_text_to_sound_v2); Scribe v2 transcription (speakers told apart, sounds such as laughter tagged, key terms, entities), written where formwav keeps transcripts, so the Transcript tab, transcript editing and subtitles use it as their own; voice design (three previews) and keeping one as a voice; multi-voice dialogue; forced alignment of a script, kept as the clip's transcript; a dub's translated subtitles. The document has no music inpainting endpoint, only a flag that stores a song for it, so none is claimed. Checked by a stand-in that holds every request to the document (path and method, the key, content type, required and unknown fields, enums, numeric ranges, one level into arrays, query parameters): formwav's existing calls already conformed; all 18 routes, old and new, pass with no request breaking the contract. A negative control caught an invalid model, an unknown field, an undeclared query, a missing key and a missing required field, and missed a 45 s sound effect: the document gives that range in words only, so the stand-in now reads ranges stated in a field's description too (it then caught 45 s and a 1 s song, accepted 12 s and 30 s), and formwav's own clamps keep both in range. In the interface, the Create tab's Models pane offers the fourteen ElevenLabs tasks; run through it against the stand-in: music, a changed voice, an isolated voice, six stems on their own tracks in one undo step, a Scribe transcript (two speakers, a laughter event), three designed previews and one kept, a dialogue, an aligned script and a looping sound, with all eleven requests conforming, no layout shift and no page error. Unrun with a real key: the stand-in answers as the document describes, not as ElevenLabs' models sound.

### Takes lined up by their sound: formcut's multicam sync, refined to a fraction of a sample
- refers-to: backend/app/services/sync.py; app/routers/media.py (POST /api/media/sync); frontend/src/ui/clip-tab.ts (Line up by sound); sidecar verification/verify_sync.py
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison's Multitrack recording row noted takes from different devices sitting about 2 ms apart, each device keeping its own clock; a remote room's takes line up by a shared clock only to the network's round trip. formcut's multicam sync (the same author's) lines camera angles up by their sound on ten-millisecond loudness envelopes, right for pictures and too coarse for audio, so it is the first stage here, ported with its sign, normalisation, confidence floor and its rule that among near-equal peaks the smallest lag wins; the second stage cross-correlates the waveforms at full rate with the phase transform, a few envelope steps either side, and places the peak between samples by a parabola. Measured against known delays through differently coloured copies of the JFK speech (another microphone: duller, half the level, its own noise): 2.317 ms found as 2.3144 (0.125 samples off), -37.5 ms as -37.4982 (0.086), 450 ms as 449.9969 (0.149), and unrelated noise refused at a match of 0.074. A first run showed every lag 0.593 ms off by the same amount; the cause was the test's colouring filter, one-sided and convolved centred, which moved the copies; a symmetric filter colours without moving. In the Clip tab, Line up by sound takes the selected clip as the reference, measures every clip on another track that overlaps it over the stretch both cover, and moves the strong matches in one undo step; a take that would cross the session's start stays at zero and slips its sound instead (clamping it there would have left the commonest case, takes started together, unmoved). In Chromium: a take 2.317 ms late slipped 111 samples at zero, one 37.5 ms early moved 1,800 samples, the noise was left and named, one undo restored all three, no page error; two layout-shift entries of 0.0001 as the clips moved, to attribute at the gate.

### boot_backend · host and port
- refers-to: boot_backend :: the uvicorn line (last line)
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Binds `127.0.0.1` unless `HOST` is set, per dev-rules `references/scripts.md`: a local build never listens on the network, and deploy targets that need another address set `HOST` explicitly. The dev-rules template binds `0.0.0.0`; that line was not carried over. The port comes from `FORMWAV_PORT`, default 8060, matching the Vite proxy target and the README ports table. `.env` is exported into the shell before uvicorn starts so `HOST` and `FORMWAV_PORT` from it reach the command line, which uvicorn's own `--env-file` would not do.

### boot_backend.bat · .env loading
- refers-to: boot_backend.bat :: the `for /f` line
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Reads `.env` as `NAME=value` lines, skipping lines that start with `#`, and sets each for the session before the defaults apply. Windows scripts are stored with CRLF line endings, pinned by the root `.gitattributes`.

---

## requirements.txt and its platform sets {#requirements}

### requirements.txt · httpx and onnxruntime, missing since v2.10.8
- refers-to: requirements.txt, requirements_macos.txt, requirements_desktop.txt :: the package lists
- kind: rationale
- logged: v2.12.5 · 2026-10-06

A fresh install's engine did not start from v2.10.8 to v2.12.4: app/routers/cloud.py imports httpx when the engine loads, and no requirements file listed it. The development machine had httpx installed by hand, so no check saw it; the release gate's fresh clone built only the interface. Found when this session moved to a new machine and the repository's own installer was the only way back: `from app.main import app` failed with No module named httpx. Silero VAD's onnxruntime was missing the same way (imported when Mark where people speak runs). An import scan over app/ found these two and nothing else unaccounted for: every other third-party module is an optional component with its own file (transcript, separate, voice, sam_audio). Pinned: httpx 0.28.1 (the MCP server's venv resolves the same) and onnxruntime 1.30.0, each with Python 3.12 wheels for Linux x86_64, macOS arm64 and Windows amd64. requirements_desktop.txt, which builds the desktop app's frozen engine on all three platforms, also lacked pyaaf2, so AAF import and export failed inside the desktop app.

---

## desktop_entry.py {#desktop-entry}

### desktop_entry.py · selfcheck imports the engine
- refers-to: desktop_entry.py :: selfcheck (engine_imports, after the core's native features)
- kind: rationale
- logged: v2.12.5 · 2026-10-06

The build scripts gate on `--selfcheck`, which imported fastapi, uvicorn, numpy and the audio core but never the engine itself, so a frozen engine missing httpx passed it and then could not start inside the app. The selfcheck now imports app.main as the app will and fails with the import's message. Checked both ways: it passes on a complete engine, and with httpx made unimportable (as in the desktop builds from v2.10.8 to v2.12.4) it prints "the engine could not be imported: import of httpx halted" and exits 1.

---

## app/main.py {#app-main}

### app/main.py · CORS middleware
- refers-to: app/main.py :: `app.add_middleware(CORSMiddleware, ...)`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

The dev server on 3060 proxies `/api` to the engine, so the browser normally never makes a cross-origin call. CORS is still configured for direct calls from the dev and preview origins (3060, 3061). Any other origin gets no CORS header; verified with a foreign `Origin` header in v0.1.0.

### app/main.py · router mounting
- refers-to: app/main.py :: `app.include_router(health.router, prefix="/api")`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Every route lives under `/api`, the prefix the Vite proxy forwards. New route modules are mounted here, one line each, until a feature registry replaces the list (formcut's lesson: routers mount from one declared list, never from inside a loop that mounts per module).

---

## app/core/config.py {#app-core-config}

### app/core/config.py · cors_origins
- refers-to: app/core/config.py :: `cors_origins()`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Comma-separated list from `FORMWAV_CORS_ORIGINS`; the default names the dev server and the preview server on both `localhost` and `127.0.0.1`.

---

## app/core/version.py {#app-core-version}

### app/core/version.py · VERSION
- refers-to: app/core/version.py :: `VERSION`
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

One of the version sites, bumped by hand in the release commit together with `frontend/package.json`, both version fields in `frontend/package-lock.json`, `native/formwav-dsp/Cargo.toml` and the README badge. Always `x.y.z` with dots.

---

## app/routers/health.py {#app-routers-health}

### app/routers/health.py · health
- refers-to: app/routers/health.py :: `health()`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Liveness and identity: returns the engine's name and version. The interface reads it to show whether the engine is reachable.

### app/routers/health.py · core field
- refers-to: app/routers/health.py :: `health()`, the `core` key
- kind: explainer
- logged: v0.2.0 · 2026-09-28

The audio core's version, or `missing` when `formwav_dsp` is not importable, so a broken install is visible from one request.

---

## oc_install {#oc-install}

### oc_install · building the audio core
- refers-to: oc_install :: the `cargo` check and the `maturin develop` line (and the same two lines in oc_install.bat)
- kind: rationale
- logged: v0.2.0 · 2026-09-28

From v0.2.0 the engine's audio code is the Rust crate itself, built into the venv as the Python module `formwav_dsp`, so there is one implementation of decoding and peaks rather than a Rust one and a Python one. That makes Rust a requirement for installing from source; the script stops with the rustup address when `cargo` is missing. `maturin` is pinned in requirements.txt beside the runtime packages because it runs inside the same venv. The `.bat` lines were added with LF endings inside a CRLF file; `.gitattributes` normalises them on commit and checkout.

---

## app/core/paths.py {#app-core-paths}

### app/core/paths.py · data_dir
- refers-to: app/core/paths.py :: `data_dir()`, `media_dir()`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

`FORMWAV_DATA_DIR` when set, otherwise `backend/data`, which the root `.gitignore` excludes. `media_dir()` creates `media/` on first use. A platform data folder (as formcut uses) replaces the default when the desktop build arrives.

---

## app/routers/media.py {#app-routers-media}

### app/routers/media.py · import without multipart
- refers-to: app/routers/media.py :: `import_media`
- kind: rationale
- logged: v0.2.0 · 2026-09-28

The file travels as the raw request body with its name in a URL-encoded `X-Filename` header, so no multipart parser is needed. Status codes: 201 imported, 400 empty body or bad id, 404 unknown id, 415 not a readable WAV (the decoder's reason in `detail`), 503 audio core not built.

### app/routers/media.py · peaks response
- refers-to: app/routers/media.py :: `get_peaks`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

`spp` asks for a resolution; the engine returns the first level with at least that many samples per peak, or the coarsest level. The body is little-endian f32 (per block, per channel, min then max) and the headers `X-Samples-Per-Peak`, `X-Channels` and `X-Blocks` describe it; `main.py` exposes them to direct CORS callers. Content never changes for an id (ids are content hashes), hence the immutable cache header.

---

## app/services/media.py {#app-services-media}

### app/services/media.py · ids and storage
- refers-to: app/services/media.py :: `import_wav`, `_write_atomic`
- kind: rationale
- logged: v0.2.0 · 2026-09-28

A media id is the SHA-256 of the file's bytes, so importing the same audio twice stores it once and ids are safe to cache forever. Audio and its JSON description are written to a temporary file in the same folder, flushed, fsynced and renamed into place, so a crash never leaves a half-written file under a real name. Re-importing identical audio under a new name updates the name in the JSON only.

### app/services/media.py · peak cache
- refers-to: app/services/media.py :: `_levels`
- kind: todo
- logged: v0.2.0 · 2026-09-28

The full pyramid for the eight most recent media ids is kept in memory. Levels are not yet written to disk, and very long files are decoded whole; a disk cache and chunked decoding come with the jobs surface.

### app/routers/media.py · audio route
- refers-to: app/routers/media.py :: `get_audio`
- kind: rationale
- logged: v0.4.0 · 2026-09-28

Serves the stored WAV bytes unchanged so the interface decodes them with the same Rust decoder, compiled to WebAssembly, that the engine uses; the engine never decodes for playback. Validated like the other media routes (400 malformed id, 404 unknown). Content never changes for an id, hence the immutable cache header. Verified v0.4.0: 200, `audio/wav`, 576,044 bytes for the 3 s stereo test file.

---

## app/routers/projects.py {#app-routers-projects}

### app/routers/projects.py · routes and codes
- refers-to: app/routers/projects.py :: all routes
- kind: explainer
- logged: v0.6.0 · 2026-09-28

`GET /api/projects` lists saved sessions newest first (name, savedAt, tracks, bytes, appVersion), skipping unreadable files. `PUT /api/projects/{name}` takes the session document as the JSON body and saves it. `GET /api/projects/{name}` opens a session: its media are verified and stored in the media store, and the document is returned. `GET /api/projects/{name}/file` downloads the `.fmw`. Codes: 400 for a bad name, a malformed document, media the engine no longer has, or a damaged or foreign file; 404 for an unknown name; 503 when the audio core is missing.

---

## app/services/projects.py {#app-services-projects}

### app/services/projects.py · the .fmw format, version 1
- refers-to: app/services/projects.py :: `save`, `FORMAT`, `FORMAT_VERSION`
- kind: rationale
- logged: v0.6.0 · 2026-09-28

A zip holding `manifest.json` (format `formwav-session`, format version, app version, name, UTC save time), `session.json` (the interface's document as it is) and `media/<sha256>.wav` for every media id the session lists, stored uncompressed because audio does not deflate usefully. The file is self-contained: it opens on another machine with an empty media store. Written to a temporary file in the same folder, flushed, fsynced and renamed into place, so a crash leaves either the old file or the new one. Names allow letters, digits, spaces and `. , ' ( ) - _`, start with a letter or digit, and cannot contain a path separator. Sessions live in `data/projects/`, beside `data/media/`, both untracked.

### app/services/projects.py · opening verifies every byte
- refers-to: app/services/projects.py :: `open_project`, `_read`, `_media_ids`
- kind: warning-context
- logged: v0.6.0 · 2026-09-28

Opening checks the format name and refuses a newer format version, checks that every clip names listed media, and hashes every media file against its name before importing it through `media.import_wav`, which probes it with the audio core. A file with one flipped byte in its audio was refused as damaged (400) in v0.6.0.

### app/services/projects.py · verification v0.6.0
- refers-to: app/services/projects.py :: module
- kind: explainer
- logged: v0.6.0 · 2026-09-28

A two-track session (an imported WAV at -6 dB and a recorded take at 48,000 samples) saved to 965,403 bytes with both media hashes matching their names and no temporary files left; after a page reload it reopened with identical tracks, gains and positions, and its offline bounce equalled the pre-save bounce exactly (maximum difference 0 on both channels). Bad name 400, unknown 404, damaged 400, download 200 with the full file.

---

## app/routers/render.py {#app-routers-render}

### app/routers/render.py · POST /api/render
- refers-to: app/routers/render.py :: `render_session`
- kind: explainer
- logged: v0.7.0 · 2026-09-28

Takes a session document as the JSON body and returns the mix as a float32 stereo WAV (`attachment; filename="mix.wav"`), with `X-Frames`, `X-Peak-Left-dBFS`, `X-Peak-Right-dBFS` and `X-Skipped-Clips`. 400 for a malformed document or media id, 404 when a listed media file is missing, 503 when the audio core is not built. It is both the offline renderer of Phase 2's exit check and the basis of export; the interface has no Export button yet.

---

## app/services/render.py {#app-services-render}

### app/services/render.py · de-click and de-reverb read ahead on the track's own bus; no reverb or dialogue isolate in a clip's chain
- refers-to: app/services/render.py :: `plan` (the kinds that take a track to its own bus; the per-clip stages and their automation numbering; a clip's own stages); frontend/src/audio/player.ts :: `planClips`; tests/test_restoration.py, tests/test_plan_parity.py
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

Two faults the new tests found, both where this plan and the browser's `planClips` decide which chain a stage runs in. First, latency. The core reads a chain's input ahead by its latency only on a bus (RX-16), so a track whose chain delays its signal plays through a bus of its own; the rule named the compressor, the reverb and the dialogue isolate (6, 8, 16) but not de-click (18, 3.5 ms) or de-reverb (19, 1023 samples), although the core's L6 entries say de-click is "compensated as Voice's is". On a track they ran in each clip's chain and came out late: measured on the JFK speech at 48 kHz, the export's cross-correlation peak against the dry export at 172 samples for de-click and 1023 for de-reverb, the browser planning the same. The sidecar's verify_live_restoration.py and verify_dereverb.py had shifted their readings by exactly those amounts by hand, which is why it went unseen. Both kinds now take a track to its own bus, in the plan and in the player: the peaks at 0, and at transparent settings (de-click at threshold 30, de-reverb at 0 dB) the export equal to the dry one (largest difference 0 and under 1e-4). The cost, as for the three kinds before them: a track that goes to its own bus has no filter automation (bus chains are not automated yet). Second, parity. This plan ran a reverb or a dialogue isolate in a clip's chain, on a track routed to a user bus or among a clip's own effects, where the browser's flatFx has always left them out (RX-16's entry names that exclusion as the design: a clip chain has no read-ahead, and a reverb's tail there stops at the clip's end; the Inspector offers neither on a clip). Such a session played without them and exported with them; the export now leaves them out too, its automation numbering with it, and the README's Bus routing limit names them. Still late, pinned by strict expected failures so a fix shows: de-click and de-reverb in a clip's own chain, in the master's, or on a track routed to a user bus (172 and 1023 samples, as measured); a read-ahead per clip chain and for the master in the core would close them, the owner's call. The re-measured readings, now at lag 0 with nothing shifted: 40 clicks of 0.6 repaired to 0.0059 at worst, 47 of 528,000 samples of clean speech changed by de-click, the room's tail in the pauses from -23.4 to -25.6 dB against the speech (the dry speech's -25.0) and SI-SDR from -1.68 to -0.52 dB, as the L6 entries found with their hand shifts.

### app/services/render.py · plan mirrors the interface
- refers-to: app/services/render.py :: `plan`
- kind: warning-context
- logged: v0.7.0 · 2026-09-28

The clip plan repeats `planClips` in `frontend/src/audio/player.ts` rule for rule: mute and solo, track plus clip gain in dB made linear with `10 ** (dB / 20)`, track pan defaulting to 0 for sessions saved before pan existed, and clips at another sample rate skipped and counted. Two copies of one rule set can drift; the null test between the two renderers is what guards them, so change both together and rerun `verify_render.py`. Verified v0.7.0: identical output (0.0) on a two-track session with gains and pans, and a v0.6 session without pan fields rendered.

### app/services/render.py · output
- refers-to: app/services/render.py :: `wav_float32_stereo`, `dbfs`
- kind: explainer
- logged: v0.7.0 · 2026-09-28

The WAV is IEEE float 32 (format tag 3), two channels, at the session rate, so nothing is lost to quantisation; peaks are reported in dBFS to two decimals (`-inf` for silence). The whole mix is built in memory; long sessions will need a streamed render with the jobs surface.

### app/services/render.py · fades in the plan
- refers-to: app/services/render.py :: `plan`
- kind: warning-context
- logged: v0.8.0 · 2026-09-28

Each clip tuple now ends with `fadeIn`, `fadeOut` (0 when absent) and the shape code (1 for "equal-power", otherwise 0), matching `planClips` in the interface field for field. Verified v0.8.0: identical to the browser's render for linear crossfades (0.0) and within 6.0e-8 for equal-power ones (the `sin` difference described in the native log).

### app/services/render.py and routers/render.py · loudness
- refers-to: app/services/render.py :: `render`; app/routers/render.py :: `X-Loudness-LUFS`
- kind: explainer
- logged: v0.10.0 · 2026-09-28

After rendering, the mix's integrated loudness is measured by `formwav_dsp.loudness` on the interleaved f32 bytes and reported in `X-Loudness-LUFS` to two decimals (`-inf` when every block is gated away). The interface's Export shows it; verified v0.10.0: an exported file was byte-identical to this route's output and the notice matched the headers. (This log's header stayed at v0.8.0 through v0.9.0 because the backend did not change in v0.9.0.)

### app/services/render.py · buses in the plan
- refers-to: app/services/render.py :: `plan`, `render`
- kind: warning-context
- logged: v0.11.0 · 2026-09-28

Unmuted buses are numbered from 1 in document order and passed as `(id, linear gain, pan)`; a track on a muted bus is left out like a muted track; a `busId` that names no bus, or none, routes to master (0). Each clip tuple ends with its bus index, and `plan` now returns the bus list as a sixth value. This is `planClips` in the interface rule for rule; verified v0.11.0 by identical browser and engine renders of a bused session (0.0).

### app/services/projects.py and routers/projects.py · revision checks
- refers-to: app/services/projects.py :: `save`, `RevisionConflict`, `_current_revision`, `_SAVE_LOCK`; app/routers/projects.py :: `save_project`
- kind: rationale
- logged: v0.12.0 · 2026-09-28

Every save writes `revision` into the manifest, one more than the file's current revision (0 when there is no file; files saved before v0.12.0 count as 1). `PUT /api/projects/{name}?base=N` saves only if the file is at revision N, with 0 meaning the name must be new; otherwise it answers 409 with `{"message", "revision"}` naming the current revision, so the interface can ask and retry against it. Leaving `base` out saves unconditionally, for scripts that mean to overwrite. The check and the write happen under one process-wide lock, so two saves cannot both pass the check; the engine is a single process, and several engine processes on one data folder would need a file lock. Open and list report the revision. Verified v0.12.0: the API sequence (new at 1, conflict at 1, 2, stale conflict at 2, unconditional 3); a pre-revision file opened as 1 and saved as 2; ten simultaneous saves of one new name gave exactly one success and nine conflicts.

### app/services/render.py · fade shape names
- refers-to: app/services/render.py :: clip planning (`fade_shape`)
- kind: explainer
- logged: v0.21.0 · 2026-09-28

The engine maps a clip's `fadeShape` through a table of the four names the core knows (linear, equal-power, s-curve, exponential), defaulting to linear, instead of testing for equal-power alone. Verified: for every shape the engine's render matched the browser's, exactly for linear and exponential and within 3e-8 for the sine and cosine curves.

### app/services/render.py · automation in the engine render
- refers-to: app/services/render.py :: `plan`, `render`
- kind: explainer
- logged: v0.31.0 · 2026-09-28

A track's `automation.volume` (dB points) and `automation.pan` points become core envelopes; when present, each replaces the track's static fader or pan for that track's clips, while clip gain still applies. `plan` now also returns the envelopes and `render` passes them to the core; it is the only caller of `plan`. Verified: with volume automation the engine's render equalled the browser's exactly over 480,000 frames, and with pan automation too within 3e-8.

### app/services/render.py · master fader in the engine render
- refers-to: app/services/render.py :: `render`
- kind: explainer
- logged: v0.34.0 · 2026-09-28

The engine passes the session's `masterGainDb` (0 when absent) to the core, which applies it to the finished mix. Verified: with the master at -6 dB the engine's render equalled the browser's exactly.

### app/services/media.py, app/routers/media.py · any format in, resampled to the session rate
- refers-to: app/services/media.py :: `STANDARD_RATES`, `_tool`, `_probe_stream`, `_transcode`, `import_audio`, `resample_media`; app/routers/media.py :: `import_media` (`?rate=`), `resample`
- kind: warning-context
- logged: v0.38.0 · 2026-09-29

Import accepted WAV only, and nothing resampled, so a clip at another rate than its session was silent: the owner's session had started at 24 kHz from its first file and its 48 kHz stereo clip played nothing. Every import now goes through ffmpeg (`FORMWAV_FFMPEG`, `FORMWAV_FFPROBE` override the paths): any audio format or a video's audio track is decoded to 32-bit float WAV at the session's rate (`?rate=`), resampled with soxr (ffmpeg's own resampler if soxr is missing), mono kept mono and more than two channels downmixed to stereo, through temporary files because MP4 and M4A need seekable input and a WAV header a seekable output. A WAV already at the target rate is still stored byte for byte. With no session yet a file at 44.1, 48, 88.2 or 96 kHz keeps its rate and anything else becomes 48 kHz. `POST /api/media/{id}/resample?rate=` converts stored media to new media, keeping the original. Without ffmpeg only WAV at the session rate imports, and the error says how to install it. Verified: FLAC, MP3, M4A (AAC), OGG (Vorbis), Opus, AIFF and an MP4's audio each imported at 48 kHz mono and measured as the 440 Hz test tone (RMS 0.343 to 0.357, 439 to 440 zero crossings a second, 10.0 s, AAC 5 ms longer); FLAC and AIFF decoded to identical bytes and so one media id; a 24 kHz WAV became 48 kHz; a non-audio file was refused with "no audio stream found in this file".

### app/voice/, app/main.py, requirements_voice*.txt · formwave's generative voice, vendored
- refers-to: app/voice/ (formwave's core, engine, extensions and routers); app/voice/engine/config.py :: `_DEFAULT_MODELS_ROOT`; app/main.py :: the voice mount and its fallback; requirements_voice.txt, requirements_voice_macos.txt, requirements_voice_qwen.txt
- kind: warning-context
- logged: v0.40.0 (in progress) · 2026-09-29

The owner's standalone formwave (Qwen3-TTS voice clone, preset voices and voice design; Qwen3-ASR and Whisper transcription; its export and post-processing extensions) never came across. Its backend packages are now vendored verbatim from the uploaded formwav.zip as `app/voice`, their relative imports unchanged, mounted at `/api/voice` with formwave's own routes and contract (`/status`, `/load`, `/generate`, `/generate/stream`, `/export`, `/export/formats`, `/asr/models`, `/asr/select`, `/transcribe`); its requirements files ride beside formwav's as `requirements_voice*.txt`. One change: the default models folder is one directory deeper (`parents[3]`, still `backend/models`); `FORMWAV_MODELS_ROOT` overrides it as in formwave. The voice runtime is optional: when it cannot import, every `/api/voice` route answers 503 naming the missing module and how to install it, and formwav starts and works as before. Verified in this container: without the runtime, health OK and voice routes 503 with the message; with formwave's pinned numpy and soundfile installed, the routes still answered 503 naming torch, as formwave's engine state detects the compute device when it imports, so formwave needs torch installed even to report its status. Not yet verified: the routes themselves, which need torch (next, with the CPU build) and, for generation, the Qwen weights on the owner's Mac.

### app/services/effects.py, app/routers/media.py · formcut's audio effects
- refers-to: app/services/effects.py :: `AUDIO_CHAINS`, `GROUPS`, `STEREO`, `catalogue`, `apply`; app/routers/media.py :: `list_effects`, `apply_effect`
- kind: rationale
- logged: v0.41.0 (in progress) · 2026-09-29

formcut v2.2.2's `AUDIO_CHAINS` (48 named ffmpeg filter chains, from voice-clean and denoise to reverbs, radio, pitch and octave shifts) is vendored verbatim and grouped for a menu (Clean up, Dynamics, Tone, Space, Character, Modulation, Pitch). `GET /api/effects` lists them; `POST /api/media/{id}/effect?name=` renders one through ffmpeg into new media at the source's rate (a trailing resample undoes loudnorm's and the pitch chains' internal rates), mono kept mono except the two stereo-image effects; the source is never changed. Verified: all 48 rendered over the 10 s tone with none failing or silent, each at 48 kHz with the right channel count; pitch up turned 440 Hz into 550, pitch down into 351, octave up into 880 and octave down into 220; four reverbs came out 0.3 to 1.2 s longer, their echo tail, which the clip's unchanged length leaves hidden until its end is dragged out.

### app/services/effects.py, app/services/tools.py, app/routers/media.py · coverage wave 1: Audacity, RX and Audition processing
- refers-to: app/services/effects.py :: `FORMWAV_CHAINS`, `ALL_CHAINS`, `GROUPS`, `STEREO_ONLY`, `apply` (peak normalize); app/services/tools.py :: `generate`, `stats`, `spectrogram_png`, `DTMF`; app/routers/media.py :: `generate_signal`, `media_stats`, `media_spectrogram`
- kind: rationale
- logged: v0.43.0 · 2026-09-29

The owner's standard is every PARITY row integrated, partially or fully (sidecar COVERAGE.md assigns all 224). This wave uses the proven render-to-new-media path for 37 processes written against the behaviour of Audacity's built-ins, iZotope RX's modules and Audition (references only; no code taken): amplify, invert, reverse, DC offset, click and short-gap repair, truncate silence, graphic EQ and filter curve, tempo, pitch and speed (rubberband), extreme stretch, de-clip, de-crackle, mouth de-click, de-plosive, de-wind, voice and guitar de-noise, strong de-ess, leveler, dither with Shibata noise shaping, phase rotation, azimuth, centre extract and remove, channel swap, mid-side encode and decode, peak normalize (measured with astats to the micro-dB, then gained to -1 dBFS), streaming and broadcast loudness, and an exciter; stereo-only processes refuse a mono clip with a message. Generators render tone, white, pink and brown noise, silence, chirp, DTMF (Q.23 pairs, 100 ms tone and 50 ms gap per key) and bleep at the session rate; statistics come from astats and a spectrogram from showspectrumpic. Found in verification: mouth de-click's adeclick window was below the filter's range (fixed), and peak normalize measured with volumedetect landed at -1.02 dBFS because that filter rounds to 0.1 dB (now astats). Verified (verify_wave1.py): 85 effects in the catalogue, all 37 new ones rendering on a stereo source; invert and reverse exact to the sample; amplify +6 dB peak 0.9974; peak normalize 0.8913 (-1 dBFS); tempo +10% 4.545 s at 440 Hz; +1 semitone 466 Hz at 5.0 s; speed +10% 4.545 s at 483 Hz; the mono guard; a 440 Hz tone at 0.5 peak for exactly 5 s, DTMF 159# exactly 0.6 s, a 1 kHz bleep, all-zero silence, audible noises and chirp; statistics -6.02 and -9.03 dBFS with zero DC on the tone; a PNG spectrogram.

### app/services/transcript.py, app/routers/media.py, requirements_transcript.txt · word-level transcripts (coverage wave 2)
- refers-to: app/services/transcript.py :: `transcript`, `mark_fillers`, `FILLERS`, `FILLER_PHRASES`, `TranscriptUnavailable`; app/routers/media.py :: `media_transcript`; requirements_transcript.txt
- kind: warning-context
- logged: v0.44.0 (in progress) · 2026-09-29

Descript-style editing needs word timings, which faster-whisper gives on the CPU, so the whole flow is tested here. The file is decoded by ffmpeg to 16 kHz mono floats and handed to faster-whisper as samples: its own decoder, PyAV, failed on a version mismatch (`metadata_errors`), and formwav decodes everything with ffmpeg already. faster-whisper 1.1.1 imports requests without declaring it, so the requirements file lists it. A verbatim prompt keeps disfluencies, which Whisper otherwise drops; fillers are um, uh, er, hmm and kin plus "you know" and "I mean" ("like" is left out as usually a real word). Transcripts are cached per media file and model; the model (base.en by default, `FORMWAV_WHISPER_MODEL`) downloads into the git-ignored `backend/models/whisper`. Without the runtime the route answers 503 with the install line. Verified: base.en loaded in 2.2 s and transcribed the 11 s JFK recording in 1.6 s as the exact 22-word sentence with word times; the filler marker flagged exactly um, you know, uh and I mean in a test phrase.

### app/services/effects.py, app/routers/media.py · adjustable effects (coverage wave 3)
- refers-to: app/services/effects.py :: `PARAMS`, `_values`, `_controls`, `catalogue`, `apply`; app/routers/media.py :: `apply_effect` (params)
- kind: rationale
- logged: v0.46.0 (in progress) · 2026-09-29

The commonest gap among the partial rows was a fixed preset instead of an amount. 17 effects now declare controls (label, range, default, unit) and build their chain from the values, each clamped to its range so no input makes a broken filter: Enhance speech strength (50% reproduces formcut's voice-clean exactly), amplify, peak normalize target, loudness target, compress threshold and ratio, noise gate, tempo, pitch in semitones, speed, extreme stretch, truncate silence threshold and length, denoise floor, de-ess intensity, bass, treble, presence frequency and gain, echo delay and decay. The catalogue lists each effect's controls, the route takes values as a JSON object, and the new file's name carries them. Verified (verify_params.py) on a 440 Hz tone: amplify -3 dB peak 0.3539; +100 dB clamped to +24, peak 7.9225; peak normalize to -6 dBFS 0.5012; tempo +25% 4.0 s at 440 Hz; pitch -12 semitones 220 Hz at 5.0 s; speed -20% 6.25 s at 351 Hz; stretch x2 10.0 s; Enhance at its default byte-identical to 50%; malformed values refused with 422.

### app/services/effects.py · effects that change timing (for range effects)
- refers-to: app/services/effects.py :: `RETIMING`, `catalogue` (`retimes`)
- kind: rationale
- logged: v0.47.0 · 2026-09-29

An effect applied to a range replaces only that part of a clip with the same part of a processed copy of the whole file, which holds only while the processed file lines up sample for sample with the source. Tempo, speed, extreme stretch, truncate silence and reverse change length or order, so the catalogue flags them (`retimes`) and the Inspector refuses them inside a range. Pitch shifts keep length and alignment and are allowed. Verified through verify_range_fx.py (Change tempo refused inside a range, the document unchanged).

### app/services/effects.py, app/services/tools.py, app/routers/media.py · EQs, click removal controls, excerpts
- refers-to: app/services/effects.py :: `eq-3band`, `graphic-eq-5`, `PARAMS["click-removal"]`; app/services/tools.py :: `excerpt`; app/routers/media.py :: `media_excerpt`
- kind: explainer
- logged: v0.48.0 · 2026-09-29

Wave 3 continues: a three-band parametric EQ (120 Hz low shelf, a mid band at any frequency from 200 Hz to 8 kHz, 8 kHz high shelf, each -15 to +15 dB), a five-band graphic EQ (60 Hz, 250 Hz, 1, 4 and 12 kHz through firequalizer), and click removal's threshold and window. For wave 2, `excerpt` cuts a time range of a file sample-exactly (atrim) into new media, which Make a clip uses. Verified (verify_wave3b.py): 87 effects, 20 adjustable; the parametric mid band +12 dB at 1 kHz gave 3.981 on a 1 kHz tone (exact); the high shelf -12 dB gave 0.413 at 10 kHz, the shelf still in its transition two kilohertz above its corner; the graphic 1 kHz band +6 dB gave 1.962 (+5.85 dB, firequalizer's interpolated curve) and flat gave 1.000; click removal ran with threshold 8 and a 30 ms window; an excerpt of 3.34 to 6.00 s was 2.66 s exactly and an empty one was refused.

### app/services/tools.py, app/routers/media.py · spectrogram size and legend
- refers-to: app/services/tools.py :: `spectrogram_png` (width, height, legend); app/routers/media.py :: `media_spectrogram` (`w`, `h`, `legend`)
- kind: explainer
- logged: v0.50.0 · 2026-09-29

The spectrogram route takes a size (clamped to 64 to 8192 by 32 to 1024) and can leave out the legend, so the image is the bare plot and its width maps to the file's length exactly, which the timeline's spectrogram view relies on. Verified through verify_spectrogram_view.py (a 2048 by 256 PNG, aligned under split clips).

### app/services/effects.py · Band gain, the first spectral edit
- refers-to: app/services/effects.py :: `band-gain` (chain, group, controls)
- kind: rationale
- logged: v0.50.0 · 2026-09-29

A gain curve 0 dB outside a frequency band and the chosen gain inside it (-60 to +24 dB), with 3% transitions at the edges (firequalizer), the edges sorted if given in reverse. It keeps timing, so it applies inside a Smart Tool range: a time and frequency selection's gain, and at -60 dB an attenuation of that region, until drawn spectral selections exist. Verified (verify_band_gain.py) on 440 Hz, 1 kHz and 3 kHz tones: -30 dB on 2 to 4 kHz gave 0.0316 at 3 kHz and 1.0000 at the others; +12 dB gave 3.9811 at 3 kHz; reversed edges gave the same; 88 effects, 21 adjustable.

### app/services/export.py, app/routers/render.py · export formats, stems, multichannel (coverage wave 5)
- refers-to: app/services/export.py :: `FORMATS`, `encode`, `multichannel`; app/routers/render.py :: `render_session` (`format`, `what`)
- kind: warning-context
- logged: v0.51.0 (in progress) · 2026-09-29

The engine still renders 32-bit float WAV; ffmpeg encodes it to WAV 24-bit, WAV 16-bit (triangular dither), FLAC 24-bit, MP3 320 or 192 kbps, OGG Vorbis or M4A AAC 256 kbps. Stems render the whole session once per track with the other tracks muted and solos cleared, zipped as `NN Track name.ext`; multichannel folds each stem to mono and merges them, one channel per track in track order, as WAV or FLAC only (the lossy containers here carry two channels). Two traps found in verification: the render plan ends at the last audible clip, so a stem of a shorter track came out shorter (3.0 s against 10.0 s) and amerge stops at its shortest input; every stem is now padded to the session's length and every multichannel channel to the longest stem. Integer formats clip at full scale by definition: a test mix peaking at +1.0 dBFS clipped 3,851 samples in 24-bit, 16-bit and FLAC, so exactness is measured below full scale. Verified (verify_export.py) on a two-track session: every format decoded at 48 kHz stereo and 10.0 s (MP3 10.032 s, the encoder's padding); below full scale 24-bit and FLAC differed from the float render by 0.0 and FLAC equalled the 24-bit WAV bit for bit, 16-bit by one step (the dither); stems both 10.0 s in float and 16-bit; multichannel two channels of 10.0 s, each exactly its folded stem; MP3 multichannel refused.

### app/services/tools.py, app/routers/media.py · Mic Check (coverage wave 6)
- refers-to: app/services/tools.py :: `mic_check`, `stats_filtered`, `_run_text`, `_num`; app/routers/media.py :: `media_mic_check`
- kind: warning-context
- logged: v0.54.0 (in progress) · 2026-09-30

After Adobe Podcast's mic analysis and iZotope RX's Repair Assistant (references only): integrated loudness (ebur128), clipped samples (volumedetect's 0 dB bin), noise floor (astats, with the mains frequencies notched out), mains hum (narrow 50 and 60 Hz bands against the whole signal) and DC offset, each finding naming the effect that addresses it. Checked against five crafted recordings: the first cut reported a 60 Hz hum as background noise too, the steady tone reading as the noise floor. Notching the mains frequencies, once and then twice, left about -45 dB of residue whose cause was not found, so a stated heuristic applies: with hum present, background noise is reported only above -40 dB (otherwise above -50). Verified: clean gave only its level; hum gave 60 Hz hum at -18.1 dB with Hum remover and a quiet background; noisy (pink noise at -35 dBFS) gave a -41.6 dB floor with Voice de-noise; clipped (+20 dB) gave 10,134 clipped samples with De-clip and very loud at -8.6 LUFS; quiet (-30 dB) gave -45.4 LUFS with the loudness effect.

### app/services/effects.py · Dialogue isolate, a learned noise suppressor (coverage wave 7)
- refers-to: app/services/effects.py :: `dialogue-isolate`, `_rnnoise_model`, `RNNOISE_URL`
- kind: rationale
- logged: v0.56.0 (in progress) · 2026-09-30

The first of wave 7's AI features that runs on the CPU here and can be measured: ffmpeg's arnndn with an RNNoise model trained on voice amid noise (GregorR/rnnoise-models, "beguiling-drafter"), strength as arnndn's mix. The 300 kB model is fetched once into the git-ignored backend/models/rnnoise and checked to be a model file; without a network it says where to place it. Verified with Mic Check's measurements: the noisy recording's noise floor fell from -41.6 to -54.1 dB at 100% (-45.5 at 50%) while its loudness moved from -15.5 to -15.7 LUFS; the clean recording moved by 0.1 LU; with the model removed, applying fetched it again byte for byte.

### app/services/separate.py, app/routers/media.py, requirements_separate.txt · Separate into stems (coverage wave 7)
- refers-to: app/services/separate.py :: `separate`, `_load`, `SeparationUnavailable`; app/routers/media.py :: `media_separate`; requirements_separate.txt
- kind: warning-context
- logged: v0.56.0 · 2026-09-30

Demucs htdemucs splits a time range of a file into vocals, drums, bass and other on the CPU (PyTorch's Apple GPU on the Mac), each written back at the file's rate through soxr so stems line up with the clip; the model (about 80 MB) caches in the git-ignored backend/models/torch; without Demucs the route answers 503 with the install line. A trap met here: installing demucs upgraded torchaudio to a CUDA 13 build this CPU-only machine could not load, breaking every PyTorch feature until the CPU builds were reinstalled; the requirements file pins torch and torchaudio 2.6.0 and says to install PyTorch's right build first. Verified on the JFK speech mixed with a 55 Hz tone and trimmed by 2 s: the vocals stem correlated 0.999 with the clean speech at zero lag (exact alignment to the trimmed range) and the other stems 0.003 to 0.061. Not good: the pure 55 Hz tone was largely dropped rather than placed in the bass stem (0.022 RMS against 0.125), so the stems summed to the piece only within 0.22; Demucs is trained on music, and how it treats real bass is not measured here for want of a music recording.

### app/routers/render.py · streaming preview (coverage wave 6)
- refers-to: app/routers/render.py :: `render_session` (`what=preview`)
- kind: explainer
- logged: v0.57.0 (in progress) · 2026-09-30

iZotope RX's streaming preview: the mix rendered, encoded with a lossy codec (MP3, OGG or M4A) and decoded back at the session's rate into new media, so the codec's effect can be heard against the mix; lossless formats are refused. Verified (verify_preview.py) on the JFK session: an MP3 192 kbps preview of 11.0 s, correlation 1.0 with the float mix at zero lag (the decoder trims the encoder's padding), differing by up to 0.024; FLAC refused.

### app/services/separate.py, app/routers/media.py · Deconstruct: tonal, noisy and transient parts (coverage wave 7)
- refers-to: app/services/separate.py :: `deconstruct`, `_median`; app/routers/media.py :: `media_deconstruct`
- kind: rationale
- logged: v0.57.0 (in progress) · 2026-09-30

iZotope RX's Deconstruct, as a reference: harmonic-percussive separation with PyTorch (scipy is not in the runtime; torch is, for separation): a 2048-point STFT, a 17-wide median along time for the tonal envelope and along frequency for the transient one, a part claiming a bin when its envelope exceeds twice the other's and the noisy part taking the rest. The masks partition the spectrum, so the parts sum back to the range. Verified on a 440 Hz tone at 0.3 with a click every 0.5 s at 0.9 and white noise at 0.05: the parts summed to the input within 2.4e-7; tonal correlated 0.999 with the tone; transient held the clicks (0.569 at the click times) and not the tone (0.017); noisy's level was 0.0285 against the noise's 0.029, with part of the broadband clicks (0.31), which firm masks cannot keep out.

### app/routers/render.py · a track's active regions, for automatic ducking (coverage wave 10)
- refers-to: app/routers/render.py :: `track_activity`
- kind: warning-context
- logged: v0.58.0 (in progress) · 2026-09-30

POST /api/render/activity renders one track alone (others muted, solos cleared) and returns where it is active: silences over 0.3 s found by silencedetect, inverted. Two faults found on the JFK recording: a fixed -40 dBFS threshold never saw its pause (the background sits at -41 to -39 dB), so the threshold now defaults to the track's loud level (the 90th percentile of 50 ms RMS windows, measured natively by astats) minus 20 dB within -60 to -20 dBFS, -31.3 dB there; and a 2.6 ms noise spike inside the pause came back as activity and chained the ducking across it, so active regions under 0.1 s are dropped. Verified: the pause found (regions 0.33 to 2.5 s and 3.22 to 11 s), and through the app the ducking measured below.

### app/services/effects.py · loudness effects land on their target; matched clip loudness (coverage wave 10)
- refers-to: app/services/effects.py :: `apply` (the `loudnorm=` branch)
- kind: warning-context
- logged: v0.59.0 (in progress) · 2026-09-30

Proving Audition's matched clip volume (Loudness to a target with Apply to all clips) found the loudness effects off target: single-pass loudnorm left two clips at -20.9 LUFS for a -20 target, and two-pass loudnorm (measured, then linear) still left -19.5, and -22.5 for the -23 broadcast preset, against the ebur128 meter the app measures with. They now measure integrated loudness with ebur128 and apply the exact linear gain, with a limiter at -1 dBFS only when the gain would push the sample peak past it. Verified: clips at -15.5 and -45.4 LUFS matched to -20.0 and -20.1 in one undo step (verify_match_loudness.py); the broadcast preset gave -23.0 and a -14 target -14.0 with peaks held at -1.0 dBFS. Not reached: a -8 LUFS target gave -11.1, the limiter holding peaks at -1 dBFS instead of limiting harder; very loud targets fall short rather than distort.

### app/services/render.py · track effects in the export render
- refers-to: app/services/render.py :: `FX_KINDS`, `plan` (`fx`), `render`
- kind: explainer
- logged: v0.61.0 (in progress) · 2026-09-30

A track's `fx` list (kind, freq, gainDb, q, bypass) becomes filter stages on each of its clips in the core's render, with the session's rate; bypassed and unknown stages are left out, so exports carry exactly what playback will. Verified with the export render and an FFT against renders without effects: a 1 kHz high-pass took 100 Hz down 40.03 dB and left 5 kHz within 0.01 dB; a bypassed stage rendered byte for byte as none; a +6 dB peak at 1 kHz gave +6.00 dB.

### app/services/render.py · master effects in the export render
- refers-to: app/services/render.py :: `render` (`master_fx`)
- kind: explainer
- logged: v0.62.0 (in progress) · 2026-09-30

The document's `masterFx` (the same kinds and bypass rule as tracks) becomes the core's master chain in exports. Verified by FFT: a 2 kHz master high-pass -52.14 dB at 100 Hz, -12.38 dB at 1 kHz, -0.10 dB at 5 kHz; bypassed, byte for byte as none.

### app/services/render.py · the compressor in the export plan
- refers-to: app/services/render.py :: `FX_KINDS`, `_stage`, `plan` (`chains`, the track's own bus), `render`
- kind: warning-context
- logged: v0.63.0 (in progress) · 2026-09-30

One `_stage` rule turns an effect entry into a core stage (filters: frequency, gain, Q; the compressor: threshold, ratio, attack, release, makeup). A track holding a compressor and routed to the master plays through a bus of its own (unity gain, centre) whose chain is the track's whole chain in order; the master's effects travel as ordered master stages, so it takes a compressor too. Not placed yet: a compressor on a track routed to a user bus (its filters still run per clip). Verified: see the core log's export measurements (-16.00 dBFS against the curve's -16.51; transparent below threshold to four decimals; the master matching; the high-pass regression at -40.03 dB).

### app/routers/media.py · the transients route
- refers-to: app/routers/media.py :: `media_transients`
- kind: explainer
- logged: v0.64.0 (in progress) · 2026-09-30

GET /api/media/{id}/transients?sensitivity= returns onset times in the file's own seconds from the core's detector (503 without the core). Verified: the drum-like bursts at 0.30, 0.80, 1.55, 2.10 and 2.70 s came back at 0.301, 0.8018, 1.5509, 2.1005 and 2.7024 s; JFK's speech gave 3, 7 and 14 onsets at sensitivities 0.2, 0.5 and 0.8.

### app/services/effects.py · Change tempo, rhythmic
- refers-to: app/services/effects.py :: `stretch-rhythmic` (chain, control, menu entry, `RETIMING`)
- kind: rationale
- logged: v0.68.0 (in progress) · 2026-09-30

A pitch-keeping tempo change for rhythmic material: Rubber Band with a short window, beside Change tempo and with the same Tempo control, marked as timing-changing. Measured with the core's onset detector on a 12-hit pattern stretched from 99.9 to 110 BPM: Rubber Band's defaults kept 6 attacks at a 0.5601 s spacing (0.5449 expected), the percussive detector alone changed nothing, and a short window kept the spacing at 0.5435 s with 16 onsets, a few attacks still splitting. The catalogue is now 90 effects.

### app/routers/presets.py, app/main.py · one store of effect presets (coverage wave 8)
- refers-to: app/routers/presets.py :: `list_presets`, `save_presets`, `_clean`; app/main.py :: the router's mount
- kind: explainer
- logged: v0.73.0 (in progress) · 2026-09-30

Audacity's one preset system across built-in, destructive and realtime effects: GET and PUT /api/presets over one JSON file in the data folder, so presets outlive a browser and a session. Each preset is a name, an effect key (rendered effects "fx:<id>", realtime ones "rt:<kind>") and its named numeric settings; the whole list is validated (at most 500 presets, 16 settings each, finite numbers) and written by atomic replacement. Verified through the app (the frontend log's verify_presets.py): saved presets appeared in the store with their settings, persisted across a reload, and a deleted one left it.

### app/services/render.py · pitched clips in the export plan
- refers-to: app/services/render.py :: `plan` (`play_id`)
- kind: explainer
- logged: v0.75.0 (in progress) · 2026-09-30

A clip carrying `pitchMediaId` (non-destructive pitch) exports that same-length render instead of its original media, as playback does. Verified by FFT of exports (the frontend log's verify_pitch.py): 880.0 Hz at +12, 220.5 Hz at -12 and 440.0 Hz at 0 from a 440 Hz clip.

### app/services/render.py · a user bus's effects in the export plan
- refers-to: app/services/render.py :: `plan` (`bus_chains`)
- kind: explainer
- logged: v0.76.0 (in progress) · 2026-09-30

A user bus's `fx` become stage chains on that bus (target 1, its index), collected while buses are read and placed first in `chains`, so the core processes the sum of every track routed to the bus. Verified by FFT of exports (the frontend log's verify_busfx.py): a 2000 Hz high-pass on a bus cut its routed track's 100 Hz by 52.14 dB and left an unrouted track's 1 kHz unchanged.

### app/services/eqmatch.py, app/routers/media.py · EQ match (coverage wave 10)
- refers-to: app/services/eqmatch.py :: `bands`, `curve`, `eq_match`; app/routers/media.py :: `eq_match`
- kind: warning-context
- logged: v0.78.0 (in progress) · 2026-09-30

iZotope RX's EQ Match: POST /api/media/{id}/eq-match?reference=&start=&end= gives the clip the tonal balance of a reference region. Both are averaged (Welch, 8192-sample Hann frames) into 30 third-octave bands from 25 Hz; the per-band difference, zero where either side is empty or past Nyquist, centred on its median and clamped to 18 dB, is rendered with firequalizer into new media. firequalizer delayed the content by 480 samples and lengthened the file by 960 frames at 48 kHz, which would have moved and stretched the clip (set-clip-media scales a clip whose media changes length); its delay is now fixed at 10 ms, trimmed off, and the original frame count restored, measured as identical length and 0-sample lag. Median-centring over all 30 bands does not hold loudness exactly: the median band from 100 Hz to 10 kHz rose 2.6 dB in the test. Verified with independent band levels: dark noise (300 Hz first-order low-pass) matched to white noise moved from 8.54 dB to 0.38 dB mean deviation from 100 Hz to 10 kHz (worst band 3.66 dB); a missing reference answered 422.

### app/services/eqmatch.py, app/routers/media.py · EQ match measured over a target region
- refers-to: app/services/eqmatch.py :: `eq_match` (`target_start`, `target_end`); app/routers/media.py :: `eq_match` (`tstart`, `tend`)
- kind: explainer
- logged: v0.79.0 (in progress) · 2026-09-30

The target can be measured over a region (tstart, tend in its media's seconds) so a range edit compares like with like; the whole file is still rendered, at its exact length, and the app keeps only the range. Verified through the app (the frontend log's verify_eqmatch_range.py): a dark range inside a clip that is bright elsewhere matched to within 0.58 dB of the learned bright range.

### app/services/render.py · VCAs in the export plan
- refers-to: app/services/render.py :: `plan` (`vcas`, the member skip and `track_db`)
- kind: explainer
- logged: v0.80.0 (in progress) · 2026-09-30

A track assigned to a VCA plays at its fader (or its volume automation) plus the VCA's gain, and a muted VCA silences it; no audio passes through the VCA. Verified by FFT of exports with two of three tracks on a VCA: at -6 dB the members fell 6.00 dB and the unassigned track 0.00 dB; muted, the members fell over 169 dB and the unassigned track did not move.

### app/services/tempo.py, app/routers/media.py · tempo detection that holds on real music
- refers-to: app/services/tempo.py :: `envelope`, `estimate`, `detect`; app/routers/media.py :: `media_tempo`
- kind: warning-context
- logged: v0.82.0 (in progress) · 2026-09-30

GET /api/media/{id}/tempo?start=&end= returns a tempo and confidence from an onset-strength envelope (log spectral flux at 22050 / 220 = 100.227 frames a second, local mean removed), scored per candidate from 60 to 200 BPM by its autocorrelation averaged over every multiple of the period within 12 s, with a gentle preference for tempos near 120 to settle half against whole tempo. It replaces a comb over discrete onset times, which returned confidence 0.08 to 0.18 on the owner's 2:44 song. Assuming 100 frames a second read every tempo 0.23% low; the exact rate fixed it. Measured: the song 126.9 BPM at confidence 0.474, its drum stem 126.9 at 0.551, a 30 s region 126.9, and every 30 s window of the song 126.8 to 127.0; synthetic beats 100.0, 60.0 and 137.0 at 0.34 to 0.42; irregular hits and speech 0.025 and 0.028. The owner's tempo software reports 129. librosa's tempo estimate also reads 129.20 on this file, which is exactly its lag-20 bin at its default frame grid (60 x 22050 / 512 / 20; the next bin is 123.05), while librosa's own beat tracker spans 126.96 BPM from first to last of its 321 beats (127.10, 126.88 and 126.87 by thirds); a phase-coherence check on the drum onsets was inconclusive. The evidence says the file's average tempo is 126.9 and that 129 is a grid value; the owner is given click tracks at both tempos to judge by ear.

### app/services/key.py, app/routers/media.py · key detection with Camelot codes (owner-requested)
- refers-to: app/services/key.py :: `chroma`, `estimate`, `camelot`, `detect`; app/routers/media.py :: `media_key`
- kind: warning-context
- logged: v0.83.0 (in progress) · 2026-09-30

GET /api/media/{id}/key?start=&end= returns the key, tonic, mode, Camelot code and a confidence (the best of 24 correlations' margin over the runner-up). The chroma comes from the harmonic part of the spectrogram (a numpy median-filter split, no scipy), 150 Hz to 4 kHz, linear magnitudes, against Temperley's profiles; Camelot numbers follow the circle of fifths ((7 x major pitch class + 8) mod 12, minors sharing their relative major's number). Found while building it: log-compressed chroma read everything a fifth high (the owner's song as C minor, C major as G major), because a note's third harmonic lands a fifth above; with linear chroma and a 55 Hz floor the song's mode was a coin toss (0.02); the 150 Hz floor made two independent profile sets agree. Tuned against one real song (F minor, 4A, from the owner's analysis software) and four synthetic progressions, a thin basis stated as such. Measured through the engine: the song F minor, 4A, confidence 0.236, in 4 s; C major 8B, A minor 8A, F minor 4A and Ab major 4B progressions all right (0.22 to 0.29); the Camelot arithmetic right at ten known wheel positions.

### app/services/samaudio.py, app/routers/media.py, requirements_sam_audio.txt · SAM-Audio, isolate a described sound (owner addition)
- refers-to: app/services/samaudio.py :: `status`, `_load`, `isolate`, `Unavailable`; app/routers/media.py :: `sam_audio_status`, `isolate_sound`; requirements_sam_audio.txt
- kind: warning-context
- logged: v0.84.0 (in progress) · 2026-09-30

GET /api/sam-audio/status names each precondition (installed, Hugging Face login or a cached checkpoint, device) and the first one missing; POST /api/media/{id}/isolate?description=&start=&end=&spans= returns the described sound and everything else as two media at the region's rate and exact frame count, spans being SAM-Audio's positive anchors in seconds from the region's start. A missing precondition answers 503 with the step to take, bad input 422. The component is optional (requirements_sam_audio.txt, pinned to the source commit bb4c6999 it was written against) and cannot run in the build container: the checkpoints are manually gated (an unauthenticated download answered 401) and 5.10 to 14.86 GB against about 4 GB free, and Meta recommends a GPU. Written from the source, not only the README: result.target and result.residual are lists of mono tensors (the README's result.target.cpu() would fail), the processor takes a tensor as given, so the region is decoded to 48 kHz mono here. Verified to the model boundary, not on real weights: as installed here, status and isolate say SAM-Audio is not installed with the install command; with a stand-in of the package (verification/stand_ins, not in the repository) that records its calls, a gated load answered "Hugging Face refused facebook/sam-audio-small (GatedRepoError): request access on its page, then run: hf auth login", bad spans and an empty description 422, and the interface path (frontend log) passed the lowercased description and the exact anchor, with outputs aligned to the frame and reconstructing the original to -183 dB. How well SAM-Audio isolates sounds is measured only once it runs on the owner's machine.

### app/services/effects.py · the Space group's four echoes named as echoes
- refers-to: app/services/effects.py :: `AUDIO_CHAINS` (`room`, `hall`, `cathedral`, `plate`), the Space entry of the catalogue groups
- kind: rationale
- logged: v0.85.0 (in progress) · 2026-09-30

Room, Hall, Cathedral and Plate are ffmpeg `aecho` chains, three or four discrete taps with decays, which is a multi-tap echo and not a reverb (no diffuse tail, no density growth). The v6 comparison page read the chains and asked that they be named for what they are or replaced by a reverb. The labels now read Room echo, Hall echo, Cathedral echo and Plate echo; the ids, chains, presets and saved chains are unchanged, so nothing that referenced them by id moves. A real reverb (a convolution against a decaying-noise impulse through `afir`, or a stage in the Rust core) stays open in BUILD_NOTES. Verified: the running engine's `GET /api/effects` lists the four new labels under Space with the same ids, still 90 effects in eleven groups.

### app/services/effects.py · controls on the six fixed repair chains (coverage wave 4 and 10; the v6 page's first build item)
- refers-to: app/services/effects.py :: `PARAMS` entries `de-clip`, `de-crackle`, `mouth-declick`, `de-plosive`, `de-wind`, `hum-remover`
- kind: explainer
- logged: v0.86.0 (in progress) · 2026-09-30

Each chain's ffmpeg filter already took the parameter RX exposes, so the entries give it a range whose default reproduces the fixed chain: De-clip threshold 1 to 100 (adeclip's own default 10) and window 10 to 100 ms (55); De-crackle threshold 1 to 20 (5) and window (20 ms); Mouth de-click threshold (2) and window (10 ms) after its 60 Hz high-pass; De-plosive cutoff 40 to 300 Hz (100); De-wind cutoff 60 to 400 Hz (150) and afftdn noise floor -80 to -20 dB (-30); Hum remover harmonics 1 to 6 (2: the 50 and 60 Hz families to their second harmonic, as before) and notch width as Q 1 to 30 (4). Nothing in the interface changed: the Inspector renders sliders from the catalogue. Verified on the engine: at their defaults all six outputs are byte-identical to the old fixed chains on the mic fixtures; De-plosive at 40 Hz left a 100 Hz tone at -0.11 dB and at 300 Hz cut it 19.14 dB (200 Hz 7.83, 1 kHz 0.04); De-wind at 400 Hz cut 100 Hz by 24.33 dB, and its floor at -80 changed a -30 dB noise band by 0.0 dB, at -30 by -10.3 and at -20 by -12.0 with the 1 kHz tone unchanged; Hum remover at 2 harmonics left 200 and 300 Hz within 0.4 dB and at 6 cut them 80 and 98 dB, width 1Q took 55 Hz down 33 dB where 30Q left it at -0.3 dB, 50 Hz down 34 to 77 dB throughout, 1 kHz within 0.2 dB; De-crackle threshold 1 took 40 clicks in a 440 Hz tone from -36.5 to -46.0 dB against the clean tone and 20 left them at -36.3; Mouth de-click threshold 1 to -46.8 and 20 to -36.3 against the high-passed clean tone; De-clip on a 32%-clipped tone: window 10 ms reconstructed to -31.0 dB against the unclipped tone (the clipped source -27.7), 55 ms -23.4, 100 ms -20.2, and threshold 100 differed from 10 (14890 against 14851 samples still at the clip level) while 1 equalled 10, so adeclip's reconstruction of a pure tone is worse than the source at the wider windows, stated; on a 57%-clipped tone the threshold had no effect at all; in Chromium the six effects show their labelled sliders, De-clip applied at 20 and 10 ms in one undo step as "mild (De-clip 20 10ms).wav", the params fit at 1024 px (screenshot), verify_params.py lists 29 adjustable, verify_mic_check.py still applies the Hum remover through Use; no page errors.

### app/services/effects.py · a real reverb in the Space group (AU-B16; the v6 page's third build item)
- refers-to: app/services/effects.py :: `FORMWAV_CHAINS["reverb"]`, `PARAMS["reverb"]`, the Space entry of the catalogue groups
- kind: explainer
- logged: v0.88.0 (in progress) · 2026-09-30

ffmpeg 6.1 has no algorithmic reverb, and `afir` needs an impulse as a second input, which the one-input `-af` chain the apply path runs cannot supply from a file. The impulse is made inside the graph from the input itself: `asplit=3` gives the dry signal, a branch trimmed to Size seconds whose samples `aeval` replaces with `(random(0)*2-1)*exp(-t/Decay)` (decaying white noise, the classic synthetic room), and the signal to convolve; `afir` with `gtype=rms` normalises the impulse so the wet level tracks the dry level, and `amix` with `normalize=0` blends dry and wet by Mix. A stereo input gets an independent noise impulse per channel, so the tail is decorrelated. Controls: Size 0.2 to 6 s (1.5), Decay 0.1 to 5 s (0.8; the amplitude falls by 8.7 dB per Decay), Mix 0 to 100% (30). Verified on the engine with a single click at 1.0 s: the output has the same frame count, its first sample and its peak fall at exactly 1.0 s (no added latency, so `set-clip-media` keeps the clip in place), the tail at defaults reads -37.8, -40.5 and -46.0 dB at +0.25, +0.5 and +1.0 s and is gone by +2 s (the 1.5 s Size), Size 4 with Decay 2.5 reads -33.6 to -39.7 dB across the same points, Size 0.3 with Decay 0.1 is gone by +0.5 s; Mix 0 is byte-identical to the source; a stereo file keeps 2 channels and its 144000 frames; the catalogue lists 91 effects, 30 adjustable; in Chromium the Reverb shows Size, Decay and Mix, applied at 3 s, 2 s, 50% in one undo step as "tone (Reverb 3s 2s 50%).wav" with the clip's length unchanged; no page errors. Two things stated: the impulse's noise seed is aeval's, so two renders with the same settings may differ in their fine tail; and the notice reads "Applied Reverb... to the clip" with the label's dots, as every "..." effect has since v0.46.0.

### app/services/effects.py · renders land where their source did: afftdn, anlmdn and alimiter delays stripped
- refers-to: app/services/effects.py :: `apply`, the `delay` computed after the chain is final (before the aresample the apply path appends)
- kind: warning-context
- logged: v0.89.0 (in progress) · 2026-09-30

Found while prototyping a learned noise profile: a click at 1.0 s came back from `afftdn` at 1.025 s. Three filters in the catalogue add fixed lookahead delays that were never compensated: `afftdn` delays by 25 ms at any rate (1200 samples at 48 kHz, 1102 at 44.1, 2400 at 96), `anlmdn` at the catalogue's settings by its patch plus research window, 8 ms (p=0.002 and r=0.006), and `alimiter` by its 5 ms attack less one sample (239 at 48 kHz, measured against 240 with a click: 239 puts the click back exactly). Every chain carrying one shifted its render late by that much since v0.41.0: Enhance speech (afftdn and alimiter, 30 ms together), Denoise, Deep denoise, Hiss cut, Guitar de-noise, De-wind, Voice de-noise, Peak limiter, and the loudness targets when their limiter engages; because the apply path renders a clip's media and the range path re-places an excerpt sample-exactly, a range render of any of them landed late inside its clip. Filters whose latency is length-changing (firequalizer) were already handled at v0.48.0; these three keep the length and were missed. The fix: after the chain is final, `atrim=start_sample=N,apad=pad_len=N` with N the sum of the delays present, computed at the media's own rate, so the output keeps its frame count and its content lines up with the source. Verified on the engine with a single click at 1.0 s at 48 kHz and 44.1 kHz: Denoise, De-wind, Enhance speech, Voice de-noise, Hiss cut, Deep denoise, Guitar de-noise, Peak limiter and Loudness to a target all answer at the click's own sample (the 1-sample readings on Hiss cut and Voice de-noise are the low-pass smearing the peak, and the frame count is unchanged in every case); on the noisy fixture Denoise at -40 dB kept the click at 192000 and took the noise range from -39.5 to -42.6 dB; verify_range_fx.py and verify_params.py unchanged and passing. Stated: Enhance speech at 50% is no longer byte-identical to formcut's voice-clean (v0.46.0's evidence), it is that render moved 30 ms earlier; the other filters in the catalogue were checked by the same click (acompressor, highpass, deesser, speechnorm add nothing).

### app/services/effects.py · Repair short gaps takes its window and order (RX-25)
- refers-to: app/services/effects.py :: `PARAMS["gap-repair"]`
- kind: explainer
- logged: v0.89.0 (in progress) · 2026-09-30

The last fixed adeclick: `adeclick=w=10:o=50:a=4` becomes Window 10 to 100 ms (10) and Order 0 to 25 (4, the autoregression order the interpolation fits), the overlap staying at 50. Verified on the engine: the default output is byte-identical to the fixed chain on the clicks fixture; against the clean tone the 40 clicks read -36.5 dB at the source, -37.3 at the default, -43.1 with a 50 ms window and -37.0 at order 25, so the window is the control that repairs and the order barely moves this input, stated; the catalogue lists 31 adjustable; verify_params.py lists them; no page errors.

### app/services/samaudio.py · the integration read against the pinned source again
- refers-to: app/services/samaudio.py :: `_load`, `isolate`
- kind: warning-context
- logged: v0.90.0 (in progress) · 2026-09-30

The owner asked whether SAM-Audio is integrated properly. The pinned commit bb4c6999 was fetched and read beside the service: `SAMAudio` and `SAMAudioProcessor` are exported from the package root; both `from_pretrained` come from the hub mixin; `SAMAudioProcessor.__call__(descriptions, audios, anchors, masked_videos)` takes tensors shaped (channels, time), downmixes with `mean(0)` and does not resample tensors, so decoding at `processor.audio_sampling_rate` (48 kHz) here is right; `Anchor` is `(str, float, float)` and the positive kind is `"+"`; `Batch.to(device)` exists; `separate(batch, noise, ode_opt, reranking_candidates, predict_spans)` applies span prediction only when `batch.anchors is None`, which is the condition the service sends; and `SeparationResult.target` is built as a list of one tensor per input (`[wav[idx] for ...]`) although the dataclass annotates a tensor, so `result.target[0]` is right and the README's `.cpu()` on it would fail, as the service header said. Every name and shape the service relies on matches the source at that commit; what is not verified anywhere in this container remains the weights, gated and 5 to 15 GB, and with them the quality of the isolation, the span prediction and the re-ranking. FW-04, FW-05 and FW-07 stay partial until the owner's run.

### app/services/tools.py · phase correlation in Statistics (AA-02)
- refers-to: app/services/tools.py :: `stats` (the `phaseCorrelation` key), `_phase_correlation`
- kind: explainer
- logged: v0.91.0 (in progress) · 2026-09-30

Audition's phase meter reads the correlation between two channels; formwav's Statistics now carries it for stereo files as a Pearson correlation over the whole file, -1 (opposed) to 1 (mono), computed in 4 MB chunks of decoded float so a two-hour file never sits in memory at once, and left out for mono files. Verified on the engine: identical channels 1.0, an inverted copy -1.0, independent noise -0.0066, a channel that is half the other plus half fresh noise 0.7069 (theory 0.5 over the square root of 0.5, 0.7071), a mono file carries no key; in Chromium the Statistics list shows "Phase correlation 0.71" as its last row for that clip. Stated: a whole-file figure, not the running meter Audition draws.

### app/services/effects.py · a noise profile learned from a range, for every afftdn effect
- refers-to: app/services/effects.py :: `_noise_range`, `LEARNS_NOISE`, the `noise` wrap in `apply`, the `learnsNoise` key in `catalogue`
- kind: explainer
- logged: v0.96.0 (in progress) · 2026-10-01

Audacity, RX and Audition all learn noise from a selection; afftdn can sample a profile at runtime but only from the stream it is processing, and the apply path's one-input graph cannot read a second file. So the profile is learned in the graph itself: `asplit` the input, trim the learned range out of one branch and `concat` it in front of the other, `asendcmd` turns `sn` on at 0 and off 50 ms before the prefix ends, the effect's own chain runs (afftdn now holding the sampled profile), and `atrim` drops the prefix; the delay compensation then lands after as for any afftdn chain. `noise_from` and `noise_to` ride in the params dict beside the sliders (ignored by `_values`), must lie inside the file and last 0.1 s, and are refused for an effect without afftdn; `LEARNS_NOISE` is derived from the chains (voice-clean, denoise, deep-denoise, hiss-cut, de-wind, guitar-denoise) and published as `learnsNoise` in the catalogue. Verified on the engine with the noisy fixture (coloured noise at -39.5 dB with tone bursts from 2 s and a click at 4.0 s): Denoise at -40 with the 0.2 to 1.8 s range took that range to -45.1 dB against -42.6 for the plain estimate and -39.5 at the source, the signal band unchanged at -16.5 dB, 288000 frames in and out, the click at 192000 in and out; Enhance speech with the range likewise aligned; Amplify with a range answered 422 naming the effects that learn; a range outside the clip and a 0.05 s range answered 422 with the numbers. Stated: a range of pure noise is the user's to choose, and the sampled profile is afftdn's own, so the gain over its estimate is a few dB on steady noise rather than RX's spectral subtraction.

### app/services/effects.py · Ramp tempo and pitch (AU-B18, RX-47, RX-48)
- refers-to: app/services/effects.py :: `_ramp_chain`, `PARAMS["ramp"]`, the `ramp` branch in `apply`, `RETIMING`
- kind: explainer
- logged: v0.98.0 (in progress) · 2026-10-01

Audacity's Sliding Stretch and RX's variable time and pitch change tempo and pitch gradually across a selection; ffmpeg's rubberband takes `tempo` and `pitch` as runtime commands, so the ramp is `asendcmd` driving both in 100 steps across the clip's duration (known only at apply time, so the chain is built there rather than by the PARAMS builder), each step set at its own centre; tempo moves linearly in rate (50 to 200%) and pitch linearly in semitones (geometric in the factor, -12 to +12). One trap, measured: when the pitch factor equals the tempo factor at a step (a tape-style ramp, tempo 100 to 200% with pitch 0 to 12 st) rubberband's effective stretch ratio sits at exactly 1 and its output length goes wrong (1.944 s where 2.773 was due, and 6.041 where 3.697 was); a 0.1% nudge of the pitch factor (1.7 cents) whenever the two are within 0.002 restores it (2.788 and 3.767 s). Verified on the engine with a 440 Hz tone of 4 s: pitch 0 to 12 st alone kept 192000 frames and read 520, 625 and 740 Hz at 1, 2 and 3 s against 523, 622 and 740 on the semitone line; tempo 100 to 200% alone gave 2.788 s against the input-time integral's 2.773 with the pitch held at 440; tempo 200 to 50% with pitch 12 to -12 gave 3.754 s against 3.697 with the frequency falling from 738 to 258 Hz; four single tempo ramps in both directions landed within 1.3% of their integrals; neutral settings keep the length and pitch; in the Inspector the four sliders apply in one undo step ("Ramp tempo and pitch 100% 200% 0st 12st"), the clip reading 2.798 s; the effect is in RETIMING so it applies to whole clips; 92 effects, 32 adjustable; verify_params.py passing; no page errors. Stated: a piecewise ramp (100 steps, within about 1.5% of the continuous curve), linear in rate and in semitones only, no drawn curve.

### app/services/audacity.py, app/routers/projects.py · Audacity 2.x projects (.aup with _data) open as sessions (AU-34)
- refers-to: app/services/audacity.py :: `import_aup_zip`, `_read_au`, `_clip_samples`, `_wav_bytes`; app/routers/projects.py :: `POST /api/projects/import-audacity`
- kind: explainer
- logged: v0.99.0 (in progress) · 2026-10-01

A 2.x project is an .aup XML beside a _data folder of .au blocks, so the reader takes the two zipped together (a browser cannot pick a folder with its file), walks wavetrack, waveclip, sequence and waveblock, concatenates each clip's simpleblockfile and silentblockfile blocks in start order, and refuses the aliased block kinds that reference audio outside the folder. The .au header is Audacity's own quirk: written in the machine's byte order, so the magic reads "dns." and the fields are little-endian, with float32 samples (format 262159) or int16 (131073) at the header's data offset past the summaries; both byte orders are accepted. A linked pair (channel 0 with linked="1" and the channel 1 that follows) becomes one stereo track when the clips' offsets line up, otherwise two mono tracks; gain becomes dB, pan and mute and solo carry over; label tracks become markers (t equals t1) and regions. The document returned has the project's rate, the clips at their offsets in samples, and media refs for the WAVs stored. Verified on the engine with a project built by hand from the format (a linked stereo pair of two blocks per channel at 0.5 s with gain 0.5, a mono track at 2.0 s with pan -0.25, a point label and a span label): 2 tracks, 2 clips, 2 labels; Music stereo at -6.02 dB with its clip at 22050 for 44100, Voice mono with pan -0.25 at 88200, a marker at 44100 and a region 110250 to 154350; every sample of all three channels byte-identical to the arrays the fixture was made from; in Chromium the zip through the picker opened the session with the notice naming what was and was not carried over, two lanes and two clips, and a further import still landed. Stated: the fixture follows the format, not a file Audacity wrote, so the row is partial until the owner opens a real 2.x project; envelopes (clip gain curves), effects and the view state are not carried over; .aup3 is not read, its project document being a binary tokenised blob this reader does not guess at.

### app/services/tools.py, app/routers/media.py · samples read in place and drawn into a copy (AU-13)
- refers-to: app/services/tools.py :: `_wav_view`, `samples`, `draw`; app/routers/media.py :: `GET /api/media/{id}/samples`, `POST /api/media/{id}/draw`
- kind: explainer
- logged: v1.1.0 (in progress) · 2026-10-01

Sample drawing needs the raw samples of a window and a way to write some back. `_wav_view` parses the stored WAV's chunks (the engine writes WAVE_FORMAT_EXTENSIBLE with the IEEE-float subformat, so the subformat code is read from the extension; 16-bit PCM is accepted too) and maps the data chunk from disk with numpy's memmap, so a window of a long file costs a window, not the file. `samples` returns up to 20000 samples per channel from a start; `draw` copies the whole file, writes the values into every channel from the start (clipped to -1 to 1), and stores the copy as new media named "(drawn)" once, so the clip's old media stays for undo. Refused: an empty or 100000-plus run, non-numbers, and a run past either end, each with the numbers. Verified on the engine with a 4 s 440 Hz tone: a 256-sample window from 47872 matched the file exactly; a 128-sample ramp drawn from 47936 read back with zero error, every other sample of the 192000 byte-identical, the frame count unchanged; both refusals answered 422 with their reasons. Stated: drawing writes every channel alike.

### app/services/tools.py, app/routers/media.py · room tone matched to a learned range, into a gap (RX-01)
- refers-to: app/services/tools.py :: `room_tone`; app/routers/media.py :: `POST /api/media/{id}/room-tone`
- kind: explainer
- logged: v1.3.0 (in progress) · 2026-10-01

RX's ambience match fills edits with a background bed matched to the recording's. The engine takes a learned range (on the same or another media at the same rate, at least 0.1 s) and a range to fill: Welch's power spectrum of the learned range (Hann frames of up to 4096 samples at half overlap, normalised by the window's power so a white input reads its own variance) shapes fresh white noise of the gap's length in one FFT, which gives the shaped noise the learned variance by Parseval, and the result replaces the gap with 10 ms linear crossfades inside it at each end; the noise is seeded from the media and the range so a render repeats exactly; the copy is stored as "(room tone)" media and the rest is byte-identical. Verified on the engine with a fixture of low-heavy room tone at -39.8 dBFS, two 300 Hz bursts and a 1 s gap of digital silence: filled from 0.2 to 1.8 s's tone, the gap's middle read -39.88 dB against -39.81 learned, the octave bands at 125 Hz, 500 Hz, 2 kHz and 8 kHz within 0.72, 0.25, 0.41 and 0.08 dB of the learned, the correlation with the learned audio 0.02 (synthesised, not copied), the gap's first sample 0 rising over 10 ms, everything outside the gap identical, a second render identical to the first; a 0.05 s learn, a fill past the end and a missing field answered 422 with their reasons. Stated: stationary noise only (a spectrum averaged over the learned range, so hum that drifts or a room with movement is matched on average), channels filled independently.

### app/services/projects.py, app/routers/projects.py · saved sessions carry a thumbnail (AU-32)
- refers-to: app/services/projects.py :: `THUMBNAIL_MAX_SECONDS`, `_thumbnail`, `thumbnail`, the `thumbnail` key in the manifest and the summary, `thumbnail.png` in the zip; app/routers/projects.py :: `GET /api/projects/{name}/thumbnail.png`
- kind: explainer
- logged: v1.5.0 (in progress) · 2026-10-01

A save now renders the session's mix through the engine's own renderer and draws it with ffmpeg's showwavespic (320 by 64, the accent colour, a square-root scale so quiet sessions still read) into thumbnail.png inside the .fmw, before the save lock is taken; the manifest names it, the session summary reports it, and a route serves it. The picture is optional: an empty session, one longer than 5 minutes (rendering a long mix whole would hold hundreds of megabytes for a picture) or any failure saves without one, and a .fmw from before this release, with no thumbnail, opens and lists as before (the format version is unchanged, readers ignore the extra entry). Verified on the engine: an Audacity project of two tracks saved in 0.25 s with manifest, session and thumbnail.png in the zip, the route serving the stored bytes exactly, and the picture's pixels lit only where the session has audio (0 per column over 0 to 0.5 s and 1.5 to 2 s, 6 over the music, 5 over the voice); a 6 s session with room tone, two bursts and a silent gap saved in 0.22 s with 5 lit pixels per column over the room tone, 27 over the bursts and 0 over the gap; a 6-minute session saved in 0.27 s without a thumbnail and the route answered 404 saying so. Stated: no picture for sessions over 5 minutes yet (a picture from the clips' peaks would scale to any length), and the picture is the mix's waveform, not a view of the tracks.

### app/services/transcript.py, app/routers/media.py · one transcript word's boundaries can be moved (DS-11)
- refers-to: app/services/transcript.py :: `set_word`; app/routers/media.py :: `PUT /api/media/{id}/transcript/word`
- kind: explainer
- logged: v1.6.0 (in progress) · 2026-10-01

Descript lets a word's edges be dragged when the recogniser's timing is off, so that deleting the word removes exactly the word. The cached transcript (data/transcripts/{media}.{model}.json, written by faster-whisper on first transcription) gains an edit: index, start and end in the media file's seconds, validated to start before it ends and to stay between the previous word's end and the next word's start (or the file's ends), rounded to milliseconds like the recogniser's own times, and written back. Verified with a transcript seeded in the cache's format over a fixture of four 440 Hz bursts (faster-whisper is not installed in this container, so the cache stood in for its output): word one moved from 0.52 to 0.85 s to 0.5 to 0.9 s and read back from the file so; an end of 1.5 s, past the next word's start at 1.4 s, answered 422 naming the bounds. Stated: the edit changes the cached transcript of that media for every clip that uses it, and a re-transcription with another model keeps its own timings.

### app/services/library.py, app/routers/media.py · a stock library of synthesised sounds (DS-14)
- refers-to: app/services/library.py :: `ITEMS`, `catalogue`, `render`, `wav`, `add`; app/routers/media.py :: `GET /api/library`, `GET /api/library/{item}/preview.wav`, `POST /api/library/{item}`
- kind: explainer
- logged: v1.8.0 (in progress) · 2026-10-01

Descript ships a stock library. formwav's is synthesised, so royalty-free by construction: ten items in five categories (line-up and timing: a 1 kHz reference tone at -18 dBFS, a 120 BPM click track with accented downbeats, a countdown; room tone: a quiet room and air conditioning with mains hum; transitions: a riser, a whoosh, an impact; a bell stinger; an A minor drone bed), each rendered with numpy from a fixed recipe with a seed from its id at the session's rate, stored as media (the same item at the same rate is the same media). Verified on the engine: the reference tone peaked at -18.00 dBFS at 1000 Hz over 480000 frames; the click track's 16 clicks fell every 0.5 s with the downbeats at 0.6 and the others at 0.4; the quiet room measured -50.01 dBFS RMS with 98.8% of its power below 1 kHz; the riser's spectral centroid climbed 1111, 2042, 3942 and 7044 Hz across its four seconds; adding an item twice returned the same media; the tone rendered at 44.1 kHz as 441000 frames; the bell's preview served a WAV; an unknown item answered 404. Stated: synthesised sounds only, not a licensed library of recorded music and effects.

### app/services/render.py · exports follow a clip's gain envelope, merged with track automation (AU-12)
- refers-to: app/services/render.py :: `_env_gain`, `_clip_envelope`, the per-clip envelope in `plan`
- kind: explainer
- logged: v1.9.0 (in progress) · 2026-10-01

A clip may carry an envelope of dB points at its media's frames. The export planner maps them to session time (start plus frame minus trim), and when the track has volume automation multiplies the two the way the core interpolates (linear in gain between dB points): sampled at both sets of breakpoints and eight times inside each span, with points before the session start folded into one at 0; the clip then uses that envelope instead of the track's. The browser planner does the same (player.ts), so playback and export agree. Verified on the engine with a 4 s 440 Hz tone and points at 1, 2 and 3 s of 0, -20 and 0 dB: 100 ms windows read 0, -0.10, -5.18, -18.19, -5.18 and 0 dB relative to the tone at 0.5, 1.0, 1.5, 2.0, 2.5 and 3.5 s, against 0, -0.1, -5.19, -18.19, -5.19 and 0 for the same windows over the line (the -20 dB corner averaged by the window); with -6 dB of track automation every reading fell by 6 dB; after a 0.5 s trim of the clip's left edge the -20 dB point still sat at 2.0 s; verify_export.py and verify_automation_parity.py unchanged and passing (automation parity 0.0 and 3e-8).

### app/routers/media.py, app/services/tools.py, app/services/tempo.py · PCM pieces from the mapped file; 16-bit read by the slice; tempo in bounded memory
- refers-to: app/routers/media.py :: `GET /api/media/{id}/pcm`; app/services/tools.py :: `_Scaled`, `_wav_view`; app/services/tempo.py :: `envelope`
- kind: warning-context
- logged: v1.11.0 (in progress) · 2026-10-01

Three changes, two of them fixes found by measuring the streaming work. The new route serves any frame range of a stored file as interleaved float32 (at most 100 s at 48 kHz a request) from the file mapped on disk. `_wav_view` had converted a 16-bit file to float32 whole on every call, so each 2 s piece of a 30-minute file cost a full-file conversion (and Draw samples and room tone fill paid the same on 16-bit files since v1.1.0 and v1.3.0); a 16-bit file now reads as float32 slice by slice and converts whole only when a caller asks for the whole. The tempo detector, which the interface runs on every import, built its spectral flux by windowing and transforming every frame at once, gigabytes for ten minutes, and on a 30-minute import that got the engine killed for memory three times in this 4 GB container; it now runs 4096 frames at a time with an identical result. Verified on the engine's worker process (under --reload the worker is a child of the reloader, which is what the first readings had measured by mistake): 100 pieces of the 30-minute file held the worker at about 71 MB and took about 3 ms each, the piece at 25:00 equal to ffmpeg's own read of the file to 0.0; the blocked flux equal to the old one to 0.0 on 90 s, ten minutes adding 40 MB at peak; a 30-minute import through the interface peaked at 1.08 GB with no kill (it had been killed at 2.3 to 2.9 GB); verify_tempo.py still reads 100, 60 and 137 BPM; Draw samples reads a 16-bit file's window at 30 s.

### app/services/effects.py · De-reverb, late-reverberation suppression, and a numpy path for effects (RX-12)
- refers-to: app/services/effects.py :: `_dereverb`, `NUMPY_EFFECTS`, the numpy branch in `apply`, the `dereverb` catalogue entry, chain and controls
- kind: explainer
- logged: v1.13.0 (in progress) · 2026-10-01

ffmpeg has no de-reverb, so effects gain a numpy path: an effect in NUMPY_EFFECTS renders from the stored file in numpy and is stored and named like the rest. De-reverb follows Lebart and Boucher: in a short-time spectrum (periodic Hann, 2048 points at 48 kHz, quarter hop, which overlap-adds exactly, so Amount 0 returns the input), the late reverberant power at a frame is the power about 50 ms earlier decayed at the rate the Reverb time implies; powers are smoothed over about 20 ms first (a tail's power in one bin fluctuates so widely that unsmoothed ratios left the gain open: the first version moved the tail only 2.25 dB at 70%), Amount 100% over-subtracts twice the estimate, and the gain is floored at Floor dB; frames run 1024 at a time, so memory is bounded. Verified on a fixture of four tone bursts through a synthetic 0.8 s room (a direct impulse and a decaying noise tail of equal energy): Amount 0 returned the input to 4e-17; at 50, 70 and 100% the tail-to-burst ratio fell from -14.22 dB to -17.38, -18.86 and -20.40 dB while the bursts lost 1.51, 2.30 and 3.61 dB; with Reverb time set to 0.4 s it removed less (-15.68) and at 1.6 s more (-20.98); the output's length equals the input's. Stated: a waveform match against the dry signal does not improve (5.21 dB wet, 5.04 at 70%), since subtraction also reshapes the direct sound, so this reduces reverb rather than restoring the dry recording; one room was measured; no neural model.

### app/services/effects.py · Spot heal, spectral repair of a box from its surroundings (AA-06)
- refers-to: app/services/effects.py :: `_spot_heal`, `NUMPY_EFFECTS["spot-heal"]`, the `spot-heal` catalogue entry, chain and controls
- kind: explainer
- logged: v1.14.0 (in progress) · 2026-10-01

Audition's Spot Healing Brush and RX's Spectral Repair repair a painted area from what surrounds it. Spot heal takes a box (Low and High Hz, From and To in the media's seconds) and, in a short-time spectrum, caps each bin's magnitude inside it at the level the four frames before and after the box predict (interpolated across the box in dB), the phase kept: an artifact standing above its surroundings comes down to them, and material running through the box at its surroundings' level passes. Every frame whose window overlaps the box is repaired (the first version took only frames centred in it, which left a click in a 10 ms box at 0.537 of its 0.896 peak); only a segment around the box is transformed, and frames outside it reconstruct exactly. Verified on the engine with a 440 Hz tone over a -50 dBFS floor carrying a 3 kHz whistle and a click: the whistle's band over the box fell from 63.35 to -2.40 dB (the clean band elsewhere 1.24) with the tone's band unchanged at 58.91 dB; the click's peak fell from 0.896 to 0.300, the tone's own peak, its 5 to 20 kHz energy by 19 dB, the tone's band moving 0.02 dB; outside both boxes the audio was unchanged to 0.0. Stated: the attenuate mode only (no replacement from a learned pattern), so an artifact that removes material, a dropout, is not filled.

### app/services/effects.py · Wow and flutter, a tracked speed curve resampled away (RX-51)
- refers-to: app/services/effects.py :: `_wow_flutter`, `NUMPY_EFFECTS["wow-flutter"]`, the `wow-flutter` catalogue entry, chain and controls
- kind: explainer
- logged: v1.15.0 (in progress) · 2026-10-01

RX's Wow & Flutter tracks a steady component and undoes the speed drift it reveals. A component between Track from and Track to is tracked every 5 ms (the strongest STFT peak, refined by a parabola through its log magnitudes); its frequency over its median is the speed curve, and since drift shifts every component by the same ratio, the audio is resampled by the inverse curve (cubic interpolation), the positions kept at frame resolution and the output rendered a million samples at a time; Amount scales the correction; a jump to another component (over 8%) is not taken for a speed change. The analysis window spans about 20 periods of the lowest frequency tracked and no more: the first version used 8192 points at 48 kHz, one whole period of 6 Hz flutter, and left 0.176% where the window now leaves 0.115%; the default band starts at 500 Hz for that reason. Verified against an instrument independent of the tracker (each tone's instantaneous frequency from its analytic signal, 10 ms averages) on two tones at 1 and 3.3 kHz with 0.5% wow at 0.5 Hz and 0.2% flutter at 6 Hz built analytically: peak-to-peak deviation fell from 1.385% to 0.115% on both tones alike (12 times, 21.6 dB), Amount 50% left 0.727%, and a band from 100 Hz (the longest window) left 0.36%; a steady input stayed steady (0.0032 to 0.0034%), its samples moving -30 dB relative to it from the tracker's own sub-sample noise; lengths stay within 0.02% of the input. Stated: it needs a steady component in the band (a held note, a hum, a bias or test tone), one curve is applied to all channels, and flutter much faster than 6 Hz is tracked less well.

### app/services/effects.py, app/routers/media.py · De-bleed against a reference recording (RX-05)
- refers-to: app/services/effects.py :: `debleed`; app/routers/media.py :: `POST /api/media/{id}/debleed?reference=&offset=&amount=`
- kind: explainer
- logged: v1.16.0 (in progress) · 2026-10-01

RX's De-bleed removes what leaked into a recording from another source, given that source. The leak is the reference through a fixed path, a delay and a short filter: the delay is found by cross-correlation (from 50 ms early to 250 ms late) and a 128-tap filter starting 16 samples before it by least squares over at most the first minute, both from FFT correlations, then the reference through that filter is subtracted in the time domain by blocks of FFT convolution; `offset` is the reference's frame at the recording's frame 0, and Amount scales the subtraction. The first version estimated one transfer value per frequency bin from the cross-spectrum, and wherever the wanted sound was louder than the bleed its estimates drowned: it cut 5.7 dB and a reference misaligned by half a second did nearly as well. Verified on a melodic line with a backing track (drum-like noise bursts, a bass line and a pad, starting 0.5 s before it) bled in through a 4 ms delay, a 3 kHz low-pass and -15 dB: the bleed left relative to the line fell from -15.81 to -25.10 dB (9.3 dB) with the line kept (correlation 0.998), Amount 50% left -20.78 dB, the same reference misaligned by 0.5 s left -20.66 dB, Amount 0 returned the input exactly, and the recording as its own reference is refused. Stated: 9.3 dB on this fixture, where the line's 494 Hz harmonic shares a pitch with the pad and limits any estimate made from a reference; no reference-free mode; a path longer than about 2.7 ms after the delay is only partly caught.

### app/services/effects.py · De-bleed re-fits the path weighted toward where the wanted sound is quiet (RX-05)
- refers-to: app/services/effects.py :: `debleed`, the second fit (`placed`, the block weights)
- kind: warning-context
- logged: v1.16.0 (in progress) · 2026-10-01

De-bleed's first fit cut 9.3 dB on the line-and-backing fixture. Two diagnostics found why: the bleed alone cancelled by 33.5 dB, and the same line with the backing's pad moved off its harmonics by 24.3 dB, so the line's 494 Hz harmonic, on a pad note, was being taken for leak. The path is now fitted a second time with each 50 ms block weighted by the inverse of what the first fit left in it, so pauses, breaths and gaps carry the fit when there are some, and without them the weights stay near uniform (a cut at the quietest 30% of blocks was tried first and still took in sung blocks: 25.5 dB). Verified: the shared-pitch fixture's bleed fell from -15.81 to -48.78 dB relative to the line, the line kept to a correlation of 0.99999; the off-pitch fixture to -48.65 dB; the bleed alone stayed at -33.53 dB; Amount 50% left -21.82 dB, a reference misaligned by 0.5 s -22.43 dB, Amount 0 the input exactly. Stated: the second fit leans on quiet moments, so a recording with none gets the first fit's accuracy.

### app/services/effects.py · Pitch correction to the nearest note of a key and scale (PT-10)
- refers-to: app/services/effects.py :: `_f0_track`, `_pitch_correct`, `NUMPY_EFFECTS["pitch-correct"]`, the `pitch-correct` catalogue entry, chain and controls
- kind: explainer
- logged: v1.17.0 (in progress) · 2026-10-01

Pro Tools corrects pitch through Melodyne; Auto-Tune's correction is the model. The pitch is tracked every 5 ms by YIN on a 16 kHz copy (60 to 1000 Hz, with voicing); each voiced frame's target is the nearest note of the Key and Scale (chromatic, major or minor); the correction glides to it with the Retune speed (0 snaps), is scaled by Amount, and glides back to none where unvoiced; rubberband applies it over time from a command file, a command only when the ratio moves by half a cent. Two faults were found on the way, both by measuring the applied shift every 100 ms rather than trusting the commands: 100 commands a second throughout, and then rubberband's default crisp transients, which reset phase inside held notes and left them wobbling over 40 to 100 cents; its consistency mode with smooth transients holds every note within about a cent, and Amount 0 now returns the input untouched instead of passing it through rubberband. Verified on four harmonic notes held 30 cents sharp, 40 flat, 20 sharp and 10 sharp (the tracker reading each within 0.4 Hz of the truth): chromatic at speed 0 they landed at -0.5, -0.0, -1.3 and -0.3 cents, by an FFT measurement independent of the tracker; in C major the out-of-scale C sharp went to D (-0.2 cents); Amount 50% left +14.7, -20.5, +9.4 and +4.3 against +15, -20, +10 and +5; with a 200 ms retune speed a note began near the previous note's correction and was on target (-1.3 cents) by its middle; lengths were kept. Stated: one pitch per moment (no chords), no drawn pitch curve or note editor, the formants move with the pitch, and the controls are numbers (Key 0 to 11, Scale 0 to 2) rather than named menus.

### app/services/effects.py · Dialogue contour, and the rubberband step shared with Pitch correction (RX-17)
- refers-to: app/services/effects.py :: `_dialogue_contour`, `_rubberband_pitch` (now used by `_pitch_correct` too), the `dialogue-contour` catalogue entry, chain and controls
- kind: explainer
- logged: v1.18.0 (in progress) · 2026-10-01

RX's Dialogue Contour reshapes a line's intonation. Between From and To (the whole clip when To is not after From), the pitch is tracked every 5 ms and its slow contour (voiced pitch smoothed over Smoothing ms, gaps bridged) is scaled about its median by Intonation range (0% flat, 100% as it was, 200% twice the movement); a ramp from Shift at start to Shift at end is added; the voice's small fast movements are kept, unvoiced moments follow the ramp, the shift eases in and out over 20 ms at the span's edges, and rubberband applies it with the formants kept where they were (formant=preserved); Range 100% with no shift returns the input untouched. Pitch correction's rubberband step became a helper both use, with the same behaviour. Verified on a spoken-style phrase of eight syllables with a 3-semitone intonation arc and fixed resonances at 700 and 1200 Hz, read by a harmonic-product instrument independent of the tracker and confined to the phrase's range (it matched the true contour within 4.3 cents; unconfined, and a plain FFT peak before it, it slipped octaves on the weak fundamental, which is why both were replaced before any result was kept): the syllables' spread of 85.3 cents became 9.6 at 0%, 43.4 at 50% and 167.7 at 200%, the median staying within 11.5 cents; a ramp to +3 semitones over the phrase put every syllable within 1 to 5 cents of its expected shift; a span left every syllable outside it unchanged; the neutral setting returned the input exactly; with formants kept, a 3-semitone rise moved the spectral centroid 9% where moving formants would move it 19%. Stated: a ramp and a range, not a drawn curve; steep ramps lead by about 60 ms (14 to 17 cents on 3 semitones over 1.15 s).

### app/routers/terminal.py, app/main.py · a real shell over a WebSocket for the embedded terminal (owner decision, Sprint D)
- refers-to: app/routers/terminal.py :: `terminal` (`/api/terminal`), `_allowed`; app/main.py :: the router mounted under /api
- kind: warning-context
- logged: v1.20.0 (in progress) · 2026-10-01

The owner asked for an embedded terminal that is real. The socket starts the user's own shell ($SHELL, else bash) as a login shell in a pseudo-terminal in the home directory, TERM set for xterm.js; browser bytes go to the PTY untouched, its output comes back as binary frames, and a JSON frame sets the window size; when the shell exits the socket closes, and when the socket closes the shell is hung up, waited for without blocking the engine and killed after a second if it ignores the hangup. A browser lets any page open a WebSocket to 127.0.0.1, which would hand a shell to any website, so the socket is accepted only from the app's own origins (the CORS list) and refused before a shell exists otherwise; FORMWAV_TERMINAL=0 turns it off. Verified with a WebSocket client: from the app's origin a resize to 100 by 30 read back as "30 100" from stty, tty answered /dev/pts/0, `echo formwav-$((6*7))` printed formwav-42, TERM was xterm-256color, `exit` closed the socket with 1000 and left no shell running; a foreign origin and a missing origin were both refused with 403. Stated: POSIX only (macOS and Linux); Windows needs ConPTY, not built yet; the shell runs as the user the engine runs as, with that user's rights.

### formwav_mcp/, app/services/media.py, app/routers/media.py, oc_install · formwav's MCP server (owner decision, Sprint D)
- refers-to: formwav_mcp/server.py :: the MCPServer, its 12 `formwav_*` tools and the `formwav_repair_workflow` prompt, `main` (stdio, or --http as stateless Streamable HTTP with JSON responses on 127.0.0.1:8061/mcp); formwav_mcp/requirements.txt (mcp 2.2.0, httpx); app/services/media.py :: `list_media`; app/routers/media.py :: `GET /api/media`; oc_install :: the MCP venv
- kind: warning-context
- logged: v1.21.0 (in progress) · 2026-10-01

The owner asked for an MCP server. Built to the mcp-dev-oracle pack's guidance for the protocol as it stands after the 2026-07-28 revision: stateless, media ids and session names as handles, every edit making new media so nothing is destructive, annotations on every tool (6 read-only), typed structured output (all 12 tools carry an output schema), no root-level schema combinators (the Claude API rejects them), errors returned in the result as what to do next, a strategy prompt, nothing on stdout but the protocol. It is a thin client over the running engine's HTTP API, so it shares the engine's media and saved sessions and keeps no state; the engine gained the one route an agent needed and the app never did, GET /api/media (stored media, newest first, a page at a time). Tools: status, list_media, analyze_media, list_effects, apply_effect, debleed, import_audio, export_media, list_sessions, get_session, render_session, transcribe_media. The MCP SDK 2.2.0 (MIT) needs Starlette 1.x and the engine's FastAPI 0.115 pins below 0.47, so installing it into the engine's venv broke that pin (caught by pip's check and undone: the engine's venv is back to its own pins with pip check clean); the server has its own venv, which oc_install now builds, and .gitignore already keeps every venv out of the repository. Verified with the SDK's own client over stdio and over Streamable HTTP: 12 tools, 6 read-only, 12 output schemas, no root combinators, the one prompt; status read engine 1.20.0 with 285 media and 5 sessions; a repair loop imported a reverberant file, measured it (peak -6.02 dB, RMS -20.02), found dereverb by searching "reverb", applied it (a new media, the source kept), measured the result (-8.55, -22.64) and exported 6 s of WAV; a saved session was read and rendered to MP3; a bad media id and a missing file came back as in-result errors naming the fix; over HTTP a request with a foreign Origin was refused with 403 (the SDK's protection on loopback) and one with no Origin, as local clients send, was served.

### formwav_mcp/serve, README.md · launching the MCP server from any directory, and how to connect an agent
- refers-to: formwav_mcp/serve; README.md :: the "Connect an agent (MCP)" section and FORMWAV_TERMINAL in Configuration
- kind: explainer
- logged: v1.21.0 (in progress) · 2026-10-01

`-m formwav_mcp.server` only imports with backend/ as the working directory, and MCP clients launch stdio servers from their own (Claude Code has no working-directory setting), so the README's first snippet would have failed; the launcher changes into backend/ and runs the server's venv, passing --http through. The README gives Claude Desktop's config and Claude Code's `claude mcp add` against it, and the HTTP endpoint. Verified: launched from / by the SDK's stdio client, 12 tools listed; with the engine stopped, formwav_status and formwav_get_session came back as in-result errors saying to start the engine; `serve --http` answered a raw tools/list with 12 tools.

### app/routers/agent.py, app/main.py · the in-app agent's model turn (owner decision, Sprint D: agent actions and controls)
- refers-to: app/routers/agent.py :: `agent_step` (`POST /api/agent/step`), `_post`; app/main.py :: the router under /api
- kind: warning-context
- logged: v1.22.0 (in progress) · 2026-10-01

The open session lives in the browser, so the browser runs the agent's loop; this route forwards one turn (system, messages, tools) to the Anthropic Messages API and returns the reply, so the API key stays in the engine (ANTHROPIC_API_KEY in backend/.env, which boot_backend sources) and never reaches the page. FORMWAV_AGENT_MODEL picks the model (claude-sonnet-5-5 by default), ANTHROPIC_BASE_URL points elsewhere; standard library in a worker thread, so no dependency. Verified: with no key the route answered 503 saying to put ANTHROPIC_API_KEY in backend/.env and restart; pointed at a recording stand-in of the Messages API (sidecar verification/anthropic_standin.py) with a dummy key, a run from the app sent three requests to /v1/messages carrying the engine's key, anthropic-version 2023-06-01, the model claude-sonnet-5-5 and the 16 tool definitions, the conversation growing 1, 3 and 5 messages. Stated: no real model was called (no key here); the first real run is the owner's.

### app/services/providers.py, app/routers/providers.py, app/main.py, local_models.example.json · the model-provider layer (owner decision, v1.20.0)
- refers-to: app/services/providers.py :: `providers`, `elevenlabs_voices`, `elevenlabs_speech`, `elevenlabs_sound`, `elevenlabs_dub_start`, `elevenlabs_dub_status`, `fal_generate`, `_audio_url`, `local_generate`, `local_models`, `ProviderError`; app/routers/providers.py :: `/api/providers*`; local_models.example.json
- kind: warning-context
- logged: v1.23.0 (in progress) · 2026-10-01

The owner asked for models both local (open weights such as ACE-Step) and in the cloud (ElevenLabs, fal). One registry: ElevenLabs (ELEVENLABS_API_KEY) for speech in a chosen voice, sound effects and dubbing, on the endpoints its documentation gives (checked on 2026-10-01: /v1/text-to-speech/{voice_id} with xi-api-key, /v1/voices, /v1/sound-generation, POST /v1/dubbing as multipart then GET /v1/dubbing/{id} and /audio/{lang}); fal (FAL_KEY) for any model through its queue (POST queue.fal.run/{model} with Authorization: Key, poll status_url to COMPLETED, read response_url), with ACE-Step 1.5 and two older ACE-Step endpoints as presets, the output's first audio URL downloaded; local models as command templates in backend/models/local_models.json (git-ignored, like the weights), {prompt}, {lyrics}, {duration} and {out} filled in, run with a time limit, the written file imported. Everything lands as media through the media service; keys stay in the engine; dubbing is a job (start, then poll until the media comes back); ELEVENLABS_BASE_URL and FAL_QUEUE_URL point the clients elsewhere. Standard library only. Verified through the engine against a recording stand-in (sidecar verification/provider_standin.py, a tone per endpoint) and a test command: voices listed; speech, a sound effect, a dub (two polls), an ACE-Step 1.5 song through fal's queue (two status reads) and a local model's output each imported with the stand-in's pitch for that endpoint (220, 330, 440, 550 and 660 Hz) and its length; the stand-in recorded the documented shapes (xi-api-key on every ElevenLabs call, the TTS body's text and model_id, the dub's multipart fields file, target_lang, source_lang and name, fal's Key header on submit and status but none on the public file URL); an unknown local model, a malformed fal id and empty speech text were refused with messages saying what to do. Stated: no provider was really called (no keys or weights here); the stand-in had a bug of its own (it parsed multipart field names wrongly and dropped the connection), fixed in the stand-in before the dub was measured; the ACE-Step entry in the example file is a template whose script and flags come from ACE-Step's own README.

### app/services/providers.py, app/routers/providers.py · regenerating words in their speaker's voice (DS-09)
- refers-to: app/services/providers.py :: `elevenlabs_clone`, `elevenlabs_regenerate`, `elevenlabs_speech` (its rate); app/routers/providers.py :: `POST /api/providers/elevenlabs/regenerate`
- kind: warning-context
- logged: v1.24.0 (in progress) · 2026-10-01

A range of a media, in its own seconds, is spoken again as new text in the speaker's voice: the voice is cloned once per media from its first 90 s (16-bit mono WAV, under ElevenLabs' 10 MB per file; POST /v1/voices/add as multipart name and files, checked against ElevenLabs' reference on 2026-10-01) and remembered in the media store's voices.json; the speech is imported at the source's rate; the splice keeps the source before and after exactly and joins with 10 ms equal-power crossfades; the answer gives the new media and how many frames longer it is, for the caller to ripple. _wav_view reads 16-bit sources through a wrapper that already scales to float, which the first version wrongly tested for a dtype (an AttributeError on the first try, from the engine's log). Verified against the recording stand-in on a 3.0 s phrase, 0.6 to 1.2 s replaced by 2.0 s of speech: the new media 4.38 s exactly, 1.38 s longer; the audio before and after the range identical to the original; the middle at the stand-in's 219.8 Hz; the largest sample step at the joins 0.113 and 0.111 against the source's own 0.117; the voice cloned once (fields files, name, remove_background_noise) and reused; under 50 ms and empty text refused. Stated: no real voice was cloned (no key); a real clone's likeness is the owner's to judge.

### app/core/security.py, app/main.py, app/routers/terminal.py, formwav_mcp/server.py · the loopback lockdown, and the interface served from the engine (desktop groundwork)
- refers-to: app/core/security.py :: `LocalOnly`, `LOCAL_HEADER`; app/main.py :: the middleware and the FORMWAV_DIST static mount; app/routers/terminal.py :: `_allowed` (the engine's own origin); formwav_mcp/server.py :: `_call` (the header)
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

Following the tauri-compiler skill's local API security, before the engine ships inside a desktop app (where it runs whenever the app is open): CORS stops a foreign page reading answers but not sending simple requests, so any site the user opened could have posted edits and renders to the engine. One ASGI middleware now refuses, with a 403 and a reason, a non-loopback client, a Host that is not loopback (DNS rebinding), and any POST, PUT, PATCH or DELETE under /api without `x-formwav-local: 1` (a header a foreign page cannot send without a preflight the engine never grants), and adds nosniff to every answer; the app adds the header through one fetch wrapper, the MCP server in its one request function, and the sidecar's direct-HTTP harnesses through a sitecustomize. With FORMWAV_DIST set (the desktop entry sets it) the engine also serves the built interface at /, after every API route, so page and API are one origin; the terminal therefore also accepts the engine's own origin, which no other site can present once the Host is held to loopback. Verified on a fresh engine: health 200 with nosniff; Host evil.example 403; a POST without the header 403, with it 201, and a cross-site text/plain POST (what a form can send) 403; a second engine with FORMWAV_DIST served index.html (title formwav) at / and the API beside it; the terminal answered the dev origin and the engine's own and refused a foreign one with 403; the MCP server applied an effect through it; a direct-HTTP harness was refused without the header and ran its 97-effect catalogue with it; the record and play browser harnesses passed.

### desktop_entry.py, requirements_desktop.txt · the engine as the desktop app's sidecar
- refers-to: desktop_entry.py :: `main`, `selfcheck`, `user_data_dir`, `load_env`, `resource_dir`; requirements_desktop.txt; ../build_macos_app
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

From the tauri-compiler skill's engine entry: `--selfcheck` prints one JSON line (Python, FastAPI, uvicorn, numpy, the native core, formwav's version, whether the interface is embedded, the data folder, whether ffmpeg is on PATH) and exits; otherwise uvicorn on 127.0.0.1 at FORMWAV_PORT (0 by default, so the OS picks and the bind line tells the shell). Added for formwav: a onefile binary unpacks into a temporary folder that is deleted on exit, and the engine's data folder defaulted to one beside its code, so media, sessions and transcripts would have vanished on quit; the entry now sets FORMWAV_DATA_DIR to the per-user folder (~/Library/Application Support/ai.nodemode.formwav on macOS, %APPDATA% on Windows, XDG data on Linux) and reads keys from a .env there. The desktop engine is the core (FastAPI, uvicorn, numpy, the native core): torch and the optional models are imported lazily by their features and stay out, which keeps the binary at 38.9 MB here. Verified by freezing it in a throwaway venv here (PyInstaller 6.22.3, 29 s, a Linux binary; macOS binaries come from macOS): the selfcheck read every core part and the embedded interface; started with FORMWAV_PORT=0 it printed its bind line with port 44299; the interface answered at / and the API beside it; the lockdown held inside it (a hostile Host and a header-less change both 403); a tone generated and normalized through the native core inside the binary, both files written to the user data folder, not the unpack folder.

### app/services/projects.py, app/routers/projects.py · opening a .fmw from anywhere on the machine (the desktop app's file association)
- refers-to: app/services/projects.py :: `open_file`; app/routers/projects.py :: `POST /api/projects/open-file`
- kind: explainer
- logged: v1.25.0 (in progress) · 2026-10-01

A session file the user opens with the desktop app reaches the page as ?open=<path>; the engine checks it is a readable formwav session, copies it into the sessions under its own name (or "name (2)" and on when a different session already has it; the same file again reuses its copy), and opens it like any saved session. Verified: an exported session opened from /tmp/outside as "My Take" with its 2 tracks, again without a duplicate, a different file of the same name as "My Take (2)"; a .wav, a missing path and a damaged file refused with what to do.

### desktop_entry.py · the engine ends with its shell, however the shell ends
- refers-to: desktop_entry.py :: `exit_with_shell` in `main` (FORMWAV_EXIT_WITH_STDIN)
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

Running the real shell under a virtual display found the engine orphaned when the window closed: both onefile processes lived on. Two causes compound: the shell's exit handler may not run when the window is destroyed or the shell crashes, and its kill is SIGKILL, which a PyInstaller onefile bootloader cannot pass to its Python child, so even a clean quit would orphan the server. The shell now sets FORMWAV_EXIT_WITH_STDIN=1 and the engine ends when its stdin, a pipe whose write end only the shell holds, reaches end-of-file, which happens however the shell ends. Opt-in, so the engine run on its own (the build script's selfcheck, the tests) is unaffected. Verified under Xvfb with the real shell: closing the window left no engine process; SIGKILL of the shell (no exit handler can run) left none within 4 s; the frozen engine without the flag and with stdin at /dev/null stayed up and healthy.

### spikes/host · spike B, plugin hosting: the CLAP half (owner decision, Sprint D)
- refers-to: spikes/host/src/main.rs :: `run_clap`, `report`; spikes/host/fixtures/clap-gain (a test plugin)
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

Spike B asks whether formwav's native side can host plugins: load one CLAP and one VST3, process a buffer, open an editor. `fwhost` is a Rust host on clap-sys 0.5 (MIT or Apache-2.0) and, for the VST3 half, vst3 0.3 (MIT or Apache-2.0, bindings generated from the VST3 SDK 3.8 now that it is MIT, so no SDK download). Its CLAP path loads the binary, takes clap_entry and the plugin factory, creates the first plugin with a host it can call back, reads its audio ports, activates it at 48 kHz, starts processing, runs 100 ms of a 1 kHz sine at -12 dBFS through it on both channels, stops, deactivates, destroys and deinitialises in CLAP's order, and prints what it measured. The fixture is a minimal CLAP plugin of known behaviour (stereo in and out, x0.5). Verified: the fixture loaded as "formwav test gain", one plugin in the file, one port in and one out, processed, input -15.01 dB RMS, output -21.03, gain -6.02 dB, exactly x0.5; a file that is not a plugin was refused ("invalid ELF header").

### spikes/host/src/main.rs · ten blocks, and a real third-party CLAP plugin hosted
- refers-to: spikes/host/src/main.rs :: `run_clap` (the block loop), `BLOCKS`
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

A real plugin was hosted next: Airwindows Consolidated, the 2026-09-19 Linux build of its DAWPlugin release, a 22 MB JUCE CLAP, downloaded to /tmp only and checked against the release's published SHA-256 (ca6ad0e4...). Its code is MIT but the binary, combined with JUCE and the VST3 SDK, is GPL-3.0, so it is a test subject that never enters the repository or the bundle. One 100 ms block read -42.11 dB, which looked like a fault and was the plugin ramping its parameters in from zero; the host now runs ten consecutive blocks with the clock advancing, as a DAW would, and reports the first beside the settled last. Verified: the fixture -6.02 dB on the first block and the last; Airwindows Consolidated loaded (com.airwindows.consolidated, one plugin, a stereo port in and out), -57.12 dB in the first block and a settled -11.02 dB by the tenth, its default effect's gain on this tone.

### spikes/host/src/main.rs · the VST3 half: a real VST3 plugin hosted
- refers-to: spikes/host/src/main.rs :: `run_vst3`, `vst3_binary`, `HostApplication`, `blocks` (FWHOST_BLOCKS)
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

The VST3 path on vst3 0.3 (bindings generated from the MIT VST3 SDK 3.8, nothing to download): the bundle's Linux binary is found (Contents/<arch>-linux/*.so), opened, entered through ModuleEntry with its library handle as Linux VST3 requires, its factory taken from GetPluginFactory, the first "Audio Module Class" chosen, the component created and initialised with a host context (a minimal IHostApplication written in Rust through ComWrapper), cast to IAudioProcessor, set to stereo in and out with both main buses active, set up for 48 kHz 32-bit realtime, activated, run for the same consecutive blocks as the CLAP path, then stopped, deactivated, terminated, released and the module exited. Verified on Airwindows Consolidated's VST3 build (the same checked download): three classes in the factory, the audio effect found, one bus in and one out, processed, the same first-block ramp from -57.12 dB as its CLAP build. Its settled level is not a fixed number in either format (VST3 -8.83, -5.60 and -8.12 dB after 1, 3 and 10 s; CLAP -11.02, -6.58 and -10.74; and a repeat of the 1 s VST3 run read -9.61): the default effect varies over time and Airwindows seeds its dither at random, so the formats are not compared on it; the deterministic fixture held -6.02 dB over 100 blocks. FWHOST_BLOCKS sets the number of blocks (10 by default).

### spikes/host · the CLAP editor: a real plugin's editor embedded and driven by the host's run loop
- refers-to: spikes/host/src/main.rs :: `run_clap_gui`, `host_get_extension` (timer-support, posix-fd-support, gui), `TIMERS`, `FDS`; Cargo.toml :: x11rb 0.13 and libc 0.2 (MIT or Apache-2.0)
- kind: warning-context
- logged: v1.26.0 (in progress) · 2026-10-02

On Linux a plugin editor draws from timers and from its X11 connection's descriptor, which the host must drive, so the host now offers CLAP's timer-support and posix-fd-support extensions (and host-gui callbacks), creates the parent X11 window itself (x11rb), and `fwhost clap-gui` creates, sizes, parents and shows the editor, then runs a real loop: poll() on the plugin's descriptors with on_fd for each ready one, due timers fired with on_timer, the window's own events drained; then hide, destroy and the usual teardown. Verified under Xvfb: the fixture, which has no editor, refused cleanly; Airwindows Consolidated's editor first killed the process with an X error (BadAtom, ChangeProperty, atom 0): JUCE looks up window-manager atoms only if they exist, and a bare Xvfb has no window manager to create them, so with Openbox running as any desktop would, the editor opened at 600 by 600 in the host's window, shown, registering one timer and two descriptors, and the loop made 362 timer calls and 1324 descriptor calls in 8 s before a clean teardown; the screenshot shows the live editor with its default effect, Galactic, a feedback reverb whose detune pitch-shifts both channels, which explains the level that moved from run to run in the VST3 entry above.

### spikes/host · the VST3 editor: a real plugin's view attached to the host's window, its run loop driven
- refers-to: spikes/host/src/main.rs :: `run_vst3_gui`, `EditorFrame` (IPlugFrame and Linux IRunLoop)
- kind: warning-context
- logged: v1.26.0 (in progress) · 2026-10-02

The VST3 editor needs more host than processing: the edit controller (Airwindows Consolidated, like any JUCE plugin, has a separate controller class, created from getControllerClassId, initialised with the host context, and connected to the component through IConnectionPoint, without which a JUCE controller has no processor and makes no view); createView("editor"), X11EmbedWindowID checked; an IPlugFrame, here a Rust COM class that is also Steinberg::Linux::IRunLoop, which the view queries to register its descriptors and timers; attached to an X11 window the host made from getSize; a loop calling onFDIsSet for ready descriptors and onTimer for due timers; then removed, the frame cleared, disconnected, terminated and the module exited. Verified under Xvfb with Openbox: the view attached at 600 by 600 with a separate controller, registered two descriptors (no timers at the end of the run: JUCE's VST3 wrapper on Linux runs off its descriptors), and the loop made 1314 descriptor calls in 8 s before a clean teardown; the screenshot shows the live editor, the same Galactic interface as through CLAP. Spike B's question is answered on Linux: formwav's native side can load, set up, process and show the editor of a real third-party plugin in both formats.

### spikes/audio · native audio output through cpal, formwav's own mixer in the callback (owner decision v1.19.0)
- refers-to: spikes/audio/src/main.rs :: `list`, `play`; spikes/audio/Cargo.toml (cpal 0.18, formwav-dsp by path, the opt-in `asio` feature)
- kind: warning-context
- logged: v1.27.0 (in progress) · 2026-10-02

The owner chose native I/O through a permissive library with ASIO opt-in. cpal 0.18.2 (Apache-2.0, checked on crates.io: hosts for ALSA, PipeWire, PulseAudio, JACK, CoreAudio, WASAPI, ASIO and a null host; ASIO only through its `asio` feature and asio-sys on Windows) opens the device, and formwav-dsp's Player, the mixer the browser runs as WebAssembly, renders into its callback: `fwaudio list` names hosts and output devices, `fwaudio play` plays a looped 1 kHz clip through the Player and reports callbacks, frames per callback, the gaps between them, the render time against its budget and stream errors. The `asio` feature maps to cpal/asio, needs Steinberg's SDK at build time, and is not built here (Windows only). Verified in the container (ALSA, no sound card): the only device is ALSA's null device (48 kHz, stereo, f32); 3 s through it gave 83130 callbacks of 240 frames (a 5 ms budget each), the Player's render 0.035 ms on average and 0.44 ms at most in a debug build, no stream errors, and the stream's peak 0.2500, the tone's -12 dBFS exactly; the default device was refused as unavailable. The null device takes samples as fast as they come (about 139 times real time), so the gaps say nothing about real-time behaviour: callback regularity, underruns and the latency on real interfaces are the owner's to run (`fwaudio play 10` on each machine).

### native/formwav-host, app/services/plugins.py, effects.py, routers/media.py · third-party plugins as effects (PT-23, AU-27, RX-35)
- refers-to: native/formwav-host (spike B's host, moved from spikes/host) :: src/offline.rs `scan`, `process`, `default_dirs`, `clap_binary`; src/wav.rs `read`, `write`; src/main.rs `scan` and `process` subcommands; app/services/plugins.py :: `host_binary`, `scan`, `catalogue_group`, `apply`; app/services/effects.py :: `catalogue`, `apply` (the plugin branch); app/routers/media.py :: `GET /api/plugins`
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

Plugins run in their own process, never inside the engine or the native core: third-party plugins crash, and a crash must cost one job, not the session; and the desktop's playback is still the webview, so the first use is offline, a plugin applied to a clip or a range into new media, as Audacity applies its effects. Spike B's host became native/formwav-host (a git move) and gained `scan` (the system's plugin folders: ~/.clap, /usr/lib/clap, ~/.vst3 and the like on Linux; ~/Library and /Library/Audio/Plug-Ins/CLAP and VST3 on macOS; the Common Files folders on Windows; then FORMWAV_PLUGIN_PATH; bundles resolved to their binary) and `process` (a WAV through the first audio effect of a CLAP or VST3, 512-frame blocks with the clock advancing, VST3 in offline mode, an optional silent tail, written as float WAV). The engine lists the scan as the catalogue's "Plugins" group, `plugin:<format>:<path>` with one control (Tail, seconds), so the Inspector, ranges, the agent and the MCP server reach plugins as they reach any effect; it loads only a plugin the scan found, since loading a library runs its code. Verified: the host scanned a test folder (the fixture CLAP, Airwindows Consolidated as CLAP and VST3); processed a real 3 s phrase through the fixture bit-exactly x0.5 on both sides, and through Airwindows in both formats with a 2 s tail (the reverb ringing out, every sample finite, the formats within 0.1 dB); through the engine, GET /api/plugins and the catalogue listed the three, the fixture applied as an effect gave exactly 0.5 times the source, Airwindows' VST3 with a 2 s tail gave the source's length plus 2 s, and libc.so.6, not found by the scan, was refused with a 422. A first check read the output wrongly (a quick reader mistook the source's extensible float format for 16-bit PCM); the host's reader was right, and the check was corrected. Stated: plugin latency is not compensated yet (a lookahead plugin would shift its output), no parameters beyond the tail (AU-29's generated controls are next), and the desktop app does not yet bundle the host.

### requirements.txt, requirements_macos.txt · numpy, missing since it became a core dependency (owner's crash report)
- refers-to: requirements.txt, requirements_macos.txt
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

The owner's engine died at start on macOS with ModuleNotFoundError: numpy. Six core services import numpy at load (audacity, eqmatch, key, library, samaudio, tempo), and neither requirement file listed it; the build container's venv had numpy from other installs, so no test here could see it. Both files now list it (pinned 2.5.2 in requirements.txt, unpinned in requirements_macos.txt). soundfile is imported at load only by the optional voice runtime, which main.py guards. Verified from scratch: a new venv from the previous requirements.txt reproduced the owner's error exactly; new venvs from both corrected files import the engine; and the engine run from the macOS file's unpinned install (FastAPI 0.142.2, Starlette 1.7.0, uvicorn 0.54.0, newer than the pinned set by a Starlette major version) answered /api/health, /api/effects, /api/projects, /api/media, /api/plugins and /api/providers with 200 and held the lockdown (a change without the header 403). The release gate now builds these venvs fresh rather than trusting the dev venv.

### native/formwav-host/src/offline.rs, fixtures/clap-gain · plugin latency compensation
- refers-to: native/formwav-host/src/offline.rs :: `clap_process`, `vst3_process` (the latency read, the padded input, the scratch output); fixtures/clap-gain/src/lib.rs :: FORMWAV_TEST_LATENCY, the delay lines, the latency extension
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

A plugin that reports latency (lookahead limiters, linear-phase filters) outputs that much later, so an applied plugin shifted the audio out of line with the rest of the session. The host now reads the latency after the plugin starts (CLAP's latency extension; VST3's getLatencySamples once processing is on), runs that many frames of silence past the end, and takes the output from that point. The test fixture gained an opt-in declared latency (FORMWAV_TEST_LATENCY=n delays its output by n and reports n; unset it has none, so every earlier check of it still holds). Verified: the fixture really delays (the uncompensated diagnostic's first 4800-frame block read -21.09 dB RMS with 64 samples of latency against -21.03 without, the predicted difference of 64 silent samples); the compensated output with latency 64 and with none was, both times, exactly 0.5 times the input, sample for sample at full length. A first run passed falsely: the fixture had failed to compile, so the old fixture (no latency) was tested; the build is now checked before any result is read, and the delay itself was measured before the alignment was trusted.

### oc_install, build_macos_app, src-tauri, native/formwav-host · the plugin host shipped: dev mode and the desktop app
- refers-to: backend/oc_install (cargo build --release of native/formwav-host); build_macos_app (builds fwhost, places binaries/fwhost-<triple>); src-tauri/tauri.conf.json (externalBin gains binaries/fwhost); src-tauri/src/main.rs (FORMWAV_HOST_BIN, beside the executable, given to the engine); native/formwav-host/src/main.rs :: `vst3_binary` (macOS's Contents/MacOS)
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

The engine finds the plugin host through FORMWAV_HOST_BIN or the repository's build; neither existed on the owner's machine. oc_install now builds it after the native core (Rust is already required there), and the desktop app bundles it as a second sidecar: Tauri places bundled binaries beside the app's executable (Contents/MacOS on macOS), so the shell passes that path to the engine. Verified: the host's release build; the shell's locked cargo check with both sidecars declared; both scripts parse; with the repository's build moved aside, an engine given only FORMWAV_HOST_BIN (a copy in a directory of its own) listed the three test plugins and applied the fixture. Stated, not done: VST3 on macOS. vst3_binary now finds the binary in Contents/MacOS so a scan lists such plugins, but macOS VST3 modules expect bundleEntry with a CFBundleRef before their factory, which fwhost does not yet call; CLAP plugins on macOS need nothing more (clap_binary already resolves the bundle). fwhost uses libloading's unix module, so it does not build on Windows yet. During the test a pgrep in the same command as an engine start matched that command's own shell and killed it, leaving the host's build moved aside; it was restored, and engine starts and process matches now run in separate commands.

### native/formwav-host/src/params.rs, offline.rs, main.rs · plugin parameters listed and carried into processing (AU-29, host side); a plugin on a range (RX-35)
- refers-to: native/formwav-host/src/params.rs :: `list`, `to_json`, `parse_values`, `ClapEvents`, `Vst3Changes`, `Vst3Queue`; offline.rs :: `process(.., values)`, the CLAP input events and the VST3 inputParameterChanges, both in the first block only; main.rs :: `fwhost params <format> <plugin>`, `fwhost process .. [tail] [values]`
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

For generated controls (a plugin with no interface of its own gets formwav's), the host lists a plugin's parameters (CLAP's params extension; VST3's edit controller, which for JUCE plugins must first be connected to the component through IConnectionPoint or it reports none) leaving out hidden, read-only and VST3 bypass parameters, VST3 values normalized 0 to 1 as VST3 defines them; and `process` takes chosen values as a flat {"id": value} object, delivered at sample 0 of the first block (CLAP param-value events; VST3 IParameterChanges with one single-point queue per value, two small COM classes). Verified on Airwindows Consolidated: CLAP listed 14 parameters (Replace, Brightness, Detune, Bigness, Dry/Wet, then unused slots), VST3 13 once connected (none before); its default effect differed from the dry input by +0.6 dB relative (a different signal, the reverb), and with Dry/Wet sent as 0 by -143.7 dB relative (the input exactly, but for Airwindows' floating-point dither), identically in both formats. The fixture, which has no parameters, lists none. Also verified this turn (RX-35): a plugin applied to a 1 s range inside a 3 s clip from the Inspector split the clip into the original before, the plugin's output from 1 s to 2 s (sourceIn 48000, so aligned), and the original after.

### app/services/plugins.py, routers/media.py · a plugin's parameters as controls, and its chosen values applied (AU-29, engine side)
- refers-to: app/services/plugins.py :: `_installed`, `params`, `apply` (values); app/routers/media.py :: `GET /api/plugins/params?name=`
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

A plugin's parameters become effect controls (ids p<id>, beside Tail, at most 64, stepped parameters given a step), listed by the host the first time they are asked for and kept, never during a scan (that would instantiate every installed plugin before the catalogue could load); applying passes the chosen p<id> values to the host. The guard that only a scanned plugin is ever loaded is one function now, used by both. Verified through the engine on Airwindows Consolidated: CLAP 14 controls and VST3 13, named as the plugin names them; applied at the default the output differed from the source by +0.6 and +0.7 dB relative (the reverb), and with its Dry/Wet control at 0 by -143.7 dB (the source, but for the plugin's dither), in both formats; an unscanned library refused with 404. Found on the way: the engine prefers the host's release build, which was stale (built before `params` existed) and answered with an error, which the first version cached as an empty list, so a plugin's controls would have stayed missing until a restart; a failed listing is no longer kept, and the release build was rebuilt.

### native/formwav-host/src/mac.rs, offline.rs · VST3 on macOS: the module loaded as a bundle (bundleEntry)
- refers-to: native/formwav-host/src/mac.rs :: `Bundle` (CFBundleCreate, CFBundleLoadExecutable, CFBundleGetFunctionPointerForName, CFRelease); offline.rs :: `Vst3Module`, the macOS `vst3_open` and `vst3_close`; main.rs :: `mod mac` (macOS only)
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

macOS VST3 modules are bundles that expect bundleEntry with their CFBundleRef before GetPluginFactory, which fwhost did not call, so VST3 plugins listed on the owner's Mac but could not load. On macOS the module is now loaded the way the VST3 SDK's Mac module loads it: the CFBundle created from the .vst3 path and its executable loaded, bundleEntry called with the bundle, the factory taken, and bundleExit called and the bundle released on the way out; CoreFoundation's few functions are declared in mac.rs (a system framework, no new crate). A per-system Vst3Module type keeps the Linux path exactly as tested and leaves the parameter and processing code unchanged. Verified as far as this container allows: Rust's macOS target installed and `cargo check --target x86_64-apple-darwin` passes with no warnings (the macOS code type-checks against its own declarations); the Linux build is unchanged in behaviour (Airwindows Consolidated's VST3 still lists 13 parameters and still renders dry within -143.7 dB with Dry/Wet at 0). Not verified: running it. Type-checking proves the code compiles for macOS, not that a real plugin loads; the first run on the owner's Mac is the test (a VST3 in ~/Library/Audio/Plug-Ins/VST3 appearing under Plugins and applying to a clip).

### native/formwav-dsp/src/native.rs, python.rs · native audio output in the core (feature "native"), driven by the worklet's messages
- refers-to: native/formwav-dsp/src/native.rs :: `NativeOutput` (open, load_source, set_mix, seek, set_loop, play, stop, report), `devices`; src/python.rs :: the `NativeOutput` class (load_wav, set_mix, transport, report, close, devices); Cargo.toml :: the `native` feature (cpal 0.18, serde, serde_json, all optional); pyproject.toml :: maturin builds with python and native
- kind: warning-context
- logged: v1.30.0 (in progress) · 2026-10-02

Native output lives in the engine's native module, not in the Tauri shell: one implementation then serves dev mode (browser and engine) and the desktop app (the frozen engine), and the interface reaches it the way it reaches the engine. It runs formwav's own Player, the mixer the browser runs as WebAssembly, configured by the worklet's "clips" message (parsed in Rust with serde, one mapping from message to mixer) and reporting the worklet's "position" message with the same keys, so the interface can drive either alike. The cpal stream lives on its own thread (it may not move between threads on CoreAudio); the Python object holds the shared mixer state and a stop channel; the audio callback never waits (try_lock, a block of silence if the state is being changed) and stops at the mix's end. Sources load from WAV bytes through the core's own decoder, the engine's media being WAV. The wasm build carries none of it (the feature is off there). Verified: the core type-checks with python and native and still builds for wasm32 without features; the default maturin build now carries NativeOutput (the first attempt passed --features native, which maturin used instead of the pyproject's features, not in addition); from Python on ALSA's null device it listed the device, opened at 48 kHz, loaded the phrase from its WAV bytes, took a one-clip mix in the worklet's format, sat at 0 before play, ran to the end and stopped itself, and reported a peak of 0.6286, the phrase file's own peak exactly; a malformed mix, a closed output and an unknown device were refused with messages; the core's tests pass locked. Not yet: the engine's service and WebSocket, the interface's native mode, speed and the time track (the worklet's), and pacing, which the null device cannot show. Linux builds now need ALSA's development files (libasound2-dev) for the engine's module; macOS and Windows need nothing extra.

### app/routers/native_audio.py, core/security.py, routers/terminal.py · native output over a WebSocket speaking the worklet's protocol
- refers-to: app/routers/native_audio.py :: `GET /api/audio/devices`, `WS /api/audio/native`; app/core/security.py :: `ws_allowed` (moved from the terminal router); app/routers/terminal.py :: `_allowed` now delegates to it; app/main.py :: the router included
- kind: warning-context
- logged: v1.30.0 (in progress) · 2026-10-02

The engine serves the core's NativeOutput over a WebSocket that speaks the worklet's protocol, so the interface can drive native output with the messages it already sends the worklet and read back the worklet's own position report (about 30 a second). "open" picks the device and rate (one output per connection, stopped and closed when the connection ends, so a closed tab never holds the device); "source" names a media id and the engine reads its own store (skipping a source number already holding that media; decoded off the event loop). Speed other than 1x is refused with a reason (it stays the worklet's). The WebSocket origin check, which guards the terminal too, is now one function in the security module rather than a private copy per router. Verified with a websockets client: a hostile origin refused at the handshake; play before open refused; the null device opened at 48 kHz and reported ready; the phrase loaded by media id; an invalid media id refused with its reason; the worklet-format mix played to the end in reports carrying the worklet's keys, peak 0.6286 (the file's own); speed 2x refused with a reason; the terminal still accepted the dev origin after the refactor. Asking for the default device failed here, as this container has no default output; that is the case on the owner's machine that should simply work.

### native/formwav-dsp/src/synth.rs, app/services/midi.py, app/routers/midi.py · note tracks' foundation: the built-in instrument and MIDI files (AU-37, PT-14)
- refers-to: native/formwav-dsp/src/synth.rs :: `render`, `Patch`, `Note`, `Wave`, `hz`, its three tests; src/python.rs :: `render_notes`; app/services/midi.py :: `read` (SMF formats 0 and 1); app/routers/midi.py :: `POST /api/midi/import`, `POST /api/midi/render`; app/main.py
- kind: warning-context
- logged: v1.31.0 (in progress) · 2026-10-02

Phase 8 begins with note tracks that play through the mixer unchanged: a note clip's notes stay the truth in the document, and the built-in instrument renders them into media the mixer plays like any audio (browser and native output alike), rendered again after an edit; realtime synthesis in the mixer, needed for live input and instrument plugins, comes later. The instrument is a polyphonic synthesizer in the core: per note an oscillator (sine, triangle, or saw and square band-limited with polyBLEP) under an ADSR envelope, scaled by velocity, equal temperament with A4 at 440 Hz, the release running past each note. The engine reads Standard MIDI Files (formats 0 and 1) written from the format itself: running status, fixed channel message lengths, meta and SysEx skipped by length, the tempo map turning ticks into seconds, note-on at velocity 0 as note-off, overlapping repeats of a pitch closed first in, first out, SMPTE division refused with its reason. Verified: the core's 11 tests pass (the synth's: A4 measures 440 Hz, the release sounds past the note and ends silent, velocity 64 is 64/127 of full level) and the wasm build is unaffected; from Python a saw A4's strongest partial is 440.0 Hz and an unknown waveform is refused; a MIDI file built by hand (a tempo change from 120 to 60 BPM, running status, a velocity-0 note-off, a text meta event and a SysEx) imported through the engine as A4 at 0 s for 0.5 s, C5 at 0.5 s for 0.5 s and E5 at 3.0 s for 1.0 s with their velocities, rendered to 4.2 s of stereo media whose strongest partials at those times are 440.0, 523.3 and 660.0 Hz; a non-MIDI file refused (422). Next: note tracks in the interface (import, drawing the notes, playing), then the piano-roll editor.

### app/services/tools.py, effects.py, routers/media.py · tone waveforms and amplitude (AU-B05); Normalize's DC and per-channel options (AU-B11)
- refers-to: app/services/tools.py :: `_tone`, `WAVEFORMS`, `generate` (waveform, amplitude); app/routers/media.py :: `POST /api/generate` (waveform, amplitude); app/services/effects.py :: `_peak_normalize` (a numpy effect now), the peak-normalize controls (dc, independent), `_values` and `_controls` accepting a step after the unit; frontend src/ui/media-pane.ts :: Wave and Level for a tone
- kind: explainer
- logged: v1.34.0 (in progress) · 2026-10-02

AU-B05's gap: the tone was ffmpeg's sine at a fixed level. It is now sine, square, sawtooth or triangle at an amplitude from 0 to 1, the non-sine waves band-limited: one cycle summed from the harmonics below Nyquist (square odd at 1/n, sawtooth all at 1/n, triangle odd at 1/n squared alternating), scaled to its peak and read by phase, so a high tone has no aliases at any length. AU-B11's gap: Audacity's Normalize removes DC offset and can normalize stereo channels independently; Peak normalize is now a numpy effect doing both on request (each channel's mean subtracted; the peak to the target together, balance kept, or each channel on its own), the old ffmpeg special case removed as unreachable, and its two options 0-or-1 controls with a whole step. Verified through the engine: at 1 kHz the square's harmonics 1 to 5 read 1, 0, 0.333, 0, 0.2, the sawtooth's 1, 0.5, 0.333, 0.25, 0.2, the triangle's 1, 0, 0.111, 0, 0.04, each peak exactly the amplitude asked (0.5; a sine at 0.25 peaked at 0.25); a 7 kHz square held its 7 and 21 kHz harmonics with no other energy above -143.4 dB (no aliasing); an unknown waveform refused; on a stereo clip with +0.2 DC on the left and the right at half level, normalizing to -1 dBFS together kept the balance (-1.00 and -11.46) and the DC, Remove DC brought both means to 0.0000 (-1.00 and -7.02), and Remove DC with Each channel gave -1.00 on both; the catalogue gives dc and independent a step of 1; the audits clean before committing.

### app/routers/render.py, frontend src/ui/export.ts · each platform's loudness normalization in the streaming preview (RX-44)
- refers-to: app/routers/render.py :: `PLATFORMS`, `_platform_gain`, the preview branch (platform); frontend src/ui/export.ts :: the Platform loudness menu and its notice
- kind: warning-context
- logged: v1.34.0 (in progress) · 2026-10-02

The streaming preview encoded and decoded the mix but did not play it at the level a platform would. A chosen platform now measures the decoded preview (ffmpeg's ebur128 with true peak) and applies that platform's gain: Spotify (Normal), from its own support article, -14 LUFS (ITU-R BS.1770), louder masters turned down and softer ones lifted only until their true peak reaches -1 dBTP (its example: -20 LUFS at -5 dBTP lifted to -16); YouTube, -14 LUFS, turned down only, never lifted (several independent sources agree); Apple Music (Sound Check), -16 LUFS, which sources disagree on lifting, so it is modelled as turning down only and the menu says so. The response and notice report the measured loudness, true peak and gain. Verified through the render route with MP3 previews, each result re-measured independently with ebur128: a -6 LUFS mix played at -14.0 LUFS for Spotify and YouTube (-8.00 dB) and -16.0 for Apple Music (-10.00 dB); a -29.5 LUFS mix with clicks at -1.7 dBTP (the codec had lifted them from -2) was lifted by Spotify only +0.70 dB, its true peak landing at -1.0 dBTP exactly, and left alone by YouTube and Apple Music; the audits clean before committing.

### app/services/effects.py · Paulstretch at any factor with a time resolution (AU-B13); Center extract and remove with an amount (RX-04)
- refers-to: app/services/effects.py :: `_paulstretch` (a numpy effect), its PARAMS (factor, resolution), its chain entry, RETIMING, the catalogue; PARAMS for center-extract and center-remove (amount)
- kind: explainer
- logged: v1.37.0 (in progress) · 2026-10-02

Extreme stretch ran rubberband at 1.5 to 10 times, which keeps transients and has no time resolution; Paulstretch is now its own effect, written from the published algorithm (Nasca's; no code taken): windows of `resolution` seconds read at 1/factor of the output's pace, magnitudes kept and phases randomised with one set shared by all channels, overlap-added at a quarter window with Hann windows, normalised for the overlap and to the source's level, seeded so the same input gives the same output, output kept under ten minutes; factors run from 1 to 100 and the resolution from 0.02 to 2 s. Center extract and remove gained an amount, the processed channels blended with the untouched ones, 100% being the fixed chain each replaced. Verified through the engine: a 2 s 440 Hz sine stretched 8 times stored exactly 768000 frames whose strongest partial is 440.2 Hz and whose RMS equals the source's (0.2121); two runs identical; 1 time kept the length; a 50 ms burst stretched 4 times kept 100% of its energy within 0.25 s of its centre at a 0.05 s resolution and 21% at 1 s (the smearing the row names); a left-only source stayed left-only (the right exactly 0); 10 s at 100 times refused with its reason; on a centre 300 Hz and side 700 Hz test, Center remove at 0, 50 and 100% left the left channel's centre at 1.0, 0.5 and 0.0 and the side at 1.0, 1.5 and 2.0 (100% the old chain), and Center extract at 50 and 100% left the side at 0.5 and 0.0 with the centre at 1.0. The first length reading said 480000 frames: the PCM endpoint previews at most 10 s; the stored media and the full WAV were read instead. The first run also failed outright: a numpy effect needs an entry in the chain table, as Peak normalize has.

### native/formwav-dsp/src/render.rs, fx.rs · effect parameter automation in the core (PT-19, first part)
- refers-to: native/formwav-dsp/src/fx.rs :: `Biquad::retune`; src/render.rs :: `clip_fx_spec`, `clip_fx_auto`, `add_clip_fx_auto`, `mix_one` (the retune every 32 samples), the test `an_automated_cutoff_opens_the_filter_over_time`
- kind: warning-context
- logged: v1.38.0 (in progress) · 2026-10-02

A track's realtime effects play as each clip's chain of biquads, each designed once with fixed parameters, so automating one has to happen in the core both players share: each clip stage's design (kind, frequency, gain, Q) is now kept beside its filter, `add_clip_fx_auto(stage, param, envelope)` attaches an envelope (natural units: Hz, dB, Q) to one parameter of a stage of the latest clip, and every 32 samples (0.67 ms at 48 kHz) `mix_one` redesigns each automated stage at its parameters' current values and retunes the filter, keeping its state so the change does not click. The bindings (wasm, native output, the Python render), the document, both mix builders and an automation row for effect parameters follow. Verified in the core's tests (12 pass): a 4 kHz tone through a low-pass whose cutoff runs from 200 Hz to 12 kHz over a second passes almost whole late in the sweep (RMS 0.352 of an unfiltered 0.354) and, early (0.05 to 0.15 s, the cutoff about 790 to 1970 Hz), at the level of a fixed filter at the envelope's mean there (1385 Hz), so the filter follows the envelope; the same filter without automation keeps the tone cut throughout; automation of a missing stage, an unknown parameter or envelope is refused; the python, native and wasm builds compile. The test's first threshold (10 times quieter early) was wrong, not the code: by 0.05 s the cutoff has passed 790 Hz, where a two-pole low-pass passes a 4 kHz tone at about an eighth.

### effect parameter automation through every path (PT-19, second part)
- refers-to: native/formwav-dsp/src/wasm.rs :: `fw_add_clip_fx_auto`; src/native.rs :: `MixClip.fx_auto`, `FxAuto`; src/python.rs :: `render` (fx_auto); backend app/services/render.py :: `plan` (auto_envs, fx_auto), `render`; frontend src/engine/document.ts :: `FilterFx.automation`, `cleanFx` (keeps it), `set-fx-automation`; src/audio/player.ts :: `flatFxAuto`, the clip message's `fxAuto`; src/audio/player-worklet.ts :: `fxAuto`, the attachment
- kind: warning-context
- logged: v1.38.0 (in progress) · 2026-10-02

A filter's automation lives on the effect (`automation.freq`, `.gain`, `.q`, session frames to Hz, dB or Q) and reaches the core along every path the clip's stages take: the browser worklet and the native output both read the clip message's `fxAuto` (stage, parameter, points) and attach an envelope after the clip's stages, and the export's plan numbers the stages the same way (bypassed, unknown and compressor entries skipped, as flatFxAuto does), registers each automation once per track and passes (clip, stage, parameter, envelope) to the core's render. Two things found on the way: `cleanFx` rebuilt each filter from known fields and would have dropped the automation at the next effect edit, so it now keeps it (sorted, each value clamped like its static one); and a track whose chain moves onto its own bus for a compressor leaves its automation unplayed, since bus chains are not automated yet (noted in the builder). Verified with a 2 s 4 kHz tone on a track with a low-pass: at a fixed 200 Hz the export and the browser's bounce both read 0.0008 early and late, identical to the sample over 96000 samples; with the cutoff automated from 200 Hz to 12 kHz both read 0.0149 early and 0.3521 late (the unfiltered tone 0.354), again identical to the sample; the automation survived an edit of the effect's Q; two undos removed it; the core's 12 tests pass; no page errors.

### app/services/tools.py, effects.py, routers/media.py, frontend src/ui/media-pane.ts · crest and dynamic range (RX-50), downmix to mono (RX-30), dither to any depth (RX-18), sweeps with level (RX-39)
- refers-to: app/services/tools.py :: `stats` (crestFactor, dynamicRangeDb), `generate` (the chirp branch: freq_end, curve, amplitude); app/services/effects.py :: `_downmix_mono`, the dither PARAMS and chain builder; app/routers/media.py :: `POST /api/generate`; frontend src/ui/media-pane.ts :: the sweep's fields
- kind: warning-context
- logged: v1.39.0 (in progress) · 2026-10-02

RX-50: the Inspector already had Crest factor and Dynamic range rows, but they were always empty: ffmpeg's astats gives those per channel only, never in the overall block the parser reads; both are now measured from the samples (peak over RMS across every channel; the loudest less the quietest non-silent 50 ms RMS window, Audition's definition). RX-30: Downmix to mono makes a one-channel clip, the mean of the channels. RX-18: dither takes a bit depth from 8 to 24 and noise shaping on or off; ffmpeg dithers with shaping only to its integer formats, so the signal is scaled by an exact power of two around it (2^(N - 16) at 16 bits, 2^(N - 32) at 32), landing the grid on 2^-(N - 1), 16 bits shaped being the old chain. RX-39: the sweep generator takes a start and end frequency, a linear or logarithmic curve and a level, its phase in closed form. Verified through the engine: a 0.5 sine's crest factor 1.414 and dynamic range 0.0, a second at 0.5 then at 0.05 20.0 dB, and the Inspector shows Crest factor 1.41 and Dynamic range 0.0 dB beside Peak -6.02 and RMS -9.03; a 0.4 and 0.2 stereo pair downmixed to one channel peaking at 0.3000; dither at 8, 16 and 24 bits left every sample exactly on that grid, and at 12 bits shaped noise read 45.2 dB higher at 16 to 20 kHz than at 2 to 6 kHz against 0.2 dB unshaped; log and linear sweeps from 100 Hz to 10 kHz read 1000 and 5050 Hz at their midpoint, peaking at the 0.400 asked; the audits clean before committing.

### app/services/effects.py, tools.py, frontend src/ui/inspector-pane.ts · phase rotation by any angle with Find the angle (RX-34); maximum and minimum RMS and an RMS histogram (AA-04)
- refers-to: app/services/effects.py :: `_phase_rotate` (a numpy effect; the chain entry now empty), its PARAMS (angle, auto); app/services/tools.py :: `stats` (maxRmsDb, minRmsDb, rmsHistogram); frontend src/ui/inspector-pane.ts :: the two RMS rows and the histogram; src/styles/frame.css :: `.fw-rms-hist`
- kind: explainer
- logged: v1.40.0 (in progress) · 2026-10-02

Phase rotation was ffmpeg's all-pass approximation fixed at a quarter-turn. It now turns every frequency by any angle exactly, x cos(a) - H(x) sin(a) with the Hilbert transform taken through the FFT, so the magnitude spectrum is unchanged; Find the angle measures the lowest-peak rotation from -90 to 90 degrees (a and a + 180 differ only in polarity), checking only the samples whose analytic magnitude could hold the peak and falling back to all of them when that bound fails, and names it in the result. The statistics add Audition's maximum and minimum RMS (50 ms windows) and an RMS histogram in 3 dB bins from -60 to 0 dBFS, drawn in the Inspector. Verified: 90 degrees turned a 1 kHz sine into the cosine within 1.76e-08; Find the angle took a waveform peaking +0.330 and -0.650 to +0.564 and -0.564 at -90 degrees (1.2 dB of headroom), its magnitude spectrum unchanged within 1.1e-08; a second at 0.5 then at 0.05 read maximum RMS -9.03 and minimum -29.03 dBFS with 20 windows in each of the -12 and -30 dBFS bins, and the Inspector showed those rows and two full bars; the audits clean before committing.

### app/services/effects.py · De-plosive and De-wind with detection (RX-11, RX-14)
- refers-to: app/services/effects.py :: `_chain_array`, `_low_burst_gate`, `_de_plosive`, `_de_wind` (numpy effects now; their chain entries kept, so De-wind stays in the noise-learning set), the Detect controls
- kind: explainer
- logged: v1.41.0 (in progress) · 2026-10-02

Both were fixed filters over the whole clip, so clean low end between plosives or gusts was cut as hard as the bursts. Each now runs its own chain over the clip as the wet signal (the old effect exactly) and, with Detect on, blends it in only where a gate opens: the band below the cutoff (through the FFT, since there is no filter library) in 10 ms frames against its running one-second median, open 15 dB above it for plosives (held 30 ms) and 10 dB for gusts (held 150 ms), above -60 dBFS, with 10 ms ramps. Detect is off by default, the old behaviour. Verified through the engine: De-plosive at 300 Hz with Detect off cut a 100 Hz tone 19.1 dB, as recorded before; on a clip of a 1 kHz tone, a steady 80 Hz tone and two low bursts, De-plosive cut a 40 ms burst's low band from -9.8 to -21.9 dB with Detect on while the 80 Hz tone between bursts stayed 0.0800 (Detect off took it to 0.0431), and De-wind cut a 300 ms gust from -12.6 to -34.3 dB with the 80 Hz tone left at 0.0800 (0.0212 with Detect off); the 1 kHz tone untouched throughout. The first run of the helper would have failed: this module imports os and tempfile locally, so the helper imports them itself.

### app/routers/presets.py, frontend src/ui/inspector-pane.ts, src/io/presets-client.ts · module chains saved as presets (RX-55; interface not yet verified)
- refers-to: app/routers/presets.py :: `_clean` (a chain preset's validated steps); frontend src/io/presets-client.ts :: `Preset.steps`; src/ui/inspector-pane.ts :: Save chain, the Saved chains menu (filled through the DOM when opened), loading a chain
- kind: warning-context
- logged: v1.41.0 (in progress) · 2026-10-02

A module chain is saved as a preset with effect "chain" and its steps in order, each an effect, a label and named numbers (1 to 16 steps, the same rules as a preset's settings); Save chain asks for a name as an effect preset does, and the Saved chains menu loads one into the chain, replacing it. Verified through the engine: a two-step chain preset (Amplify at 6 dB, Invert) stored and read back with its steps; steps on an ordinary effect refused with 422. Not yet verified: the interface's save, clear and load in the browser (the dev server had stopped when the test ran); RX-55 stays partial until that passes. The interface builds and type-checks.

### module chains saved as presets, the interface verified (RX-55)
- refers-to: frontend src/ui/inspector-pane.ts :: Save chain, the Saved chains menu, loading; app/routers/presets.py :: `_clean`
- kind: explainer
- logged: v1.41.0 (in progress) · 2026-10-02

The browser test the previous entry left pending, run with the dev server up: in Chromium at 1288 by 683 a chain of Amplify (6 dB) and Invert was saved as "Voice cleanup" through the name prompt, cleared (no steps), found in the Saved chains menu and loaded back with both steps; applied, the loaded chain gave output over input of -1.9953 (+6.00 dB, inverted) with a residual of 2.77e-08, so the steps kept their settings; no page errors.

### app/services/effects.py, tools.py, routers/render.py, media.py · a batch of repair rows (RX-02, AU-B14, RX-03, RX-10, RX-09, RX-41, RX-29; RX-22's engine side)
- refers-to: app/services/effects.py :: `_stft_map` (exact overlap-add), `_azimuth_measured`, `_dc_measured`, `_breath_control`, `_de_hum_adaptive`, `_de_ess_spectral`, `_spectral_recovery` (new effect ids, so the existing ones keep their measurements), their PARAMS, chain entries and catalogue; app/services/tools.py :: `find_similar`; app/routers/media.py :: `GET /api/media/{id}/similar`; app/routers/render.py :: `_with_cues` (a WAV mix's cue points)
- kind: explainer
- logged: v1.42.0 (in progress) · 2026-10-02

Seven gaps closed in one batch and an eighth's engine side, each measured on a signal with a known answer: Azimuth (measured) found a right channel 0.7 times as loud and 63 samples late and lined it up (|L - R| 1.8e-04 on noise); DC offset (measured) left a mean of 2.4e-09 with a 20 Hz component intact to 2e-08; Breath control took noise-like breaths between phrases from -33.9 to -53.9 dB (the 20 dB asked) with the phrases at -17.30 unchanged; De-hum (adaptive) followed hum drifting from 49 to 51 Hz with four harmonics, 24 dB down with a 62 Hz tone 12 Hz away kept within 0.45 dB (its first notches, 0.8 of a bin, took only 14 dB, being narrower than the window's leakage); De-ess (spectral) lowered 5 to 8 kHz bursts by the 12 dB maximum while a quiet steady 6 kHz tone between them and a 300 Hz vowel stayed exactly as they were; Spectral recovery rebuilt an absent 8 to 16 kHz band to -38 dB from the octave below with nothing under 7.8 kHz changed (4e-06); a WAV mix carries the session's markers and regions as cue points (Intro at 48000, Chorus at 96000 with its 48000-frame length, the RIFF size right); and Find similar located a chirp's other two occurrences (0.491, 1.696 and 3.093 s against 0.5, 1.7 and 3.1) and neither decoy, with RX-22 left partial until the interface can select what it finds. Two of the test's own faults, not the effects': a breath placed with an off-by-one slice, and a hum measurement that subtracted a tone outside its band.

### spectral repair's replace and fill gaps (RX-42); multichannel channel order (AU-50); built-in multi-step commands (PT-21); a batch queue of files (AP-03, RX-52)
- refers-to: app/services/effects.py :: `_spectral_repair`; app/routers/render.py :: the channels parameter; app/routers/media.py :: `POST /api/batch`; frontend src/io/render-client.ts, src/ui/export.ts :: Channel order; src/ui/inspector-pane.ts :: BUILT_IN_CHAINS in the Saved chains menu, Run chain on files, syncBand and ownBand for spectral repair
- kind: warning-context
- logged: v1.43.0 (in progress) · 2026-10-02

Spectral repair rebuilds a drawn time and frequency region (Replace), or a dropout across the whole band (Fill gaps), from the clean frames either side, magnitudes interpolated and each bin's phase advanced at its own measured rate, at one FFT size or three averaged (multi-resolution); a multichannel export takes its channels by track number; four built-in chains of formwav's own effects sit above the user's in the Saved chains menu; and a chain runs over files from the computer outside the session, the results a zip. Verified: Replace over a click on a 1 kHz tone took the region's error from -7.1 dB to -95.7 (multi), -86.2 (512), -129.6 (2048) and -164.8 dB (8192), with nothing changed before it (1.2e-08), and Fill gaps bridged a 20 ms dropout to -149.6 dB; the first version barely improved on attenuation (-12.6 dB) because its reference frames overlapped the click and its phases assumed bin-centred tones, both fixed. A multichannel export ordered 3,1,1 carried 800, 200 and 200 Hz and track 4 of 3 was refused; two files through Amplify -6 dB and Invert came back at -0.5012 each (residuals under 1e-08), and in Chromium Run chain on files downloaded batch.zip with both; the built-in Tidy a master took a clip with a DC offset to a mean of -5.7e-09 and a -1.00 dBFS peak; the Channel order field shows only for multichannel; no page errors; the audits clean before committing.

### a dialogue leveler holding breaths and sibilance (RX-26); Detect silences as regions (PT-36); three gaps found already closed (AU-11, RX-58, RX-60)
- refers-to: app/services/effects.py :: `_dialogue_leveler`; frontend src/ui/inspector-pane.ts :: Detect silences
- kind: explainer
- logged: v1.44.0 (in progress) · 2026-10-02

Leveler (dialogue) brings each 50 ms of speech toward a target RMS while breaths (noise-like, 10 to 45 dB under the speech) and sibilance (energy mostly above 4 kHz) take the surrounding gain only when it lowers them. Detect silences marks the track's silences over 0.3 s as regions, drawn on the ruler, before anything is stripped or split. Verified: through the engine, a phrase at -30 dB came to -20.0, one at -14 to -20.0 and one at -22 to -20.0 (target -20), while a breath at -40 stayed at -40.2 and a sibilant burst at -25 went to -27.0, neither raised; in Chromium, Detect silences on a tone, a silent second and a tone made one region, Silence 1 from 1.0 to 2.0 s, drawn on the ruler over the silence, and undo took it back. Three COVERAGE gaps were found already closed, with evidence gathered now: a 4-channel file came through Amplify, DC offset (measured), De-ess (spectral), De-hum (adaptive) and Voice de-noise with four channels, each keeping its own tone (RX-58); the home screen's recent sessions show their thumbnails, 320 by 64, on the five saved since thumbnails began (AU-11, done by AU-32's work); and input monitoring through the speakers is AU-21's, measured before and during takes (RX-60).

### a curve editor with a dynamics transfer curve (AU-B06), a filter curve EQ and a 10-band graphic EQ (AU-B07): engine verified in part, the editor not yet
- refers-to: app/services/effects.py :: `GRAPHIC_BANDS`, `_graphic_eq_chain`, `_filter_curve_chain` (above PARAMS), `_dynamics_curve`, their PARAMS, chains and catalogue; frontend src/ui/curve-editor.ts (new), src/ui/inspector-pane.ts :: showControls mounts it; src/styles/frame.css :: `.fw-curve`
- kind: warning-context
- logged: v1.45.0 (in progress) · 2026-10-02

Dynamics curve maps 5 ms RMS levels through five drawn points (unity slope below the first, the last segment's slope above); Filter curve EQ joins six frequency and gain points; Graphic EQ, 10 bands, sets ten octave bands; a canvas curve editor draws the two curve effects over their own point fields and writes dragged points back into them. Verified through the engine: the dynamics curve took a tone at -13 dB RMS to -22.86 (the curve asks -23) and left one at -40 at -40.00; the graphic EQ's 1 kHz band at +12 gave +11.48 dB at 1 kHz with 100 Hz and 8 kHz unchanged. Two faults found on the way, both fixed: the chain builders, wrapped in lambdas, were still called while the module loaded (before they were defined), so the module failed to import and the engine went down on reload, until they were moved above PARAMS; and firequalizer with scale=loglog applied no gain at all (0.00 dB on every band, checked against ffmpeg directly), so the option is dropped. Not verified: the filter curve's result, and the curve editor in the browser (the dev server was down when its test ran), so AU-B06 and AU-B07 stay partial.

### a drawn dialogue contour, and pitch changes on time (RX-17)
- refers-to: app/services/effects.py :: `_dialogue_contour` (the curve), its PARAMS (x1 to x5, c1 to c5), `_rubberband_pitch` (the commands' latency); frontend src/ui/curve-editor.ts :: the dialogue contour kind
- kind: explainer
- logged: v1.47.0 (in progress) · 2026-10-02

Dialogue contour takes a drawn curve, five points of place in the span and semitones, joined linearly and added to its range and ramp, drawn in the curve editor; and every pitch command rubberband receives is now sent 3120 samples later, its latency, which had made changes land early. Measured: a 7-semitone step drawn at 1.000 s on a 220 Hz phrase crossed halfway at 0.935 s before (65 ms early, the row's "about 60 ms") and at 1.000 s after, 220.8 Hz before it and 329.2 after (329.6 asked); pitch correction, which shares the command writer, still took a 450 Hz tone to 440.0 Hz; in Chromium the contour's last point dragged to +5 semitones wrote 5 into its field and, applied, left 1.0 s at 220.0 Hz and gave 253.8 Hz at 1.75 s and 276.2 Hz at 1.9 s (254.2 and 277.2 by the curve); no page errors; the audits clean.

### a drawn, multi-point time track with logarithmic interpolation, and the time track in exports (AU-36): built, the export failing
- refers-to: frontend src/engine/document.ts :: `timeTrackLog`, set-time-track's `log`; src/audio/player-worklet.ts :: `curveAt`'s logarithmic interpolation; src/audio/player.ts; src/ui/inspector-pane.ts :: the time track's drawn curve, Logarithmic, Apply curve; src/ui/curve-editor.ts :: the time-track kind; backend app/services/render.py :: the export's warp
- kind: warning-context
- logged: v1.47.0 (in progress) · 2026-10-02

Playback already took any number of time-track points (the worklet interpolates them); the Inspector now draws five on the curve editor with a Logarithmic choice, the worklet interpolates in the log domain when asked, and the renderer warps the mix as playback reads it (output time the integral of 1 / speed, inverted by interpolation). Not working yet: an export with a time track answered 400 (the error the engine gives is recorded beside this entry's commit), most likely because the core's render returns its samples in a form the warp does not read as numbers. AU-36 stays partial until exports match the integrals (4 ln 2 = 2.773 s for 100 to 200% linear over 4 s, 2.885 s logarithmic) and the drawn curve is checked in the browser.

### the time track's export fixed (AU-36)
- refers-to: app/services/render.py :: the export's warp
- kind: explainer
- logged: v1.47.0 (in progress) · 2026-10-02

The export answered 400 because the core returns its mix as interleaved float32 bytes, which the warp read as a list; it now reads and writes those bytes. Measured on a 4 s tone: no time track 4.000 s; 100 to 200% linear 2.773 s (4 ln 2 = 2.773); logarithmic 2.885 s (4 x 0.5 / ln 2 = 2.885); 100, 200, 100% over three points 2.773 s (2.773). Still to check before AU-36 counts: the curve drawn and applied in the browser (the run was cut short by the engine reloading).

### the heal brush fills a dropout (AA-06)
- refers-to: app/services/effects.py :: `heal_painted` (the dropout test and spectral repair's Replace)
- kind: explainer
- logged: v1.47.0 (in progress) · 2026-10-02

A stroke over a dropout now fills it: when any 5 ms inside the stroke sits 30 dB below the 200 ms around it, the stroke's box is rebuilt by spectral repair's Replace (RX-42: magnitudes interpolated from both sides, each bin's phase carried at its own frequency); anything else is attenuated through the painted mask as before. A box's average would not do: the brush's margins make the stroke wider than the dropout, so the average barely dips. Verified in Chromium on a track's own spectrogram view: a stroke over a 20 ms dropout in a 440 Hz tone took the gap's RMS from 0.0000 to 0.2135 (the tone's 0.2121), 31.2 dB below the tone in error against the true tone, the audio 0.2 to 1.0 s unchanged to 2.7e-17, the media named as filled, no page errors; on the engine the whistle stroke still attenuated (3 kHz to -143.1 dB, 440 Hz at -10.5) and was not filled.

### thumbnails for sessions over five minutes (AU-32)
- refers-to: app/services/projects.py :: `_overview_png`, `_thumbnail`
- kind: explainer
- logged: v1.49.0 (in progress) · 2026-10-03

A save drew no thumbnail for a session over five minutes, because the picture came from rendering the whole mix, too slow to repeat on every save of a long session. Such sessions now get the same 320x64 picture (bars about the centre on a square-root scale, 0xf97316 on transparent, as showwavespic draws) from their clips' own files read at a stride, about 64 samples a column, clip and track gains applied, muted and unsoloed tracks left out, the loudest across tracks per column. Verified: a 6-minute session with tone only in its first and last 30 s saved in 626 ms (the six minutes of audio packed with it), was listed with a thumbnail, lit 26 of 26 columns at each end and none of the 260 between, bars 46 px high (45 for the tone's level), and showed it at 320 by 64 in the start screen's Recent sessions; no page errors. Sessions up to five minutes keep the rendered picture.

### plugins through spectral selections (RX-35)
- refers-to: app/services/effects.py :: `_match_channels`, `limit_to_band`, `limit_to_boxes`
- kind: explainer
- logged: v1.49.0 (in progress) · 2026-10-03

A plugin applied to a lasso, paint or box selection was refused as changing "timing or channels": the CLAP test plugin, like many, returns stereo for a mono clip (144000 frames, 1 channel in, 144000 frames, 2 out). When only the channel count differs and one side is mono, the band and drawn-selection limits now copy that side to the other's channels and limit as before; a real timing change is still refused. Verified through the interface (sidecar verification/verify_plugin_selection.py), measured on session renders of a 440 Hz plus 3 kHz phrase: through a lasso around 3 kHz from 1 to 2 s (33 boxes) and through a box marquee of 1.5 to 4.5 kHz, the plugin took 3 kHz inside from -10.46 to -16.48 dB (its -6.02), left 3 kHz before the selection and 440 Hz inside at -10.46; no page errors. With Preview (AU-29), plugins preview too.

### warp markers, the engine half (PT-09)
- refers-to: app/services/effects.py :: `warp`; app/routers/media.py :: POST /media/{id}/warp
- kind: explainer
- logged: v1.50.0 (in progress) · 2026-10-03

The engine re-times a media file piecewise between warp markers: each segment (a source span and the length it should last) is stretched by rubberband as Stretch does (0.5x to 2x), each piece but the last rendered 5 ms longer from the source and crossfaded into the next, so the joins do not click and the total is exactly the sum of the lengths. Rendering always from the original keeps repeated edits from compounding. Verified on the engine: a 4 s train of clicks every 0.5 s, its marker at 1.0 s moved to 1.2 s (before it 1.2x longer, after it compressed to fit), came out exactly 4.0000 s with every click within 2.7 ms of where the warp puts it (0.75 s to 0.897 against 0.900, 2.25 s to 2.368 against 2.367). PT-09's other gap, a stretch handle on the clip, is Alt-drag on a clip's right edge, already in place. Still to do before PT-09 counts: the markers on the clip in the interface (adding, dragging, rendering from the original, one undo step), verified in the browser.

### shareable video with captions and layouts (DS-08)
- refers-to: app/services/share.py (`video`, `caption_lines`, `_ass`); app/routers/media.py :: POST /share/video; frontend src/ui/transcript-pane.ts :: Share as video; src/styles/frame.css :: `.fw-share`
- kind: explainer
- logged: v1.53.0 (in progress) · 2026-10-03

Share as video, in the transcript pane, makes an MP4 of the selected words (0.2 s either side) or the whole session: the mix from the engine's own renderer, its waveform drawn in formwav's orange, a title, and the transcript's words burned in as captions (ASS through libass, a line ending after six words, a pause of 0.6 s, a sentence's end or 3 s), in a square (1080 by 1080), portrait (1080 by 1920) or landscape (1920 by 1080) layout, H.264 and AAC with the index at the front. Found on the way: showwaves' default drawing blends each sample faintly, which left the waveform a dim grey on the dark ground; draw=full gives the colour. Verified in Chromium on the JFK transcript faster-whisper wrote (sidecar verification/verify_share_video.py): "ask not what your country can do for you," shared as portrait with the title "Ask not" downloaded a 1080 by 1920 h264 and aac video of 4.36 s; its caption band held 0 white pixels in the lead-in and 13987 at 1.0 s, the title 4312, the waveform 44705 orange; faster-whisper heard its audio as "Ask NOT what your country can do for you."; square and landscape came out 1080 by 1080 and 1920 by 1080; no page errors; the audits clean.

### the session's sound written back into a video (AP-02)
- refers-to: app/services/media.py :: `_has_video`, `import_audio` (the video kept); app/services/share.py :: `into_video`; app/routers/media.py :: POST /share/into-video; frontend src/engine/document.ts :: `MediaRef.video`; src/ui/inspector-pane.ts :: Write into its video
- kind: explainer
- logged: v1.53.0 (in progress) · 2026-10-03

Importing a video now keeps the file beside its audio and names it in the media record (an album cover on an audio file does not count). Write into its video, in the Inspector, takes the selected clip's video (through the clip's original once effects have replaced its audio) and gives it the session's mix as its sound: the picture copied untouched (re-encoded only if its codec cannot go into MP4), the mix aligned so the video's first frame falls where the clip's source starts (delayed when that is before the session's start) and padded with silence to the video's end. Verified in Chromium (sidecar verification/verify_into_video.py) on a 4 s H.264 test video with a 440 Hz tone: imported, marked as a video; Amplify -6 dB left the clip's original on the video's media; written back, it downloaded as h264 320 by 240 of 4.00 s with its frame at 1 s identical to the source's, and its audio peaked 0.0315 on each channel against the source's 0.0629, exactly -6.0 dB; no page errors; the audits clean. (A first measurement read 0.045: it downmixed the stereo result to mono, which weights each side by about 0.707, so two equal channels read 3 dB high; measured per channel it is exact.)

### wow and flutter: fast flutter, per-channel curves, a whole-spectrum mode (RX-51, still partial)
- refers-to: app/services/effects.py :: `_speed_from_peak`, `_speed_from_spectrum`, `_wow_flutter`, `_resample_by_speed`, the effect's mode and per_channel
- kind: explainer
- logged: v1.54.0 (in progress) · 2026-10-03

Measured first, on warped test signals with a known speed curve and an instrument independent of the trackers (Hilbert frequency of each known tone or note; sidecar verification/verify_wow_flutter_modes.py): the old tracker made music without a held tone worse (0.886% to 1.509% peak-to-peak within notes), barely touched 15 Hz flutter (0.969% to 0.819%), and with one curve for both channels made stereo whose sides drift differently worse (to 2.6% and 3.8%). Now the steady-component tracker follows the band's most persistent component (each frame's strongest flipped between equal tones), reads its frequency from the phase advance between frames (precise in a short window, so the window drops to four periods of the band's low edge, 512 points at least), and centres each estimate: 15 Hz flutter on 1 and 3 kHz came down from 0.969% to 0.154% and 0.155%, and the earlier case (0.5% wow, 0.2% flutter) from 1.397% to 0.050% on both tones, where it had reached 0.115%. Per channel tracks and corrects each channel with its own curve: stereo 1 kHz tones drifting differently came down from 0.809% and 0.613% to 0.027% and 0.016%, where one shared curve made them 4.8% and 4.5%. A whole-spectrum mode aligns each frame's spectrum (an 8192-point FFT on a 300-bin-per-octave grid, square-root magnitudes) against its neighbours' average: on music without a held tone it took 0.886% to 0.640% within notes, its estimate correlating 0.85 with the true speed at 0.77 of its size. It stays partial: without a steady component, a slow drift across notes cannot be told from intonation, and the alignment resolves only part of the change within a note; an experiment stitching per-note tracks together was worse (a random walk at the joins) and was dropped. Two faults found on the way: a flat correlation sent the alignment's parabola to a speed of 1e24 (now held to a bin, and the curve to 3%), and the old tracker's window floor of 2048 points averaged fast flutter away.

### remix to a length on the beats (AA-09)
- refers-to: app/services/remix.py (`_beats`, `_chroma`, `plan`, `remix`); app/routers/media.py :: POST /media/{id}/remix; frontend src/ui/inspector-pane.ts :: Remix to length
- kind: explainer
- logged: v1.56.0 (in progress) · 2026-10-03

Remix to length, beside Fit to length, shortens or lengthens a song by re-arranging it on its beats (Audition's Remix): the tempo from the tempo service, the beats on its exact grid at the phase that best meets the onsets, onsets below 150 Hz weighing double; each beat described by its pitch-class energy; jumps between beats at the same place in the bar whose next four beats sound alike (90% or more), chosen one at a time for the length nearest the target, a jump ahead cutting a span out and one back repeating it; the pieces joined with 10 ms crossfades taken as pre-roll, and anything left (under a beat, as a rule) closed by a stretch of at most 4%. Four faults found by measuring, each fixed: full-band onsets led by the off-beat hats put every beat a quarter beat late; normalising by the maximum let one spike shrink the kicks; moving each beat to its own onset peak added up to 16 ms of jitter at a splice; and crossfades taken from the beat shortened each join by 10 ms, which a stretch had been quietly making up. Verified (sidecar verification/verify_remix.py) on a 32 s song at 120 BPM, A B A B, kicks on the beats, C and G major: to 24 s, one section's worth of bars cut; to 40 s, bars repeated; both exact (24.000 and 40.000 s) with no stretch at all, kick intervals 0.494 to 0.500 s across the splices (the instrument's 5 ms resolution), the chords' tones unchanged. In Chromium, Remix to length on that song took the clip to 24.000 s, reported "2 jumps on the beat, no stretch", and one undo restored it; no page errors; the audits clean.

### a realtime adaptive denoiser in the core (RX-24, RX-40, RX-49: core half)
- refers-to: native/formwav-dsp/src/fx.rs :: `Denoiser`, `DENOISE` (stage kind 7), `Biquad::bandpass`, `Biquad::magnitude_db`; native/formwav-dsp/src/render.rs :: `add_clip_fx` (any stage kind but the compressor)
- kind: explainer
- logged: v1.57.0 (in progress) · 2026-10-03

The core has no latency compensation, so the denoiser has no block delay: sixteen analysis band-passes from 80 Hz to 45% of the rate, a noise floor in each learned continuously from a slow envelope (down at once, up 3 dB a second), a spectral-subtraction gain per band floored at the reduction (opening in 3 ms, closing in 30), and the signal through a dynamic EQ at the band centres (a low shelf, peaks of Q 3.5, a high shelf), retuned every 32 samples, an identity at 0 dB. It is stage kind 7 in clip chains, added through add_clip_fx (frequency carrying the reduction, gain the sensitivity), so all three bindings take it unchanged. Built against measurements on 440 Hz bursts over white noise at -40 dBFS rendered through a real clip chain (sidecar verification/verify_denoiser_bands.py), each fault found there: bands stopping at 10 kHz left 58% of white noise's power out of reach (0.9 dB); subtracting band-passes from the signal left their phase error (3.6 dB); a peak at the top band near Nyquist cut 18 to 24 kHz by 4 dB (now a high shelf); the noise-only neighbours' skirts took 3.5 dB off the tone (now held to 80% of a carrying band's gain); gains opening slowly held each onset about 5 dB down; and the cut bands' summed skirts still took 1.4 dB, now corrected for bands carrying signal only (corrected everywhere, the cuts eased to exactly the asked reduction and the gaps came down 11 dB). Now the gaps come down 13.4 dB at a 20 dB setting and the tone stays within 0.54 dB; the low and mid regions cut less (8 dB) than the high, where noise fluctuates less, a refinement for later. The core test (15 pass) asserts 12 dB or more in the gaps, the tone within 1 dB and an exact identity at no reduction. Not yet reachable: the track effects rack, the player's planning and the export renderer come next, and the rows count only once verified there.

### speakers told apart inside one recording (DS-12, RX-59)
- refers-to: app/services/transcript.py :: `_mfcc`, `diarize`; app/routers/media.py :: POST /media/{id}/transcript/speakers; frontend src/ui/transcript-pane.ts :: Tell speakers apart, a word's speaker
- kind: explainer
- logged: v1.58.0 (in progress) · 2026-10-03

Tell speakers apart, in the transcript pane, labels a transcribed recording's words by speaker, with no model: the words grouped into chunks (a pause of 0.3 s, or 3 s, ends one), each chunk described by the mean and spread of 19 MFCCs standardised across chunks, the chunks of a second or more clustered (agglomerative, average linkage on cosine distance) into the one to four speakers that separate best (silhouette; one when nothing separates) or a count given, shorter chunks joining the nearest speaker's centroid, the labels kept in the cached transcript and shown by the pane wherever the speaker changes. The test needed a real second voice: the container's guest.wav proved to be the JFK recording again (the same words, the same 246.2 Hz median pitch), so a public-domain excerpt of Franklin D. Roosevelt's 1941 speech to Congress (Roosevelt_Infamy.ogg, Wikimedia Commons) was downloaded into /tmp, outside the repo. Verified (sidecar verification/verify_speakers.py) on one recording splicing JFK, FDR, JFK and FDR with half-second gaps, transcribed by faster-whisper: two speakers found unasked, every one of the 32 words inside a known span labelled with its speaker (91% before short chunks were kept out of the clustering; "Ask, not, what" after a pause had taken the other label); one word straddling a gap ("19th", FDR's) took the next speaker's label and is outside the scoring. In Chromium the pane showed Speaker 1, 2, 1, 2 at the true turns and "Found 2 speakers"; no page errors; the audits clean. The two voices also differ in recording (1941 and 1961); speakers recorded alike are a harder case not yet measured.

### AAF interchange: a timeline read and written (PT-30, still partial)
- refers-to: app/services/aaf.py (`export_aaf`, `import_aaf`); app/routers/projects.py :: POST /projects/import-aaf, POST /projects/export-aaf; requirements.txt, requirements_macos.txt :: pyaaf2; frontend src/ui/import.ts :: .aaf; src/ui/shell.ts :: the picker's types; src/ui/export.ts :: What, the timeline as AAF
- kind: explainer
- logged: v1.59.0 (in progress) · 2026-10-03

AAF, Pro Tools' and Avid's exchange format, through pyaaf2 (1.7.1, MIT, pure Python, no dependencies; pinned in requirements.txt): Export, What set to the timeline as AAF, writes each track as a sound slot of clips and fillers with each clip's audio embedded as 24-bit PCM (a later clip trimmed where an earlier still plays, as an AAF sequence cannot overlap); importing an .aaf opens its top-level timeline as the session, each sound slot a track, each source clip at its place (converted from the slot's edit rate to samples), its embedded audio imported as media, like the Audacity import. Clip gain, fades and effects are not carried. Audio an AAF only links to, as Pro Tools and Avid often write, cannot be reached here: those clips are left out and named in the notice. Verified (sidecar verification/verify_aaf_roundtrip.py, verify_aaf_interface.py): a two-track session with a gap and an offset clip went out as a 901120-byte AAF and came back with every clip's start, offset and length identical, the audio within 1.2e-7 of its source and the mix within 2.2e-7; in Chromium, Export with the AAF choice downloaded the file and importing it reopened the same two tracks ("Opened the AAF formwav session: 2 tracks, 2 clips"), the mix within 2.2e-7; no page errors; the audits clean. PT-30 stays partial on OMF, for which there is no reader here.

### LADSPA plugins hosted (AU-41)
- refers-to: native/formwav-host/src/ladspa.rs (`describe`, `params`, `process`); src/offline.rs :: default_dirs (LADSPA folders, LADSPA_PATH), find, scan, process; src/params.rs :: list; src/main.rs :: the module; app/services/plugins.py :: its description
- kind: explainer
- logged: v1.60.0 (in progress) · 2026-10-03

formwav-host loads LADSPA libraries beside CLAP and VST3: a library's effects (audio in and out) are listed one per plugin and addressed as <library>#<index>, since one file can hold dozens (CMT's holds 30 and more); their control inputs become parameters with LADSPA's bounds and default hints (sample-rate ranges, logarithmic, toggled, integer); processing is offline in 1024-frame blocks with every port connected before the first run, a stereo plugin taking both sides and a mono one running as one instance per side. Libraries are scanned only inside folders named ladspa (the standard folders on each platform and LADSPA_PATH's), since loading one runs its initialisers. The engine needed nothing new: it lists plugin:<format>:<path> for any format the scan reports. Verified with real third-party plugins (Ubuntu's swh-plugins and cmt, 97 files): the scan found 150 effects in 94 libraries with none failing; Steve Harris's Simple amplifier at -6 dB took a stereo tone down 6.000 dB on both sides, Glame Lowpass at 1 kHz took 5 kHz down 29.3 dB and left 200 Hz within 0.03 dB, and CMT's Freeverb rang at -23.6 dBFS through its tail where the input was silent; in Chromium the effect picker listed all 150 as "(LADSPA)" and Simple amplifier applied through the Inspector at -6 dB measured -6.020 dB (sidecar verification/verify_ladspa.py); no page errors; the audits clean. Found while wiring it: `mod ladspa;` placed above `mod mac;` slid under mac's macOS-only attribute, gating LADSPA out and un-gating mac; the build caught it and the order was fixed. Not in reach here: LADSPA on Windows (.dll) and a run on macOS.

### notes inside played chords found and moved one at a time (PT-10, its polyphonic half)
- refers-to: app/services/polyphonic.py (`find_notes`, `move_notes`, `_frame_pitches`, `_stretch`, `_slope`, RAMP_RIDGE); app/routers/media.py :: GET /media/{id}/notes?poly, POST /media/{id}/retune-notes with poly; frontend src/ui/inspector-pane.ts :: the note editor's In chords
- kind: explainer
- logged: v1.61.0 (in progress) · 2026-10-03

The owner settled that PT-10's "chords" means both chord-tone targets (built at v1.55.0) and editing notes inside a played chord, as Melodyne's Direct Note Access does. In chords, beside Find notes, finds every note sounding in the clip's chords: each frame's spectral peaks scored for every pitch a tenth of a semitone apart by how they line up as its harmonics (a candidate needs a peak at its own fundamental, which keeps the octave below out), the best taken and its harmonics cancelled before the next, frames 35 dB below the loudest skipped, frames joined into notes. Dragging one note and pressing Apply moves only it: in every frame all sounding notes' partials are fitted together by least squares at the frequencies their own peaks give (a measured stretch for piano-like series), sweeping at each note's pitch slope (vibrato inside a frame) and with amplitude slopes under a ridge (decays), so partials closer than a bin are told apart; the moved note's fit is subtracted and it is resynthesised at its new pitch with its own envelopes and stretch. Each step was found by measurement on a C-E-G with E moved to F (sidecar verification/verify_poly_test.py, verify_poly_hard.py, verify_poly_piano.py): exact harmonics left a stretched series 13.6 dB down and 15 cents of vibrato 21.5 dB; measured stretch and chirping partials gave 22.6 and 34.7; free amplitude slopes gave 42.0 but let a neighbour soak up the vibrato (19.4), and a slope ridge swept over 0, 0.01, 0.1 and 1 settled at 0.01 (33.0 and 40.0 at worst); a sampled piano's release tail gave ten false notes until the level gate. Now: the harmonic chord's E partials 70 to 100 dB down; stretched 33.0, vibrato 40.0; a recorded-sample piano chord (FluidSynth with the FluidR3 GM soundfont's Acoustic Grand, installed in the build container, not the repo) found as exactly C4, E4 and G4 with E's real, stretched partials 37.2 dB down; F always within 0.8 dB of E's former level and the other notes' partials unchanged to 0.01 dB. In Chromium (verify_poly_interface.py) In chords found the three notes, a mouse drag moved E4 alone to F4, and Apply measured as above ("Moved 1 note inside the chord, the others kept"); no page errors; the audits clean. Harder cases not yet measured: dense mixes, unpitched sounds among the notes, more than six notes at once, and chords sung by voices.

### replacement dialogue aligned to its guide (AA-12)
- refers-to: app/services/align.py (`align`, `_features`, `_path`, `_time_map`, `_wsola`); app/routers/media.py :: POST /media/{id}/align; frontend src/ui/inspector-pane.ts :: Guide and Align to guide (the overlapping-clip list shared with De-bleed's Leak from)
- kind: explainer
- logged: v1.62.0 (in progress) · 2026-10-03

Align to guide, in the clip section, re-times the selected replacement take to follow the chosen guide (any clip on another track overlapping it) word for word and sets it exactly in the guide's place, one change. The engine describes both every 10 ms by 19 MFCCs normalised over each recording (a re-recorded take has another microphone and room), finds the cheapest dynamic-time-warping path (a sideways step costing 1.5 times a diagonal one, each row computed at once by a min-plus prefix scan, the table float32 and lines up to 30 s), turns it into a time map averaged per guide frame, smoothed over 100 ms and kept monotonic, and renders the take along it by WSOLA (30 ms frames, each moved by up to 10 ms to best continue the waveform), so the result lasts exactly the guide's span with the voice's pitch and timbre kept; warp markers' piecewise stretch, built for a few hand-placed points, was not used. Verified (sidecar verification/verify_align.py, verify_align_envelopes.py, verify_align_interface.py) on real speech: JFK as the guide, a take made from it re-timed unevenly (1.2 times slower, then 4 s into 3.4, then 1.1 times slower) through another EQ and noise at -45 dB: word starts by faster-whisper went from a median 200 ms (90th percentile 424) off the guide's to 20 ms (38); the one word still far off ("ask", after JFK's pause, 920 ms) is the transcriber's, its start put at the silence before it, as loudness envelopes compared in half-second windows show the aligned take within 50 ms of the guide in all but one window where the unaligned one runs to the 250 ms search limit. In Chromium the Guide list offered the JFK clip, Align to guide set the take at the guide's start and length exactly (528000 samples), its words 20 ms (38) off, and one undo restored it entirely; no page errors; the audits clean. A different actor's performance of the line, the real case, is harder and not yet measured.

### Audacity 3 .aup3 projects opened without changing them (AU-33)
- refers-to: app/services/audacity.py (`import_aup3`, `_decode_aup3`, `_SAMPLE_FORMATS`; `_session_from_root` split out of `import_aup_zip`; `_clip_samples` reading blocks by id; stereo pairs by any non-zero link type); app/routers/projects.py :: POST /projects/import-audacity (a SQLite header means .aup3); frontend src/ui/import.ts, src/ui/shell.ts :: .aup3
- kind: explainer
- logged: v1.64.0 (in progress) · 2026-10-03

An .aup3 is one SQLite file: the project as Audacity's binary serialisation (a dictionary of names and a document of tokens) and the audio in a sampleblocks table. formwav writes the upload to a temporary copy and reads only that, so the original is never touched (opening it in place would replay Audacity's log and take its lock); it decodes the document strictly back into Audacity's XML (an unknown token, an attribute outside a tag or a mismatched end tag fails loudly), reads each clip's blocks (float, 16-bit or 24-bit; a negative id is silence of that length), applies Audacity 3's clip trims, and hands the project to the builder the zipped .aup import uses, now shared; a saved project is read, else the autosave; clips stretched by Audacity 3.4's clip stretching are refused with a message rather than read wrong. Verified on projects Audacity itself wrote: Audacity 3.4.2 was installed in the build container, run under Xvfb with its scripting module enabled (the module's state had to be set to enabled, as a new module asks first), and driven through its pipe to import tones, move a clip to 0.25 s, set a gain, add a label and SaveProject2 (sidecar verification/make_aup3_with_audacity.py; the two projects kept as verification/fixtures/, their logs merged as Audacity's close would): the two-track project opened with aup_a at 0 for 1 s, aup_b at 0.25 s for 0.5 s at -6.00 dB and the label intro at 0.1 s, its render correlating 1.000000 with the tones, the file's hash unchanged (verify_aup3.py); the stereo project opened as one stereo track, 440 Hz at 0.500 left and 660 Hz at 0.300 right, after a fault it exposed: Audacity 3 marks a stereo pair with a link type (3.4.2 wrote linked="3"), and the builder paired only linked="1", so it came in mono until any non-zero link paired the tracks. In Chromium the file picker opened the project the same way ("Opened the Audacity project ...: 2 tracks, 2 clips, 1 label") with the original unchanged (verify_aup3_interface.py); no page errors; the audits clean. The tests' own WAV reading searched for the bytes "data" and broke once a render carried cue and LIST chunks (the label exported as a cue); they walk the RIFF chunks now. Not read: clip stretching, clip envelopes and effects (as with .aup), and projects Audacity left open (their log not yet merged).

### field recorder audio conformed to a picture edit (PT-31)
- refers-to: app/services/conform.py (`parse_edl`, `conform`, `_channel`); app/services/media.py :: `_bwf_meta` (import_wav), resample_media carrying it; app/routers/projects.py :: POST /projects/conform; frontend src/ui/import.ts :: .edl; src/ui/shell.ts :: the picker's types
- kind: explainer
- logged: v1.65.0 (in progress) · 2026-10-03

Importing a broadcast WAV now keeps its recorder metadata in the media info: the bext chunk's TimeReference as `timecode` (seconds since midnight) and iXML's TAPE, SCENE and TAKE; resampling to the session's rate carries them over, as ffmpeg drops the chunks. Importing a CMX3600 .edl then conforms those recorder files to the picture edit, as Pro Tools' Field Recorder workflow does: each audio event's source timecode is found in the file whose timecode covers it (a tape matching the event's reel preferred), the clip placed at its record position counted from the edit's first event to the sample, the clip name kept as a marker, each channel of a polyphonic file on its own track when asked; events nothing covers are named. Drop-frame and pull-down rates (23.976, 29.97, 59.94) are refused rather than conformed subtly wrong. Verified (sidecar verification/verify_conform.py, verify_conform_interface.py) on two generated broadcast WAVs with real bext and iXML chunks (TAPEA at 10:00:00:00 for 30 s, TAPEB at 10:05:00:00 for 20 s, each channel distinct noise so one sample's slip would show) and a four-event EDL at 25 fps: three events placed with start, offset and length exactly 0/240000/144000, 144000/96000/119040 and 263040/960000/48000 samples, the fourth (TAPEC) reported not found; each track's render matched the source samples it should hold to 3e-8, as one stereo track and with channels split; in Chromium the recorder files imported with their timecode and tape, and importing the EDL with 25 fps and channels split gave the two channel tracks exactly so ("Conformed test_cut.edl: 3 of 4 events placed from the recorder files; not found: 004 (TAPEC)"); no page errors; the audits clean. Not covered: AAF picture edits as the conform's source, scene and take matching, iXML channel names, drop-frame timecode.

### audio to MIDI, melodic, polyphonic and rhythmic (PT-13)
- refers-to: app/services/audio_midi.py (`to_notes`, `_pitched`, `_rhythmic`); app/routers/midi.py :: POST /api/midi/from-audio; frontend src/ui/inspector-pane.ts :: Audio to MIDI and Convert to MIDI
- kind: explainer
- logged: v1.66.0 (in progress) · 2026-10-03

Convert to MIDI, beside the note editor, reads the selected clip's span as MIDI notes onto a new note track at its place, the same note clip a MIDI file's import makes (rendered by the built-in instrument, drawn as a piano roll, exportable as a Standard MIDI File), in Pro Tools' three modes: melodic (PT-10's single-line note finder), polyphonic (the chord note finder of v1.61.0) and rhythmic, new: onsets from log-spectral flux taken band by band (below 200 Hz, 200 Hz to 2 kHz, 2 to 8 kHz, above), each band against its own peak, the threshold a local median padded with silence, each onset refined on the first difference's envelope, each hit classed by its new energy (the 60 ms after less the 60 ms before) as a kick (36), a hi-hat (42, high and nearly empty below 2 kHz) or a snare (38); velocities follow loudness. Each step was found by measurement on a drum pattern of kicks, snares and hi-hats: the first frame had no silence before it, so a hit on sample 0 was missed; summed over all bins, a kick's few low bins were drowned by broadband hits (flux 0.038 against 0.137); edge padding let a first-frame hit set its own threshold above itself (1.58 against 1.0); frame positions read hits 9 ms early, and the plain waveform hi-hats after kicks 22 ms early; the whole window's spectrum classed hi-hats on kicks' tails as snares and snares' broadband noise as hi-hats. Now all eight hits come at exactly 0, 0.25 and so on to 1.75 s, each classed right; the melody's C4, D4, E4 and G4 at 0, 0.6, 1.2 and 1.8 s with velocities ordered by loudness; the chord's C4, E4 and G4 at their onsets (sidecar verification/verify_audio_to_midi.py). In Chromium the drum clip and the melody each became a note track at the clip's place with exactly those notes (verify_audio_to_midi_interface.py); no page errors; the audits clean. Rhythmic knows three classes only; the material measured is synthetic.

### a 5.1 surround export, tracks placed by their 5.1 position (PT-38, AA-11: first part)
- refers-to: app/services/surround.py (`gains`, `render_51`, `wav_51`, `_lowpass`); app/routers/render.py :: render_session what=surround51; frontend src/engine/document.ts :: Track.surround, set-track-surround; src/ui/inspector-pane.ts :: the track section's 5.1 position row; src/ui/export.ts, src/io/render-client.ts :: the 5.1 choice
- kind: explainer
- logged: v1.68.0 (in progress) · 2026-10-03

The core mixes to stereo, so the first part of surround builds on the stems export's per-track renders: each track rendered alone through the core's chain and placed among the five full-range speakers at ITU-R BS.775's angles (C 0, L and R 30 degrees either side, Ls and Rs 110) by pairwise constant-power panning between the speakers either side of its angle, a position nearer the middle of the room spreading it over all five with its power kept; an LFE send carries only what lies below 120 Hz (a fourth-order Butterworth's magnitude applied in the frequency domain, zero phase, as a per-sample loop would take minutes on a long session); a track without a position keeps its stereo image on L and R. The file is six channels in SMPTE order (L R C LFE Ls Rs), 32-bit float, WAVE_FORMAT_EXTENSIBLE with the 5.1 channel mask 0x60F. A track's position is set in its section's 5.1 row (left to right, back to front, LFE dB), one undo step. Verified (sidecar verification/verify_surround51.py, verify_surround51_interface.py): five tones at -12.04 dBFS placed at the centre, between L and C, nowhere (stereo), at R with an LFE send and at Ls arrived each only where placed, -12.0 dB on its own speakers, the pair split at -15.1 (constant power), the LFE carrying the 50 Hz alone, Rs silent, everything else below -177 dB; in Chromium two tracks placed through the row and exported with the 5.1 choice read back the same, and undo cleared a position; no page errors; the audits clean. Not yet: hearing 5.1 while working (playback stays stereo; a fold-down is next), six-channel meters, master effects on a six-channel bus (they act per track, as in the stems), and a two-dimensional panner.

### hearing 5.1 as a stereo fold-down, and a two-dimensional panner (PT-38, AA-11: second part)
- refers-to: app/services/surround.py :: `fold`, `_stem` (rendered unfolded); app/services/render.py :: plan (a placed track folded when the session hears the fold-down); frontend src/audio/surround.ts (`surroundGains`, `foldDown`, the engine's maths line for line); src/audio/player.ts :: the planner; src/engine/document.ts :: SessionDoc.surroundFold, set-surround-fold; src/ui/inspector-pane.ts :: the 5.1 row's Hear the fold-down and its panner pad
- kind: explainer
- logged: v1.69.0 (in progress) · 2026-10-03

Hear the fold-down makes the session play its 5.1 as ITU-R BS.775's stereo downmix (Lo = L + 0.707 C + 0.707 Ls, Ro = R + 0.707 C + 0.707 Rs, the LFE left out), in playback and in the stereo mix export alike, so what is heard is what is delivered: a placed track's fold-down gains become the core's clip gain and pan under its balance law (the near side at 1, the far side turned down by cos(pan * pi / 2)), exact for a mono source, a stereo one keeping its own image within that balance; its position replaces its pan and any pan automation. The browser's planner and the engine's use the same maths (src/audio/surround.ts is the Python's line for line). The 5.1 row's panner pad draws the room from above, front up, the five speakers at their angles; dragging the dot moves it, held inside the room, and letting go places the track as one change. Found while verifying: the 5.1 export's stems were rendered through the session's fold-down, so a placed track came back already folded and was placed again; playback and the export's fold-down differed by -15.6 dB until the stems were rendered unfolded. Verified (sidecar verification/verify_surround_fold.py) in Chromium: a tone dragged on the pad to the front centre landed at (0, 1), one set by the fields at Ls, one unplaced; with the fold-down on, playback (the player's realtime engine) matched the ITU fold-down computed from the 5.1 export's six channels to -147.5 dB, the stereo mix export matched playback exactly (-240 dB), and turning it off changed playback; no page errors; 70 commands each dispatched; the audits clean. Still missing for the rows: six-channel meters, and master effects on a six-channel bus.

### a six-channel master bus in the core, the 5.1 export through it (PT-38, AA-11: third part)
- refers-to: native/formwav-dsp/src/render.rs :: Player.set_places, Player.render_surround, Player.take_peaks_51, reset_fx; the test the_six_channel_bus_places_each_clip_and_applies_the_master_to_all_six; src/python.rs :: render's places; backend app/services/render.py :: plan's owners; app/services/surround.py :: render_51 through the core (the per-track stems retired)
- kind: explainer
- logged: v1.70.0 (in progress) · 2026-10-03

The core gains a 5.1 render beside the stereo one, which it leaves untouched: set_places gives each clip a placement (speaker gains in SMPTE order), clips sharing one are grouped, and render_surround mixes unplaced clips and the buses' outputs onto L and R, each group (mixed by the same per-clip code the stereo render uses, folded to mono) onto the six channels by its gains, the LFE through a fourth-order 120 Hz Butterworth low-pass of its own, then runs the master chain on each pair (L R, C LFE, Ls Rs; the copies reset with the original on a loop) and the master fader on all six, keeping six peaks. The binding's render takes an optional list of placements and returns six channels interleaved when given one; plan reports each clip's owner track; the 5.1 export now runs through the core's bus, so the master chain and fader act on the 5.1 mix. Verified: a core test (16 now pass) puts a clip placed at C on C alone and exactly, an unplaced one on L and R, an LFE placement within 0.2 dB, the master fader on all six; the five-tone 5.1 test reads back as before, the LFE through the core's low-pass (others below -150 dB in it); with a 1 kHz high-pass and a compressor in the master chain and the fader at -6 dB, L and R matched the unplaced tone through the stereo master and C the centred tone through it, each to the bit (-240 dB), the surrounds silent (sidecar verification/verify_surround_master_bus.py). Still missing for the rows: six-channel meters while playing (the core keeps six peaks; the browser's player does not run this bus yet).

### the 5.1 bus heard, folded by the core, and metered live (PT-38, AA-11: done)
- refers-to: native/formwav-dsp/src/render.rs :: Player.set_fold_51, is_fold_51, render_folded (render folds when set), render_surround (track meters kept), the test the_fold_mode_plays_the_six_channel_bus_folded_to_stereo; src/wasm.rs :: fw_set_places, fw_set_fold_51, fw_take_peaks_51; src/python.rs :: render's fold; src/native.rs :: the mix's places and fold, the report's surroundPeaks; backend app/services/render.py (the stereo mix folds the bus), app/services/surround.py :: places_for; frontend src/audio/player.ts (placements and fold in the plan, onSurroundLevel), src/audio/player-worklet.ts (applies them, reports six peaks), src/audio/surround.ts (the per-clip fold retired), src/ui/mixer.ts (six bars on the master strip)
- kind: explainer
- logged: v1.70.0 (in progress) · 2026-10-03

The core gains a fold mode: with it set, its ordinary stereo render runs the six-channel bus and folds it to stereo by ITU-R BS.775 (Lo = L + 0.707 C + 0.707 Ls, Ro likewise, the LFE left out), without allocating once warm, keeping the six peaks and taking the stereo meters on the fold. Playback in the browser (the worklet), playback through the desktop's native output and the engine's stereo mix all give the core the same placements with the fold on, so what is heard, the stereo mix and the 5.1 export's fold-down are one computation, for stereo sources as for mono (the earlier per-clip gain and pan was exact only for mono, and is retired). The worklet and the native output report the six peaks while folding; the mixer's master strip shows them as six bars, L R C LFE Ls Rs, while the 5.1 bus plays and hides them otherwise. Found while wiring it: the mixer's meter driver held two levels and made a third channel onward NaN for good (a missing level now starts from silence); the six-channel render had left the mixer's track meters still (it now meters tracks as the stereo render does). Verified: a core test (17 pass) folds a session in fold mode to within 1e-6 of the ITU fold of its six-channel render with both kinds of peaks kept; in Chromium (sidecar verification/verify_surround_meters.py) with two tones placed (C, Ls) and one unplaced, the realtime engine matched the 5.1 export's ITU fold to -150.2 dB and the stereo mix export matched it exactly, and in real playback the master strip's six bars showed L, R, C and Ls at -12.1 dBFS with LFE and Rs empty (the 5.1 export's channel peaks are -12.04 and silent), hidden before playing and after stopping; no page errors; the audits clean.

### first-order ambisonics on the bus (PT-42)
- refers-to: native/formwav-dsp/src/render.rs :: SURROUND_51, SURROUND_FOA, Player.set_surround_format, render_surround and render_folded by format, the test the_ambisonic_format_encodes_by_direction_and_folds_through_two_cardioids; src/wasm.rs :: fw_set_surround_format; src/python.rs :: render's surround_format; src/native.rs :: the mix's surroundFormat; backend app/services/surround.py :: foa_gains, places_for by format, _bus, render_foa, wav_float, wav_foa; app/services/render.py (the stereo mix folds in the session's format); app/routers/render.py :: what=ambisonic; frontend src/audio/surround.ts :: foaGains; src/audio/player.ts and player-worklet.ts (records and format); src/engine/document.ts :: SessionDoc.spatialFormat, a track's elevation, set-spatial-format; src/ui/inspector-pane.ts (Format, Elev°); src/ui/mixer.ts (four bars, W Y Z X); src/ui/export.ts and src/io/render-client.ts (the AmbiX export)
- kind: explainer
- logged: v1.71.0 (in progress) · 2026-10-04

The six-channel bus takes a format. In first-order ambisonics (AmbiX: ACN order W Y Z X with SN3D gains, in the bus's first four slots) a placed track is encoded by its direction on the pad (azimuth, 0 ahead and positive to the left), its distance from the middle setting how focused it is (the middle all around), and an elevation in degrees: W = s, Y = s r sin az cos el, Z = s sin el, X = s r cos az cos el; an unplaced track is encoded straight ahead; nothing is low-passed (the fourth slot is X, not an LFE); the master chain runs on (W, Y) and (Z, X), and the fold for listening is two virtual cardioids facing left and right, L = (W + Y) / 2, R = (W - Y) / 2, so a source to the left is heard on the left alone. Inspector's spatial row chooses the session's format and a track's elevation; Export writes a four-channel AmbiX WAV (WAVE_FORMAT_EXTENSIBLE, no speaker mask, as YouTube's 360 audio, Pro Tools and Reaper read it); the mixer's master strip meters W Y Z X. Found while testing: the Inspector refilled the elevation field even for a track not yet placed, so filling in the row reset it to 0 before the tick read it (it is now refilled from a placed track only, like x, y and the LFE send). Verified: a core test (18 pass) puts a source to the left in W and Y, one overhead in W and Z, an unplaced one in W and X unfiltered, and folds the left one to the left alone; on the engine (verification/verify_ambisonics_engine.py) each tone lands only where it should (W all three at -12.0, Y the left one, Z the overhead one, X the unplaced one), the stereo mix with the fold-down matched the export's cardioid decode to -156.5 dB, and the same session's 5.1 export still worked; in Chromium (verification/verify_ambisonics_ui.py) a session set up in the Inspector (format, elevation 90 kept through a pad drag) played live equal to the export's decode (-156.5 dB), the stereo export equal to playback, and in real playback the master strip showed four bars titled W Y Z X at -3.4, -12.1, -12.1, -12.1 dBFS against the export's -3.39 and -12.04; Export offers the AmbiX file; no page errors. Not covered: higher orders (Pro Tools goes to third), rotating the whole field, binaural decoding, ambisonic recordings as sources, and a master compressor linked across all four channels (it links within pairs).

### a realtime reverb insert (PT-22)
- refers-to: native/formwav-dsp/src/fx.rs :: Reverb, REVERB (stage kind 8), Stage::Reverb (boxed; Stage no longer Copy), the test the_reverb_rings_by_its_room_and_stays_stable; src/render.rs (a clip stage cloned for its meter chain); backend app/services/render.py :: FX_KINDS, _stage, plan (a reverb's track on its own bus); frontend src/engine/document.ts :: ReverbFx, the insert sanitiser; src/audio/player.ts :: flatStages, flatFx, flatFxAuto, the planner's own-bus rule; src/ui/inspector-pane.ts (Reverb in the track, bus and master racks with Room, Damp, Mix and Width); src/ui/lanes.ts
- kind: explainer
- logged: v1.72.0 (in progress) · 2026-10-04

PT-22's EQ and dynamics already played as realtime inserts; its reverb was an offline clip effect. The core gains a realtime reverb after Jezar's Freeverb (public domain): per channel eight damped combs in parallel into four all-passes in series, the right channel's delays 23 samples longer, lengths scaled to the rate, denormals flushed; room size sets the feedback (0.7 to 0.98), damping the combs' low-pass, mix keeps the dry at 1 - mix and adds the tail at mix times Freeverb's default wet level, width blends the tails. It is stage kind 8, boxed so filter stages stay small (Stage stops being Copy; one clip stage is now cloned for its meter chain). A track holding a reverb plays through a bus of its own, as one holding a compressor does, so the tail rings on past each clip's end instead of stopping with it; the reverb is offered on tracks, buses (fed by sends) and the master, not on clips. Found while measuring: scaling the tail by Freeverb's maximum wet (3) put a send-fed tail 6 dB above the dry burst that fed it; at its default level the tail sits 3 dB under. Verified: a core test (19 pass): mix 0 exactly dry, a finite decaying tail, a bigger room ringing longer, width 0 mono and 1 wide, bounded at the largest room with no damping, silent after a reset; on the engine (verification/verify_reverb_engine.py) where the dry export is silent after a 0.25 s burst's clip ends the reverb rings on (-24.2, -42.1, -76.5 dBFS at 0.3, 1.0 and 2.5 s), RT60 0.68, 1.41 and 4.12 s at room 0.3, 0.6 and 0.9, and a send-fed bus reverb adds its tail; in Chromium (verification/verify_reverb_ui.py) Reverb is offered on tracks, buses and the master and not on clips, added and set in a track's rack, and live playback equals the export with it to the bit and differs from the dry export; no page errors.

### formwav's repair tools as CLAP plugins for other hosts (RX-67)
- refers-to: native/formwav-clap (Cargo.toml, src/lib.rs): one CLAP bundle, formwav De-noise and formwav De-hum; native/formwav-dsp/src/fx.rs :: Denoiser::retune; native/formwav-host/src/offline.rs (file.clap#index)
- kind: explainer
- logged: v1.73.0 (in progress) · 2026-10-04

A CLAP bundle (clap-sys, Apache-2.0, as the core is) holds two realtime repair plugins: De-noise, the core's adaptive de-noiser (Reduction 0 to 40 dB, Sensitivity -6 to 12 dB), retuned in place when a knob moves so what it has learned of the noise is kept (Denoiser::retune sets only the two fields design derives from them); and De-hum, a peak cut at the mains frequency (40 to 70 Hz) and each harmonic up to eight, with Reduction and Q, its cuts held in a fixed array and redesigned in place keeping their filter state (no allocation on the audio thread, no click). Each instance keeps its parameters in atomics for the host's main thread, applies parameter events at the start of each block, saves and loads a tagged, versioned state, asks the host to rescan its parameters' values after a load, processes in place safely, and runs each block with flush-to-zero set (the host's mode restored). fwhost's offline processing takes file.clap#index for a bundle's other plugins, as LADSPA libraries are named. Verified (sidecar verification/verify_clap_plugins.py): through fwhost, De-noise equals the core's de-noiser in the engine's export to the bit at the same settings (noise in the gaps -40.0 to -50.2 dBFS), and De-hum at 50 Hz, four harmonics, 30 dB cuts 50, 100, 150 and 200 Hz by 30.1 to 30.7 dB with a 1 kHz tone unmoved (-20.0 dB); clap-validator 0.4.1 (built from free-audio/clap-validator) runs 81 tests on the bundle: 61 passed, 0 failed, 19 skipped (no notes or GUI), 1 warning. Found by the validator: after a state load the values changed without the host being told (a host's knobs would show the old values), and De-noise put a subnormal float (6.9e-39) in its output; both fixed. The remaining warning, De-hum taking 3.7 times as long on denormal input, is the validator's own per-sample denormal generation inside its timed loop dominating a plugin this cheap: the repo's fixture plugin, a single multiply with no denormal handling, shows 10.9 times on the same test. Not covered: a macOS build and run (this container cannot build for macOS), VST3, Audio Unit and AAX forms (Pro Tools loads only AAX), and RX's other realtime tools (de-click, de-ess, de-plosive).

### Deconstruct's own sensitivities and rebalance (RX-15)
- refers-to: backend app/services/separate.py :: deconstruct (tonal_sens, transient_sens, gains_db); app/routers/media.py :: media_deconstruct (tonalSens, transientSens, rebalance, tonalDb, noisyDb, transientDb); frontend src/ui/inspector-pane.ts (the module's fields and Rebalance)
- kind: explainer
- logged: v1.74.0 (in progress) · 2026-10-04

Deconstruct had a fixed margin and sent its parts to tracks, the tracks' faders doing the rebalance. As in iZotope RX's module, each split now has a sensitivity from 0 to 10 (5 keeps the old margin of 2; each step of 5 divides or multiplies it by 4), transient bins taken only from what is not tonal so the masks partition the spectrum at any setting; and Rebalance renders the parts at their gains (tonal, noisy, transient dB) as one result, the masks weighted by the gains and inverted once (the separation is linear, so this equals the gains applied to the parts and summed). Rebalance renders the clip's whole source, so set-clip-media keeps the clip's trim and place, and it is one undo step; Deconstruct to tracks honours the sensitivities too. Verified on the engine (sidecar verification/verify_deconstruct_engine.py) with a tone, clicks and noise: the parts sum back within -139 to -145 dB at sensitivities 0, 5, 8 and 10; the tonal share rises 96.8, 97.4, 98.6, 99.5% with tonal sensitivity; Rebalance at 0 dB returns the input (-141 dB), and with the noise at -60 dB equals the parts mixed at those gains (-148 dB), the 6 to 20 kHz noise band down 11.7 dB, the tone unmoved, the length kept. Its clicks' peaks fell from 0.52 to 0.25, part of each click classed noisy at the default sensitivity (the median-filter separation's limit; transient sensitivity is the lever). In Chromium (verification/verify_deconstruct_ui.py): Rebalance from the module's fields swapped the clip's media with its trim and place kept, equal to the engine's rebalance at those settings to the bit, undo restored it, and Deconstruct to tracks sent the sensitivities; no page errors.

### legacy .aup clip envelopes, measured against Audacity 2.4.2's own render (AU-34, first part)
- refers-to: backend app/services/audacity.py :: _session_from_root (each clip's envelope); sidecar verification/AUDACITY2_HEADLESS.md, fixtures/audacity242_env.zip and audacity242_env2.zip, verify_aup_envelopes.py, measure_audacity_envelope_law.py
- kind: explainer
- logged: v1.75.0 (in progress) · 2026-10-04

Real Audacity 2.4.2 now runs headless here (Debian 11's package, abort-on-call stand-ins for the libraries it links but these fixtures never use; the setup and its traps are in the sidecar's AUDACITY2_HEADLESS.md) and wrote two .aup fixtures, each kept with Audacity's own mono render as ground truth. An imported clip now carries its volume envelope: control points timed from the clip's start (Audacity stores a point set at 2.5 s on a clip at 2 s as t="0.5"), their gains as dB, held at formwav's -60 dB floor below it. Measured against Audacity's renders: formwav's import of the fixtures came within -29.9 and -18.3 dB (without the envelopes, -14.5 dB on the first), and the whole remaining difference is the interpolation law: Audacity 2's clip envelopes interpolate in dB (its WaveClip envelope is exponential: halfway between gains of 1.0 and 0.25 its render measures 0.5004, the geometric mean, where formwav's clip envelope, linear in gain, gives 0.625). Next: formwav's clip envelope interpolated in dB in both planners (export and playback), which the same fixtures will check to the level of Audacity's 16-bit dither. Found along the way, in my fixture-making, not in formwav: a reused Audacity window mixed one project's track into another's render and moved its block file into the wrong data folder; each fixture now comes from a fresh Audacity, with its orphan block removed and the render regenerated.

### clip envelopes interpolated in dB, as Audacity 2's (AU-34, second part)
- refers-to: frontend src/audio/player.ts :: clipEnvGain, clipEnvelope; backend app/services/render.py :: _clip_env_gain, _clip_envelope; src/engine/document.ts (Clip.envelope's description); sidecar verification/verify_aup_envelopes.py, verify_aup_envelope_residual.py, verify_clip_envelope_live.py
- kind: explainer
- logged: v1.75.0 (in progress) · 2026-10-04

formwav's clip envelope, built as Audacity's, interpolated linearly in gain; Audacity 2's interpolates in dB (its own render measures 0.5004 halfway between gains of 1 and 0.25, the geometric mean, where linear gain gives 0.625), and formwav's lane already drew the line on a dB scale, so what played had not matched what was drawn either. Both planners now evaluate a clip's envelope in dB and, since the core interpolates its envelope points in gain, sample the curve in steps of at most 0.1 dB (within about 1e-5 of it), with track automation still multiplied in at its breakpoints and eight points a span; the engine's planner rounds sample times as JavaScript does (floor(x + 0.5), not Python's round), so the two place every point alike. Track volume automation keeps its own interpolation. Verified: the two Audacity 2.4.2 fixtures now match Audacity's own renders to -71.4 and -72.3 dB at worst and -84.1 dB rms, from -29.9 and -18.3 dB, and that residual is Audacity's shaped dither, not the envelope: the same in flat regions, the ramp and silence (-84.1 to -84.3 dB), 99.1% of it above 10 kHz, -116.3 dB at the tone's frequency; in Chromium an imported session loaded as the app loads one plays live equal to the export to the bit over 176,400 frames.

### sessions remember their view; Audacity projects open where they were left (AU-34, third part)
- refers-to: frontend src/engine/document.ts :: SessionView, SessionDoc.view; src/engine/index.ts :: EngineState.view, loadDocument; src/ui/lanes.ts :: currentView, the view subscriber; src/ui/projects.ts :: save; backend app/services/audacity.py :: _session_from_root (the view)
- kind: explainer
- logged: v1.75.0 (in progress) · 2026-10-04

A session saves the view it is left in (the lanes' zoom, their left edge in seconds, the time selection) and opening it restores them, as Audacity reopens a project. The view is captured when saving and sent with the document, not written into the engine's document, so it is never an undo step or an unsaved change; loadDocument restores the selection (clearing one left from a previous session, whose tracks are gone) and publishes the view, and the lanes apply the zoom, then the scroll once the zoom has laid out. An imported Audacity project (.aup or .aup3, which carry the same attributes) opens in its own view: its zoom in pixels a second over formwav's 100 at zoom 1, held to 0.25 to 16, its left edge h, its selection sel0 to sel1. Verified in Chromium (sidecar verification/verify_session_view.py) with the Audacity 2.4.2 fixture: the import carried zoom 7.91, left edge 0.244 s and the selection 22050 to 44100; opened as the app opens a session, the lanes showed exactly that (the zoom measured from a clip's width, the left edge from the scroll); a changed selection and a 500 px scroll were saved with Ctrl+S and read back as the left edge 0.632 s and the new selection; no page errors.

### aliased audio in legacy .aup projects (AU-34, done)
- refers-to: backend app/services/audacity.py :: _Aliases, _clip_samples, import_aup_zip, _session_from_root; sidecar verification/verify_aup_alias.py, fixtures/audacity232_alias.zip, AUDACITY2_HEADLESS.md
- kind: explainer
- logged: v1.75.0 (in progress) · 2026-10-04

Audacity 2.3.2 and earlier could read a WAV in place instead of copying it (2.3.3 switched that off); a project made so holds pcmaliasblockfile blocks naming the file, its first frame, aliaslen and the channel, and the path is the one on the machine that made it. The importer now takes the other files in the upload as possible sources, matched by name, decodes each once (its own channels and rate) and slices it as Audacity reads it; a file the project needs and the upload lacks is named in the error. Found while verifying: an alias block has no len attribute, so reading len gave a clip of no frames; its length is aliaslen. Verified with a project Audacity 2.3.2 wrote itself (driven by keystrokes; its Project Dependencies dialog listed the WAV, saved without copying): the clip imported equal to src.wav to the sample (difference 0), with the view Audacity left (zoom 314.8 px/s as 3.148); without src.wav in the upload the import answers 422 naming it; the Audacity 2.4.2 fixtures still match Audacity's renders to its dither. With clip envelopes, view state and these aliases, AU-34 is done; Audacity 2 projects store no effects, so that gap does not apply.

### a live instrument in the core (AU-37, first part)
- refers-to: native/formwav-dsp/src/synth.rs :: Synth (note_on, note_off, all_off, render), the test the_live_instrument_plays_exactly_what_render_makes; src/render.rs :: Player.live_note, set_live_patch, live_all_off, the live mix in render, the test a_live_note_plays_through_the_player_as_the_synth_renders_it; src/wasm.rs :: fw_live_note, fw_live_patch, fw_live_all_off
- kind: explainer
- logged: v1.76.0 (in progress) · 2026-10-04

Note clips are rendered by the built-in instrument ahead of playback; playing a keyboard needs the instrument to sound as keys go down. The synth gains a streaming form: each voice keeps the state the offline render keeps for a note (its phase from 0, frames since it started, the frame it was let go), so its oscillator and envelope run the same arithmetic, and voices are summed in the order they started, as render sums notes; a note-on with velocity 0 ends a note, as MIDI's does, and a voice is dropped once its release runs out. The player mixes it into both channels at unity (as a mono note clip plays at pan 0) after the clips and buses and before the master chain, so master effects and meters include it, with reusable scratch so a warm player does not allocate; its patch defaults to the built-in one (the existing Patch::default, render_notes' own defaults), so a note played sounds as a recorded one will. Verified (21 core tests pass): an overlapping phrase with a repeated pitch, a soft note and a 300-frame one, started and ended on its frames through uneven blocks of 1 to 128 frames, equals render of the same notes in every sample for all four waveforms, with no voice left after; a note played through the player gives both channels exactly the synth's render of it and silence after its release, and all-off releases a held note. Found while writing it: Patch already had a Default with the built-in values; the duplicate I added was removed.

### live MIDI input played and recorded (AU-37, second part)
- refers-to: native/formwav-dsp/src/render.rs :: Player.render_idle, live_sounding, the test the_idle_render_plays_live_notes_with_the_transport_stopped; src/wasm.rs :: fw_live_sounding, fw_render_idle; frontend src/audio/player-worklet.ts (live-note, live-all-off, the idle render while stopped); src/audio/player.ts :: liveNote, liveAllOff; src/ui/midi-input.ts; src/main.ts (mounted, its notices on the notice line)
- kind: explainer
- logged: v1.76.0 (in progress) · 2026-10-04

Every MIDI input the browser offers through Web MIDI (one plugged in later too) plays the core's live instrument as keys go down and up: note-on starts a note, note-off or note-on at velocity 0 ends it, All Notes Off and All Sound Off end them all. While the transport runs the instrument is mixed before the master chain; while it is stopped the worklet renders it alone (no clips, the position unmoved) for as long as a voice sounds. While the transport records, the notes are captured with their starts and lengths (the position carried between the transport's reports by the clock), and when recording stops they become one note clip, rendered by the built-in instrument the live one matches sample for sample, on the armed track or a new one, as one undo step; a kept or failed take is told on the notice line. Verified (22 core tests pass; sidecar verification/verify_midi_input.py): with the transport stopped a live note comes out of the idle render as the synth renders it, through the master fader, the position unmoved; in Chromium with a simulated MIDI keyboard (real MIDI bytes through a stand-in for navigator.requestMIDIAccess, as no MIDI hardware is here) a held A4 moved the output meter from 0 to 0.727 and back to 0 after its release, and two overlapping notes played while recording came back as a note clip: C4 at velocity 100, 0.501 s long, and E4 at velocity 80, 0.199 s after it and 0.509 s long, against 0.5 s and 0.2 s played; no page errors. Found while testing: Space does nothing in a session with no tracks, so my first test never stopped its recording; a user stops with the stop button, as the test now does. Not covered: the macOS desktop app's WebView (WebKit) has no Web MIDI, so live input there needs the engine to read MIDI devices itself and pass the notes on.

### the ruler paints only what is in view (AU-13, groundwork)
- refers-to: frontend src/ui/ruler.ts (the paint canvas, draw, the scroll repaint); src/styles/shell.css :: .fw-ruler-paint
- kind: explainer
- logged: v1.77.0 (in progress) · 2026-10-04

AU-13's drawing in the lane needs the lanes to zoom to single samples, and the timeline is laid out at full width (its pixels, up to a cap of 16000 today), with each clip's waveform and the ruler each one canvas as wide as what it covers: at single samples a ten-second clip would want a canvas near 480000 px, past what browsers allow. The approach keeps every layout element at full width (positions, scrolling and the code that reads them unchanged) and makes only the canvases cover the visible window. This step does it for the ruler: its full-width canvas keeps taking the clicks with a backing store of 1 by 1 pixel, and a second canvas, placed over the visible window (after the sticky corner) and transparent to the pointer, paints with its origin shifted by the scroll, its tick loops running over the visible range only (at deep zoom the timeline is millions of pixels, and a loop over all of it would stall each scroll), repainted once a frame as the lanes scroll. Verified in Chromium (sidecar verification/verify_ruler_window.py): scrolled 2400 px at the current full zoom, the paint canvas sat at 2592 px (the scroll and the 192 px corner), 560 px wide, the full-width canvas 4800 px with a 1 by 1 backing store; a click 400 px into the view sought to 1.7500 s, the clicked time, through the unchanged pointer handling; the screenshot showed 0:01.50 at the view's left edge and labels each 0.1 s on; no page errors. Next: the clip canvases windowed the same way, the zoom limit and timeline cap raised, and real samples drawn when zoomed in.

### clip waveforms paint only what is in view (AU-13, groundwork)
- refers-to: frontend src/ui/lanes.ts :: paint (the window, its offset, notes, peaks and fades mapped through the clip's full width), mountLanes (the scroll and resize repaint); src/styles/shell.css :: .fw-wave
- kind: explainer
- logged: v1.77.0 (in progress) · 2026-10-04

The second canvas of the timeline windowed, as the ruler was: a clip's waveform canvas is placed over the part of its clip in view (right of the sticky track headers, within the stage), and everything drawn on it maps through the clip's whole width and the window's offset into it: the peak blocks, a note clip's notes and the fades, the fade curve traced only across the pixels in view (at deep zoom a fade can span millions of them). The canvas is absolutely placed, full size until its first paint; scrolling or resizing the lanes repaints the clips once a frame from their cached peaks. Verified in Chromium (sidecar verification/verify_wave_window.py, fixtures/step.wav: a second of silence then a second of a half-scale 1 kHz tone) at the current full zoom, scrolled to 0.9 s: the canvas sat 1440 px into a 3198 px clip, 560 px wide with a 560 by 85 backing store; 140 px into the view it held the 2 px silence line and from 155 px the tone's full 39 px, the tone shown from the peak block that holds 1.0 s (512 samples from 0.992 s, about 147 px in), the overview's own resolution, which is why the next step draws real samples when zoomed in; a hand scroll repainted it alike and at 1.0 s the tone filled the view; the ruler and the waveform agreed in the screenshot; no page errors.

### the lanes zoom to single samples and draw them (AU-13, sample view)
- refers-to: frontend src/ui/lanes.ts :: ZOOM_MAX, MAX_TIMELINE_PX, samplesPerPixel, RAW_BELOW, rawWindow (its chunk cache), paint (the samples drawn); src/ui/grid.ts :: STEPS; src/ui/ruler.ts :: label
- kind: explainer
- logged: v1.77.0 (in progress) · 2026-10-04

With the ruler and the waveforms painting only what is in view, the limits rise: the zoom ceiling from 16 (30 samples a pixel at 48 kHz) to 8000 (about 17 pixels a sample at 48 kHz, 8 at 96 kHz), and the timeline's cap from 16000 px to 16 million (under every browser's largest layout size: single samples on sessions up to about five minutes at 48 kHz; longer ones stop short). Found by the test: the cap's floor was rounded up (Math.ceil of length over cap), which never mattered at the old ceiling but held every session at one sample a pixel at least; it is now the plain ratio. Below 16 of the media's frames a device pixel, a clip draws the real samples in view, fetched from the samples route in chunks of 8192 frames (the 512 most recent kept) with the overview drawn until they arrive: each pixel's own minimum and maximum while it still spans several frames, then a line through the samples and a dot on each once they stand 6 px apart. Between 16 and 256 frames a pixel the overview's 256-sample blocks still draw, each 1 to 16 px wide. The ruler's label steps now reach 10 microseconds, a label carrying the decimals its step needs (two at least below half a second, as before, so ordinary zooms look unchanged). A correction to the windowing entry above: the overview's blocks are 256 samples, not 512; the block holding 1.0 s starts at 0.99733 s, 155.7 px into that view, which is where the test found the tone beginning. Verified in Chromium (sidecar verification/verify_deep_zoom.py) on the silence-then-tone fixture at the new ceiling, scrolled to 2.4 samples before 1.0 s: the clip laid out 1,599,998 px wide (2 s at 800000 px a second) with its canvas 560 px over the view; before 1.0 s the columns held only the zero line, and 12 samples after it, the tone's first peak, the drawn dot sat on half scale (rows 21 to 24 around row 23.4); the screenshot shows the samples as dots joined by a line, the rise starting at the ruler's 0:01.0000, labels every 0.1 ms; the ruler test at the old zoom passes unchanged; no page errors.

### the Draw tool in the lanes (AU-13, done)
- refers-to: frontend src/ui/draw-tool.ts; src/ui/lanes.ts :: setDrawPreview, sampleAt, repaintMedia (the stroke shown through the sample accessor); src/main.ts; backend app/services/tools.py :: draw (channel); app/routers/media.py :: media_draw
- kind: explainer
- logged: v1.77.0 (in progress) · 2026-10-04

A Draw toggle in the tool tray's edit group (a pencil drawn for it, currentColor). With it on and a clip zoomed in until single samples show (at most one of its frames a CSS pixel), a press on the clip draws, caught before the lanes' own press so selecting and moving do not run: the channel is the row under the pointer, every sample between one pointer position and the next takes the value under the pointer (interpolated, so a fast stroke leaves no gap), shown live through the lanes' sample accessor, and letting go sends the stroke (filled from the samples in view where it skipped none) to the draw route with its channel, swapping the clip's media as one undo step. The draw service writes one channel when given one, the others untouched, and every channel when not, as before. Zoomed out, the press says to zoom in and does what it otherwise does. Verified in Chromium (sidecar verification/verify_draw_lane.py, fixtures/lr.wav: a 1 kHz tone on the left, silence on the right) at sample zoom: a stroke across the right channel's row wrote 13 samples (frames 24006 to 24018), each 0.5236, the value at the pointer's height (the mouse moves in whole pixels); the left channel unchanged everywhere and the right outside the stroke; the notice "Drew 13 samples on the right channel (undo puts them back)"; undo restored the clip; no page errors. With the lanes zooming to single samples and drawing them, AU-13's three gaps are closed.

### MIDI effects on note tracks (PT-16)
- refers-to: frontend src/engine/document.ts :: MidiFx, Track.midiFx, set-track-midi-fx; src/audio/notes.ts :: applyMidiFx, renderNotes; src/ui/inspector-pane.ts (the MIDI effects row and list); src/ui/midi-input.ts (live notes and takes through them)
- kind: explainer
- logged: v1.78.0 (in progress) · 2026-10-04

Pro Tools' MIDI effect plugins as built-in MIDI effects on a note track, before the instrument, in order: Transpose (semitones; notes leaving 0 to 127 dropped), Velocity (scale and offset, held to 1 to 127) and Quantize (starts moved toward a grid of beats at the session's tempo by a strength). Non-destructive: a note clip keeps its notes as played and is rendered from them after the track's effects (renderNotes); changing the effects re-renders the track's note clips; live MIDI on the armed track is heard through Transpose and Velocity (each key's mapped pitch kept for its note-off), and a recorded take is rendered through them all. Verified in Chromium (sidecar verification/verify_midi_fx.py): a C4 and E4 clip with Transpose +7 added in the Inspector re-rendered equal in every sample to the notes rendered as G4 and B4, still holding C4 and E4; with Velocity x0.5 and Quantize to half a beat added, equal in every sample to the notes rendered transposed, halved and with E4 moved from 0.13 to 0.25 s; no page errors.

### the Stems view: realtime and rendered rebalance (RX-32, RX-66)
- refers-to: frontend src/engine/document.ts :: Track.stem, import-media's stem; src/ui/inspector-pane.ts (separation tags its stems; the Stems view, its handlers)
- kind: explainer
- logged: v1.78.0 (in progress) · 2026-10-04

Separate into stems now tags each stem's track with the track it came from and its part, in the same batch (one undo step). The Inspector's Stems view shows the group on any of its stems or on the source track: each part with its level (dispatched as it moves, so the rebalance is heard while playing), mute and solo, and Render rebalance, which sends the engine a session holding only the group at those settings, imports the mix on a new track and mutes the stems, one undo step. Verified in Chromium (sidecar verification/verify_stems_view.py) on a group tagged as the separation handler tags one (four tones as vocals, drums, bass, other of a muted source): the view listed the four parts, the vocals slider at -20 set that stem's level to -20 dB, and Render rebalance made a track equal to the engine's mix of the stems at their settings (largest difference 0) with the stems muted; no page errors. Demucs itself could not run in this container (its environment has torch 2.14, for which no torchaudio exists; the shipped requirements pin torch and torchaudio 2.6 together); separation was verified with Demucs in v0.81.0. RX-38 stays partial: a scene rebalance needs dialogue, music and effects stems, which Demucs does not make.

### drop-frame timecode, a session timecode start and a timecode ruler (PT-26, three of four)
- refers-to: frontend src/ui/shell.ts :: ClockMode (tc2997df), formatClock (startSeconds, drop-frame), parseTimecode, clockMode; src/engine/document.ts :: SessionDoc.timecodeStart, set-timecode-start; src/ui/inspector-pane.ts (the TC start field); src/ui/ruler.ts (timecode labels)
- kind: explainer
- logged: v1.79.0 (in progress) · 2026-10-04

The clock gains 29.97 drop-frame (SMPTE: real frames at 30000/1001 a second, frame numbers 00 and 01 skipped at each minute but every tenth, ';' before the frames) beside 24, 25 and 30 non-drop; every timecode reading adds the session's timecode start (Pro Tools' session start), set in the TC start field beside the tempo and read in the clock's rate (30 non-drop while the clock shows time); in a timecode mode the ruler labels in that timecode from the start, redrawn when the mode changes. Verified in Chromium (sidecar verification/verify_timecode.py): in drop-frame, start 00:00:59;29 read so and one frame later 00:01:00;02 (00 and 01 skipped), start 00:09:59;29 one frame later 00:10:00;00 (no skip at the tenth minute), 01:00:00;00 read back; at 25 fps 01:00:00:00 read back and 25 frames later 01:00:01:00; the ruler labelled 01:00:00:00, 01:00:01:00 and on; no page errors. Still missing for the row: picture.

### picture in step with the transport (PT-26, done)
- refers-to: frontend src/ui/picture.ts; src/styles/shell.css :: .fw-picture; src/main.ts
- kind: explainer
- logged: v1.79.0 (in progress) · 2026-10-04

A Picture toggle in the tool tray's View group opens a floating panel that shows a local video, muted (the session's sound is what plays), its start at the session's start: stopped, the frame at the playhead (within half a frame); playing, it plays alongside and is set back in step whenever it drifts more than 80 ms. Verified in Chromium (sidecar verification/verify_picture.py, a 4 s VP8 test video): stopped at 1.5 s the video sat at 1.5 s, paused; after 1.2 s of playing it read 2.712 s against the transport's 2.673 s (39 ms, inside the correction threshold and the transport's own reporting interval); stopping paused it; no page errors. With drop-frame, the timecode start and the timecode ruler, PT-26 is done.

### room tone for every gap between clips, moving between backgrounds (RX-01, done)
- refers-to: backend app/services/tools.py :: gap_tone; app/routers/media.py :: roomtone_gap (POST /api/roomtone/gap); frontend src/ui/inspector-pane.ts (Fill gaps with room tone)
- kind: explainer
- logged: v1.79.0 (in progress) · 2026-10-04

Fill gaps with room tone, in the track section, fills every gap of 10 ms or more between the track's clips at once (RX's Ambience Match under every edit), one undo step: for each gap the engine learns the power spectrum of half a second at each side (the end of the clip before, the start of the clip after), shapes two independent fresh noises by them and crossfades them at equal power across the middle half of the gap, so each side's background carries on past its edit for a quarter of the gap and the background moves from one to the other between (a drifting hum, a room that changes); 5 ms fades where it meets the clips; the fill is placed exactly in the gap on the same track. Found by the test: a crossfade over the whole gap left the left side's hum 20.8 dB over the right's in the gap's last 0.2 s; the middle-half crossfade fixed it. Verified in Chromium (sidecar verification/verify_gap_tone.py: a clip of low noise with a 60 Hz hum, a 1 s gap, a clip of white noise with a 250 Hz hum): the fill sat at 2.000 s for 1.000 s, the gap exactly; its first 0.2 s matched the left's band levels within 1.2 dB (60 Hz hum, 250 Hz, 2 to 8 kHz), its last 0.2 s the right's within 0.8 dB, its middle held both hums about 2 dB down; no page errors. With the learned fill inside a clip (v1.3.0), RX-01 is done.

### a sampler in the core and the engine (PT-15, first part)
- refers-to: native/formwav-dsp/src/synth.rs :: render_sampled, the test the_sampler_plays_its_sample_at_the_notes_pitch; src/python.rs :: render_sampled; backend app/routers/midi.py :: Sampler, RenderRequest.sampler, _render
- kind: explainer
- logged: v1.80.0 (in progress) · 2026-10-04

The built-in instrument gains a sampler: each note plays a session media (mixed to mono) re-pitched from a root note, read with linear interpolation, through the same envelope, velocity scaling and per-note mixing as the synth; the render route takes an optional sampler (media and root). Verified: the core's test (23 pass): at the root the sample plays as it is, an octave up every second sample exactly, velocity scaling it; through the engine, a 440 Hz sample with its root at A4: an A4 note equal to the sample (largest difference 0) at 440 Hz, an A5 note at 880 Hz equal to every second sample of it, and an unreadable sampler media answered with 422 (found on the way: the route first answered an unknown id with a bare 500; it now answers 404 for a missing media and 422 for an unreadable one). Next: the note track's instrument choice in the Inspector, and instrument plugins.

### CLAP instruments hosted offline (PT-15, second part)
- refers-to: native/formwav-host/src/instrument.rs; src/main.rs (fwhost instrument); fixtures/clap-sine (a test instrument); Cargo.toml, Cargo.lock (the fixture in the workspace)
- kind: explainer
- logged: v1.80.0 (in progress) · 2026-10-04

The plugin host plays CLAP instruments: `fwhost instrument <plugin.clap> <notes.txt> <out.wav> [rate] [seconds]` reads notes as `start length key velocity` lines (frames), opens the plugin as offline processing does (a bundle's others as file.clap#index), and runs it block by block with no audio input, each block's note-on and note-off events at their offsets within it (offs before ons at a shared frame), its stereo output written as the WAV. A test instrument joins the workspace beside the gain fixture: a sine per note at its key's pitch and velocity times 0.25, gated exactly by its note-on and note-off. Verified: two overlapping notes (A4 at velocity 127 from frame 4800 for 24000, A5 at 64 from 12000 for 9600) came back equal to the expected sines to 1.5e-8 (float32 rounding), exactly silent before the first note-on and after the last note-off, the first note's samples starting on frame 4800 (192 frames into a 512-frame block); the host's macOS check passes. Next: the engine and the Inspector offering a CLAP instrument beside the synth and the sampler.

### the note track's instrument: synth, sampler or a CLAP instrument (PT-15, done)
- refers-to: native/formwav-host/src/offline.rs (scan marks instruments); backend app/services/plugins.py :: instruments, play_instrument (instruments kept out of the effects catalogue); app/routers/midi.py :: GET /api/midi/instruments, RenderRequest.plugin; frontend src/engine/document.ts :: Instrument, Track.instrument, set-track-instrument; src/audio/notes.ts :: renderNotes; src/ui/inspector-pane.ts (the Instrument row)
- kind: explainer
- logged: v1.80.0 (in progress) · 2026-10-04

The host's scan reads a CLAP plugin's features and marks instruments; the engine lists them for note tracks (and keeps them out of the effects catalogue) and plays notes on one through the host, two seconds past the last note-off for its release. A note track's Instrument row offers Synth, Sampler (a session clip and its root note) and the installed CLAP instruments; a change re-renders the track's note clips through it, and renderNotes sends the instrument with the notes (the sampler with a near-flat envelope, so its sample's own shape comes through). Verified in Chromium (sidecar verification/verify_instruments.py; the test instrument fixture in ~/.clap): the engine listed it as an instrument, and one two-note clip switched in the Inspector equalled, in every sample, the engine's own render of the same notes on the sampler (a 440 Hz clip rooted at A4), on the CLAP instrument, and back on the synth, its instrument field gone; no page errors. With the sampler and the hosted instruments, PT-15 is done.

### several speakers recorded at once, each its own file and stem (AP-07, done)
- refers-to: frontend src/ui/record.ts (several armed tracks in one take, since v1.4.0); backend app/routers/render.py (stems)
- kind: verification
- logged: v1.81.0 (in progress) · 2026-10-04

AP-07's gap was written before PT-03 delivered recording several armed tracks in one take (v1.4.0) and tracks on one device sharing one stream (v1.12.0); this verifies it in AP-07's own terms. In Chromium with its fake microphone (sidecar verification/verify_two_speakers.py), two speaker tracks armed together (a click and a Shift-click) recorded one take: each track got its own take in its own file, on the timeline their overlapping audio identical (121728 frames, difference 0); the stems export held one file per speaker; one undo removed both takes; no page errors. One run placed the second take a block (512 frames) later than the first, as a recorder that joined the shared stream a block late is placed by the frame its capture started; the content stays aligned either way.

### windowed sources in the core (AP-05, first part)
- refers-to: native/formwav-dsp/src/render.rs :: SourceWindow, Player.alloc_source_window, write_source (the ring), mix (the read through it), the test a_windowed_source_plays_the_range_it_holds; src/wasm.rs :: fw_source_alloc_window
- kind: explainer
- logged: v1.81.0 (in progress) · 2026-10-04

A streamed source is allocated at its full length in the core's memory, so a file larger than that memory (a two-hour stereo file at 48 kHz is about 2.8 GB as floats, past what a 32-bit WebAssembly memory holds) cannot play. The core gains windowed sources: a ring of a set number of frames and the contiguous range it holds; a write carrying on from that range extends it, the oldest frames giving way, and any other write (a seek) starts a fresh range there; the one place the player reads source samples (mix) reads through the ring, silence outside the held range, the source's true length still ending its clips. Verified (24 core tests pass): a 10000-frame source in a 1000-frame window, written to frame 2500 in pieces, played frames 1500 to 2500 exactly and silence before and after; a jump to 7000 started a fresh range, the old one gone; writes stopped at the true length. Next: the streamer allocating long files as windows and keeping them filled ahead of the playhead, measured on a two-hour file.

### files larger than memory play from a window, a two-hour file measured (AP-05, done)
- refers-to: frontend src/audio/player.ts :: WINDOW_ABOVE_BYTES, WINDOW_SECONDS, AHEAD_SECONDS, StreamCtl (window, next, ahead, gen), focusStream, advanceWindow, pump, streamInto, loadInto, Player.coreMemory; src/audio/player-worklet.ts (alloc with a window, stats)
- kind: explainer
- logged: v1.81.0 (in progress) · 2026-10-04

A file whose floats would pass 512 MB streams into a window of the core (four minutes) instead of a source of its full length: its pieces are queued in order from the playhead and kept filled 150 s ahead of it twice a second as it plays (pieces the ring has overwritten forgotten, so a seek back fetches them again); a seek outside what is held starts the window afresh there, and a piece that was on its way before that is not counted as held. The worklet reports the core's memory for measuring. Verified in Chromium (sidecar verification/verify_two_hours.py, verify_two_hours_continuous.py) on a two-hour mono file at 48 kHz (345,600,000 frames, 691 MB, imported in 4 s), a 440 Hz tone whose level steps up each minute: played at minute 10 the meter read -21.5 dB and at minute 119 -0.7 dB, each the file's own peak there, the difference 20.8 dB as made, and back at minute 10 again -21.5 dB; sound came 1.47 s after Space the first time and 0.03 to 0.04 s after; played on for 160 s from 50:00, past the window's first fill, it reached 52.65 minutes still sounding minute 52's level (-7.8 dB), never quieter than minute 50's at any 5 s check; the core's memory 46 MB throughout, where the whole file as floats would need 1318 MB; no page errors.

### de-bleed through long paths: a room between the source and the mic (RX-05, long paths)
- refers-to: backend app/services/effects.py :: _levinson, debleed (path_ms, solve, the long refit); app/routers/media.py :: media_debleed (pathMs); frontend src/ui/inspector-pane.ts (the Path field)
- kind: explainer
- logged: v1.82.0 (in progress) · 2026-10-04

De-bleed fitted the leak's path as 128 taps after its delay (2.7 ms at 48 kHz), so a leak through a room was only partly caught. It now takes a path length (the Inspector's Path field, up to 500 ms; 0 keeps the 128 taps, whose fit is unchanged): a long path is solved by Levinson's recursion from its autocorrelation alone (O(n^2), its matrix of taps squared never built; no SciPy needed), loaded by 1e-3 of the power, and refitted toward the quiet moments from the weighted signals' own correlations. Found by the test, both mine: with the short path's 1e-9 load, a reference of held chord tones made the long fit unstable; and the short refit's masked cross-correlation is not positive definite, so at some lengths Levinson's recursion ran away on it (a 150 ms fit left the leak at -12.3 dB, worse than before). Verified (sidecar verification/verify_debleed_paths.py; Levinson equal to the dense solve to 2.1e-15 at 600 taps): a melodic line with a backing track leaking at -15 dB through 5 ms of delay and a 250 ms room, 20 s: the 128-tap fit left the leak at -22.90 dB under the line, paths of 50, 100, 150 and 300 ms at -29.79, -29.69, -29.58 and -28.95 dB, the line kept at 0.9995, each in under 2 s. RX-05 stays partial: without a reference, a moving leak is a separation problem.

### the dry sound restored, the room's reverb time estimated, three rooms measured (RX-12, done)
- refers-to: backend app/services/effects.py :: _estimate_rt60, _dereverb_wpe, _dereverb (rt60 0 estimated), PARAMS (dereverb, dereverb-restore), the chain table, the Repair group, NUMPY_EFFECTS
- kind: explainer
- logged: v1.82.0 (in progress) · 2026-10-04

De-reverb's suppression only quietens tails; restoring the dry waveform needs the late reverberation predicted and taken away. De-reverb: restore dry does it by weighted prediction error (WPE): in each frequency bin of a short-time spectrum the late reverberation of a frame is predicted from the frames 3 or more before it (the direct sound and early reflections stay), up to the reverb time's worth of frames, the prediction fitted three times weighted by the inverse of the restored power, computed by batched matrix products (einsum had made it slower than real time). The reverb time, in both de-reverbs at 0, is read from the audio: free decays in the 30 ms-smoothed energy above 100 Hz, fitted from 8 dB below their peaks as far as they fall (a long room shows only part of its decay between speech's pauses), the 20th percentile of their times (a room only stretches a decay). Found on the way: rooms at an unrealistic -17 dB direct-to-reverberant ratio and strictly periodic synthetic syllables had made my first test unfair to WPE; a real reading (LibriVox, public domain, sidecar fixtures/librivox_oread.wav) in rooms at 0 dB made it fair. Verified (sidecar verification/verify_dereverb_rooms.py), 20 s of the reading in rooms of 0.3, 0.6 and 1.2 s: estimated 0.34, 0.69 and 1.08 s (within 15%); restored against the dry sound by +0.9, +0.6 and +0.8 dB and against the direct sound with its first 30 ms by +2.0, +1.2 and +0.9 dB, faster than real time; Amount 0 returning the input to 1e-19; through the engine's effect route in the 0.6 s room the same gains, where the suppressing de-reverb moved the waveform match by only 0.2 dB.

### De-rustle: lavalier rustle found by a learned shape and cut by band (RX-13, done)
- refers-to: backend app/services/effects.py :: _derustle, PARAMS (derustle), the chain table, the Repair group, NUMPY_EFFECTS
- kind: explainer
- logged: v1.83.0 (in progress) · 2026-10-04

De-rustle learns the rustle's spectral shape from a stretch of it (Learn from and to, seconds of the clip's audio) and, in a short-time spectrum, finds frames whose shape over 24 log-spaced bands above 500 Hz is close to it (cosine) and whose energy jumps over the last 200 ms (rustle comes in bursts), a frame either side too; in them the rustle's level is read from the bands' ratios to the learned shape (40th percentile, leaning low where speech fills some bands) and each band is cut by what that level takes (Amount, floored at Floor), smoothed over frames. Each choice came from a measurement on a real reading (sidecar fixtures/librivox_oread.wav) with twelve synthetic rustle bursts: shapes per bin did not tell rustle frames (cosine 0.68) from speech frames (0.72), over bands they read 0.96; the burst test over everything above 500 Hz found 63% of rustle-dominated frames and 50% under speech with no fricative mistaken, where moving it above 2 kHz mistook up to 29% of the fricatives; the per-bin 25th percentile read the rustle's level at 0.29 of it, and per-bin cuts left a noise bin's random highs, so detected rustle-dominated frames lost only 3.6 dB until the cut moved to bands. Verified (sidecar verification/verify_derustle.py; through the engine's effect route alike): the rustle 16.70 dB under the speech went to 21.73 dB under it (5.0 dB less, 5.3 at sensitivity 80), the speech's SDR up by the same, and the clean speech run through it at any sensitivity came out untouched (no fricative cut). Its limits: without a learned stretch it finds nothing (iZotope's learned model needs no example), and the rustle measured is synthetic.

### fwnyq: Audacity's own Nyquist run on a clip (AU-28, first part)
- refers-to: native/formwav-nyquist/fwnyq.c, runtime/ (Audacity 2.4.2's nyquist/, one change in init.lsp), README.md
- kind: explainer
- logged: v1.84.0 (in progress) · 2026-10-04

AU-28 needs Nyquist. Rather than a new interpreter, formwav runs Audacity's own: libnyquist (Nyquist 3.15 and XLISP, BSD-style licences) from the Audacity 2.4.2 tag, built from the 209 sources its build file lists uncommented for Unix (defines CMTSTUFF and EXT), and a small driver over its nyx embedding API. Found on the way: my first source list read Audacity's commented-out lines and took instr.cpp for instr.c; the runtime's init.lsp aliases _, which Audacity defines in C for gettext (formwav's runtime copy makes it the identity, its one change); and nyx_get_audio returns TRUE on success where its callbacks return 0, which my first driver had inverted. Verified: Nyquist 3.15 starts clean on formwav's runtime, (+ 1 2) returns 3, print reaches stderr, and (mult *track* 0.5) on a 44100-frame tone returns exactly half of it (largest difference 0). Next: libnyquist's sources vendored and built with the driver, an engine route, and Audacity's plug-ins compared with Audacity 2.4.2's own output.

### libnyquist vendored, fwnyq built from formwav alone (AU-28)
- refers-to: native/formwav-nyquist/libnyquist (Audacity 2.4.2's lib-src/libnyquist without its classic Mac and Windows sources), plug-ins (Audacity 2.4.2's bundled Nyquist plug-ins), sources.txt, build_fwnyq, .gitignore
- kind: explainer
- logged: v1.84.0 (in progress) · 2026-10-04

formwav carries Audacity 2.4.2's libnyquist (Nyquist 3.15 and XLISP, BSD-style licences; 5.3 MB) as Audacity does, and its bundled Nyquist plug-ins beside the runtime; build_fwnyq compiles the 209 sources Audacity's build lists uncommented for Unix (sources.txt) with its defines into a static library and links the driver against it, libsndfile and portaudio (their development files needed, as for Audacity). Verified: built from formwav's tree alone, fwnyq ran (mult *track* 0.5) on the tone as before.

### the engine runs Nyquist prompts and Audacity's bundled plug-ins (AU-28, engine)
- refers-to: backend app/services/nyquist.py (header parsing, Audacity's preamble, run); app/routers/media.py :: media_nyquist (POST /api/media/{id}/nyquist), nyquist_plugins (GET /api/nyquist/plugins)
- kind: explainer
- logged: v1.84.0 (in progress) · 2026-10-04

The engine runs a Nyquist Prompt's code, or one of Audacity's bundled plug-ins with values for its controls, on a clip through fwnyq, after the settings Audacity 2.4.2's Nyquist effect gives a version 4 plug-in (read from its Nyquist.cpp: the *AUDACITY*, *SYSTEM-DIR*, *PROJECT*, *SELECTION* and *TRACK* properties, the latency, *tracenable*, each control as (setf var value) with reals to 14 significant digits); a sound comes back as new media, anything else as its value, and a failure as Nyquist's own error line. Plug-in headers are read as Audacity reads them, each found by a failure: version 4 headers start with $ (a parser reading only ; saw no names or controls); a choice list nests brackets and spans several lines (a regex lost all but one choice; the lines are joined while brackets stay open, comment lines among them skipped, which had put a translator's hint among Limiter's choices); a stray close bracket made my tokenizer loop for ever; and the $ lines, with their continuation lines, become comments before the code is evaluated (Lisp would run them; Audacity leaves them out). Verified: 18 bundled plug-ins listed with their controls (Adjustable Fade's four fade types, two units and thirteen presets; Limiter's four types); a prompt halving a tone exactly; a broken prompt answered with Nyquist's "unbound function - UNDEFINED-THING"; Adjustable Fade fading a tone up (gains 0.145, 0.545, 0.944 at 10, 50 and 90 per cent of it) and down (0.899, 0.499, 0.099). Next: the same plug-ins run in Audacity 2.4.2 and compared sample for sample, and the Nyquist Prompt and plug-ins in the interface.

### formwav's Nyquist equal to Audacity 2.4.2's in every sample (AU-28, verified)
- refers-to: backend app/services/nyquist.py :: _scan (quotes carried across lines), the header removal in run
- kind: verification
- logged: v1.84.0 (in progress) · 2026-10-04

Five cases, four of Audacity's bundled Nyquist plug-ins with their settings given explicitly (Adjustable Fade up, and down with a mid-fade curve of 30; Clip Fix at 95 per cent and -9 dB on a tone clipped at 0.7; Limiter, soft, at -6 dB with a 10 ms hold on a swelling tone; High-Pass at 1 kHz and 12 dB an octave), each run in Audacity 2.4.2 headless (dither off, exported at 16 bits) and in formwav: every case equal in every one of its 44100 samples (sidecar verification/nyquist_vs_audacity). Found by the comparison: Limiter's input-gain labels are quoted over two lines, and the header removal, counting brackets line by line, lost the quote at the line's end and took the rest of the plug-in's code for header (the plug-in returned 0); the bracket scanner now carries an open quote to the next line.

### Nyquist in the Inspector: the Prompt and Audacity's plug-ins (AU-28, done)
- refers-to: frontend src/ui/inspector-pane.ts (the clip section's Nyquist row: the plug-in menu, its controls, the code box, Apply)
- kind: explainer
- logged: v1.84.0 (in progress) · 2026-10-04

The clip section gains a Nyquist row: Nyquist Prompt or one of Audacity's bundled plug-ins; a plug-in's controls are drawn from its header (number fields with their ranges and units, menus for choices, text for strings), the Prompt's code box shown otherwise; Apply runs it on the selected clip and swaps the clip's audio as one undo step, or tells a result that is not a sound on the notice line, or Nyquist's own error. Verified in Chromium (sidecar verification/verify_nyquist_ui.py): the Prompt (mult *track* 0.5) left the clip exactly half of itself; Adjustable Fade drew its six controls and hid the code box, and with Fade Down chosen faded the clip down (gains 0.899, 0.499, 0.099 at 10, 50 and 90 per cent); the Prompt (+ 1 2) told "Nyquist returned int: 3"; no page errors. With fwnyq built from the vendored libnyquist and its output equal to Audacity 2.4.2's in every sample on five cases, AU-28 is done.

### Nyquist in the packaged app (AU-28, packaging)
- refers-to: build_macos_app; src-tauri/tauri.conf.json (externalBin); src-tauri/src/main.rs (FORMWAV_FWNYQ); native/formwav-nyquist/build_fwnyq (Homebrew's paths, -fno-common, libc++ on macOS); backend app/services/nyquist.py :: _bundled
- kind: explainer
- logged: v1.84.0 (in progress) · 2026-10-04

As the plugin host is, fwnyq is bundled beside the engine in the desktop app: build_macos_app builds it (libsndfile and portaudio from Homebrew; -fno-common as Audacity builds on Darwin; libc++, Apple having no libstdc++) and places it as a sidecar, the shell tells the engine where it is (FORMWAV_FWNYQ), and Nyquist's runtime and Audacity's plug-ins travel inside the frozen engine (PyInstaller data), where the service looks for them when frozen. Verified here: the build script still builds fwnyq on Linux and the shell's locked check passes with fwnyq among its external binaries; not run here: the macOS build (no Mac), which links fwnyq to Homebrew's libsndfile and portaudio, so the app needs them installed.

### de-bleed without a reference: a headphone click track (RX-05, done)
- refers-to: backend app/services/effects.py :: debleed_clicks; app/routers/media.py :: media_debleed_clicks (POST /api/media/{id}/debleed-clicks); frontend src/ui/inspector-pane.ts (Remove click bleed)
- kind: explainer
- logged: v1.85.0 (in progress) · 2026-10-04

Remove click bleed takes a headphone click track out of a clip with no reference. Sharp rises of the energy above 1 kHz are the candidates; the tempo is the period at which most of them have another one period on (the plateau's centre), refused below 25 per cent or under 2.5 times the share other periods get; the grid of beats is fitted to the clicks on it, refitted as each fit takes in more; the click's waveform is the median of clicks quiet on both sides; at every beat it is matched within 3 ms and subtracted. Every one of those choices came from a failure on the way: a median of intervals followed speech's consonants and took a clean reading for a click track; one grid fit from a 497 ms guess at a 500 ms track drifted 3 ms a beat, and its refits could not escape it until the guess was the plateau's centre; a template example inside speech pulled the mean's fit to the true click to 0.38; the residual first grew by 9.2 and 4.7 dB. Verified (sidecar verification/verify_click_bleed.py, verify_click_bleed_ui.py): a real reading with a 120 BPM click track leaking at about -26 dB of its peak: the click bleed went from 22.80 to 57.52 dB under the speech (34.7 dB of it gone; the clicks alone in the first second 36.8 dB down); the clean reading refused (its best share 11 per cent) and left untouched; the same through the Inspector, no page errors. Its limit: a continuous music leak without its source is a separation problem, still needing the reference (which de-bleed takes, through long paths since v1.82.0).

### wow and flutter without a held tone, measured against the truth (RX-51, done)
- refers-to: backend app/services/effects.py :: _speed_from_spectrum (unchanged); sidecar verification/verify_wow_flutter_truth.py
- kind: verification
- logged: v1.86.0 (in progress) · 2026-10-04

RX-51 was left partial on a measurement: the whole-spectrum mode took music without a held tone from 0.886% to 0.640% peak-to-peak within notes, read by the Hilbert frequency of each note's fundamental. That instrument reads 0.489% on the same music played at a steady speed: its own floor, so 0.640% said little about the tracker. Measured instead against the true speed curve, within the same note middles: 0.4% wow at 0.8 Hz (0.80% peak-to-peak) leaves 0.054% of error, 0.3% flutter at 4 Hz (0.60%) leaves 0.152%, and steady music 0.064%; within notes the mode corrects as fully as the held-tone mode (0.115%). What remains is the part no reference-free tracker can have: slow drift across notes cannot be told from intonation. A tracker by the partials' instantaneous frequencies, tried on the way, measured worse (0.243% on the flutter, about 0.3% rms everywhere) and was taken out again.

### fwnyq builds with Apple's clang (the macOS build failed on old C)
- refers-to: native/formwav-nyquist/build_fwnyq
- kind: fix
- logged: v1.87.0 (in progress) · 2026-10-05

The owner's macOS build stopped compiling libnyquist: Apple's clang refuses C's old implicit int, as clang 16 and later do, and three K&R definitions use it (cmt/midifile.c's metaevent and to32bit, nyqsrc/handlers.c); gcc 13 here only warned, and -w hid it. Reproduced with clang 18 on Linux, which refused the same three files and one more: xlisp/security.c calls getcwd without a prototype outside __APPLE__ and UNIX (on the Mac it has one; on Linux an undeclared getcwd returns an int, truncating the pointer, a latent fault in every earlier Linux build). The build script, the vendored sources untouched: C sources compile with -Wno-error=implicit-int (the K&R parameters mean int, as they always did), and security.c with unistd.h included; implicit function declarations otherwise stay errors, since they truncate pointers. Verified: all 209 sources compile with clang 18 and link (clang named in the binary), and that fwnyq equals Audacity 2.4.2's renders in every sample on the five Nyquist cases; gcc builds it as before.

### ASIO as an opt-in build feature; any sample format written (AU-23)
- refers-to: native/formwav-dsp/Cargo.toml (feature asio), Cargo.lock (asio-sys resolved, built only with the feature); src/native.rs :: hosts, devices, open, build_stream, write_frames, the test frames_are_written_in_any_sample_type; README.md (ASIO on Windows)
- kind: explainer
- logged: v1.87.0 (in progress) · 2026-10-05

The owner's decision: ASIO opt-in, so formwav's build stays Apache-2.0 while a build that opts in works correctly. The core gains an `asio` feature (cpal's ASIO host; asio-sys builds only on Windows and only with the feature, against an SDK the builder supplies through CPAL_ASIO_DIR). The native output lists and opens devices from the hosts offered, the platform's default and, with the feature on Windows, ASIO, whose devices are named "ASIO: name"; and it now writes 32-bit float, 32-bit or 16-bit integer samples, whichever the device takes (it refused anything but float before, and ASIO drivers mostly take 32-bit integers). Verified here: the writer's test (cpal's conversions; 0.5 as 16384 in 16 bits, 2^30 in 32; left on even channels, right on odd, nothing past the rendered frames); the core's tests (24, 25 with native); the native build and the asio feature on Linux (ASIO compiled out off Windows); asio-sys absent from the native build's dependency tree. Not run here: a Windows build with Steinberg's SDK and an ASIO driver.

### the app builds on macOS 27: build scripts and proc macros left unstripped
- refers-to: src-tauri/Cargo.toml ([profile.release.build-override] strip = false)
- kind: fix
- logged: v1.88.0 (in progress) · 2026-10-05

The owner's macOS build (macOS 27.0) got through the interface, the engine, the plugin host and Nyquist, then the app bundle stopped: "can't find crate for `phf_macros`" while compiling phf. Here the shell's full release build (strip and lto, as cargo tauri build runs it) succeeded, 281 crates, so the dependency set was sound. The cause, reported for this very crate in a Tauri build: [profile.release] strip = true also applies to build scripts and proc macros; with Xcode 27's strip their LINKEDIT string pool is left misaligned, macOS 27's dyld refuses to load them, and rustc reports the macro's crate as missing. Build scripts and proc macros never ship, so the release profile's build-override leaves them unstripped; the app's binary is stripped as before. A first edit put the section between strip and lto, so lto fell under build-override, which cargo refuses; corrected. Verified here: the release build passes (6 m 34 s), the app binary is stripped, the proc macros built after the change are not (phf_macros, serde_derive), and the change gives them new hashes, so a target directory holding broken stripped ones rebuilds them without a cargo clean. The release gate's shell check was cargo check, which never strips: it now builds the shell in release.

### the packaged app opened from Finder: Homebrew's tools found, microphone use declared
- refers-to: backend/desktop_entry.py :: tool_path; src-tauri/Info.plist
- kind: fix
- logged: v1.89.0 (in progress) · 2026-10-05

Found while writing the owner's checklist for the first real build, before it was run. An app opened from Finder gets a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so the engine, finding ffmpeg and rubberband with shutil.which, would have failed to import MP3, AAC and video audio, to export MP3 and to time-stretch, though the build's selfcheck, run in a terminal, found ffmpeg: the desktop entry now adds Homebrew's places (/opt/homebrew/bin, /usr/local/bin, /opt/local/bin) where they exist and are missing. And the app declared no microphone use: macOS refuses an app the microphone (and can end it) without NSMicrophoneUsageDescription; src-tauri/Info.plist declares it, merged by the Tauri CLI into the app's own (Tauri 2's documented way). Verified here: the plist parses; on a Finder PATH tool_path adds the places that exist, once however often it runs. To be seen on the Mac: an MP3 imported in the app opened from Finder, and recording asking for the microphone.

### fwvamp: Vamp analysis plugins hosted, equal to the SDK's reference host (AU-40, native part)
- refers-to: native/formwav-vamp/fwvamp.cpp, build_fwvamp, sdk/ (the Vamp plugin SDK 2.10's headers and host library, MIT-style licence), .gitignore
- kind: explainer
- logged: v1.90.0 (in progress) · 2026-10-05

AU-40 hosts Vamp plugins, the analysis plugins Audacity runs from its Analyze menu. fwvamp is altered from the SDK's own vamp-simple-host: the same block and step sizes, adapters (ADAPT_ALL_SAFE: input domain, channels, buffering), processing loop and feature timing by output type; it lists every plugin with its parameters and outputs, and runs one on a file with parameters set, reporting every output's features at once as JSON, each output with its own fixed-rate count, its descriptors read after initialise. Verified (sidecar verification/vamp_vs_reference): every output of the SDK's six example plugins on a mono and a stereo signal, 26 outputs of up to 13,010 features, equal to the reference host in counts, frames, durations, values and labels once the reference also reads its descriptors after initialise (one line in its source); the stock reference reads them before, and for the fixed tempo estimator's three fixed-rate outputs (declared 344.5 Hz before initialise, 689.1 Hz after) put neighbouring features on one frame. Found on the way, both in my comparison, not in fwvamp: a label beginning with a number ("120.4 bpm") read as a value.

### the engine runs Vamp plugins on a clip's media (AU-40, engine)
- refers-to: backend app/services/vamp.py (binary, list_plugins, run); app/routers/media.py :: vamp_plugins (GET /api/vamp/plugins), media_vamp (POST /api/media/{id}/vamp)
- kind: explainer
- logged: v1.90.0 (in progress) · 2026-10-05

The engine lists the Vamp plugins on the Vamp path (VAMP_PATH, else the SDK's defaults: on a Mac ~/Library/Audio/Plug-Ins/Vamp and /Library/Audio/Plug-Ins/Vamp) and runs one on a clip's media with parameters, returning every output's features; a missing plugin or an unbuilt fwvamp is answered with fwvamp's own message. Verified through the dev engine with the SDK's example plugins: six listed; percussion onsets on the test signal (bursts every 0.5 s from 0.25 s) found 16, at 0.244, 0.743, 1.242, 1.741 s and on, each within a block of its burst; a missing plugin answered 422 "no plugin nolib:noplugin on the Vamp path". Next: features placed as markers and regions (one undo step) from the Inspector, and fwvamp bundled in the desktop app.

### Vamp in the Inspector and in the desktop app (AU-40, done)
- refers-to: frontend src/ui/inspector-pane.ts (the clip section's Vamp row); build_macos_app; src-tauri/tauri.conf.json (externalBin); src-tauri/src/main.rs (FORMWAV_FWVAMP)
- kind: explainer
- logged: v1.90.0 (in progress) · 2026-10-05

The clip section gains a Vamp row: every plugin output on the Vamp path, its plugin's parameters drawn from its descriptors (numbers with their ranges and steps, menus for named values), and Analyze, which runs it on the selected clip and places the output's features as markers, or regions where they have a duration, where they fall on the timeline (the media's frames scaled to the session's rate; features outside the clip's trimmed span left out; at most 5000), as one undo step. fwvamp is built by build_macos_app and bundled beside the other helpers, the shell naming it to the engine. Verified in Chromium (sidecar verification/verify_vamp_ui.py), on a clip moved to 2 s: 13 outputs offered; the onset detector's parameters drawn with their defaults; its 16 onsets placed at 2.244, 2.743, 3.242 s and on (the engine's times plus the clip's start); one undo removing all 16; the tempo output a region from 2.003 to 10.000 s (its duration cut at the clip's end) labelled 120.4 bpm; no page errors. Built with clang 18 as on a Mac, fwvamp still equals the reference host on all 26 outputs. With fwvamp equal to the SDK's reference host, AU-40 is done; its run in the macOS app is on the owner's checklist with Nyquist's.

### MIDI input read by the engine for the desktop app (AU-37)
- refers-to: native/formwav-dsp/src/midi.rs (inputs, MidiListener, push and its test), Cargo.toml (midir in the native feature), Cargo.lock, src/lib.rs, src/python.rs (MidiInput); backend app/services/midi_live.py; app/routers/midi.py :: midi_devices, midi_stream, midi_test; frontend src/ui/midi-input.ts :: listenThroughEngine
- kind: explainer
- logged: v1.91.0 (in progress) · 2026-10-05

The macOS app's WebKit WebView has no Web MIDI, so a keyboard could not reach formwav there. The engine now reads MIDI devices itself: the core's native feature opens them with midir (MIT; CoreMIDI on macOS, ALSA's sequencer on Linux, WinMM on Windows) on a thread of their own, queuing each message (at most 4096, the oldest dropped); the engine lists them (GET /api/midi/devices, with the reason when there are none) and streams a device's messages as server-sent events (GET /api/midi/stream, one connection per page, opened before streaming so a missing device is answered 404 or 503); the page, finding no Web MIDI, listens to every device the engine lists, looking again every 5 s, and hands each message to the same handler Web MIDI feeds, so live playing, MIDI effects and recording behave alike. A test keyboard exists only when the engine runs with FORMWAV_MIDI_TEST=1 (fed by POST /api/midi/test, 404 otherwise). Verified: the queue's test (order, stamps, the limit dropping the oldest); the core's tests (24, 26 with native); the core with native type-checked for Apple silicon (midir's CoreMIDI backend, no errors); here, with no MIDI system, listing answers "MIDI support could not be initialized" without failing; in Chromium with Web MIDI removed, as in WebKit (sidecar verification/verify_midi_through_engine.py): the page listened to the engine's test keyboard, the output meter rose to 0.727 while A4 was held and fell to 0 after, and a recorded take became a note clip with C4 at velocity 100 and E4 at velocity 80, each 0.51 s; no page errors. Still to be seen: a real keyboard on the owner's Mac.

### the desktop app's engine had no native features: built with them, and the build now fails without them
- refers-to: build_macos_app (maturin --features python,native); backend/desktop_entry.py :: selfcheck (native_output, midi_input; exit 1 without them); frontend src/ui/midi-input.ts :: listenThroughEngine (the engine's reason told once)
- kind: fix
- logged: v1.92.0 (in progress) · 2026-10-05

The owner tested MIDI in the macOS app with the IAC Driver and SendMIDI: the notes went out, formwav did nothing and said nothing. The app's frozen engine (inspected from the owner's earlier upload) holds a formwav_dsp of 716 kB without NativeOutput, MidiInput or any CoreAudio: build_macos_app built the core with maturin --features python, and a --features flag replaces pyproject.toml's list (python and native) rather than adding to it, so every desktop build up to v1.91.0 left out native audio output and MIDI input (the owner's Output menu offered only Browser). Shown here: built that way the core has neither class (869 kB); with --features python,native it has both (1.66 MB). The development build, given no flag, takes pyproject's list, which is why nothing here saw it. Fixed three ways: build_macos_app names both features; the selfcheck it runs reports native_output and midi_input and exits 1 without them (shown with a stand-in core lacking them), so such a build now stops; and the page tells the engine's reason for having no MIDI once, where it had said nothing (shown in Chromium). The release gate now builds the core as build_macos_app does and checks both classes.

### the desktop app's interface had no audio core: built with it, and the release gate now builds from a fresh clone
- refers-to: build_macos_app (the interface step runs frontend/oc_install, then stops without dist/core/formwav_dsp.wasm); frontend src/audio/player.ts (the missing-core message names the real commands)
- kind: fix
- logged: v1.93.0 · 2026-10-05

The owner's Record in the macOS app answered "Could not start recording: the audio core is missing (404)". The page's audio core (the WebAssembly build of formwav-dsp: playback, recording, the live instrument) is placed in frontend/public/core by oc_install, which the release zips leave out as build output, and build_macos_app's interface step ran only npm install and npm run build: every desktop build lacked the core, and nothing here saw it, the gate building in a working tree where oc_install had long since placed it. The interface step now runs oc_install first and stops if the built interface lacks the core; the message named a script that does not exist and now names the real one. Verified from a fresh clone (only committed files, as the owner receives them): no public/core before; oc_install placed the core (155,880 bytes); the built interface held it and was byte-identical to the working tree's, 64 files; fwnyq and fwvamp built; every file build_macos_app reads present. The release gate now builds the interface from a fresh clone each time.

### nothing macOS loads is stripped: the engine's core refused by macOS 27 ("mis-aligned LINKEDIT string pool")
- refers-to: native/formwav-dsp/Cargo.toml, native/formwav-host/Cargo.toml, native/formwav-clap/Cargo.toml, src-tauri/Cargo.toml ([profile.release] strip = false); frontend/oc_install (the WebAssembly core stripped of debug info); backend/desktop_entry.py :: selfcheck (a core that cannot load told apart); frontend src/audio/player.ts (the message)
- kind: fix
- logged: v1.94.0 (in progress) · 2026-10-05

The owner's v1.93.0 build stopped at the new selfcheck: the frozen engine could not import formwav_dsp, dlopen answering "mis-aligned LINKEDIT string pool". Since Rust 1.77 a release profile with no debug info strips it (strip = "debuginfo"), which on macOS runs Xcode 27's strip, and that can leave a Mach-O's LINKEDIT string pool misaligned, which macOS 27's dyld refuses: the proc macros' failure of v1.88.0 again, now on the core itself, which loaded before only by luck (smaller, without its native features). Every crate whose output macOS loads now builds unstripped (the core, the host, the CLAP plugin, the shell, whose binary had loaded by luck too); the WebAssembly core keeps its stripping through CARGO_PROFILE_RELEASE_STRIP=debuginfo in oc_install (155,802 bytes rather than 1,805,569). The selfcheck told the owner the core was built without its native features when it could not be loaded at all; it now says which, quoting the loader. Verified here: the WebAssembly core at 155,802 bytes, served equal to the build; the core's tests; the engine's unstripped core loading with both classes; the selfcheck's three cases (a good core passes, one that cannot load and one built without the classes each fail with their own message). Not verifiable here: dyld on macOS 27, the owner's rebuild. A correction: v1.93.0's log said ./formwav_oc_install did not exist; it does (the owner ran it), and the message names it again.

### LV2 plugins hosted, equal to lilv's lv2apply (AU-27, LV2)
- refers-to: native/formwav-lv2/fwlv2.c, build_fwlv2, .gitignore; backend app/services/plugins.py :: lv2_binary, _lv2_scan, the lv2 branches of params and apply; build_macos_app (the helpers' libraries checked, fwlv2 built and bundled); src-tauri/tauri.conf.json (externalBin), src/main.rs (FORMWAV_FWLV2)
- kind: explainer
- logged: v1.95.0 (in progress) · 2026-10-05

LV2 joins CLAP, VST3 and LADSPA. fwlv2 follows lilv's lv2apply (ISC) where the two share ground (defaults from the ports' ranges, NaN taken as 0; controls by symbol; a mono file spread round-robin; with --block 1 its frame-by-frame processing) and goes beyond it: blocks of 1024, a mono plugin run once per channel of a wider file, a tail of silence, empty atom sequences, and the URID map, options and bounded block length many plugins require; a plugin needing a feature or port kind not provided is refused with the reason. The engine's scan lists LV2 plugins beside the others (refused ones with their reason), their controls become the Inspector's parameters by port index, and applying one runs fwlv2 with the tail. Verified (sidecar verification/lv2_vs_lv2apply): of 81 one-input SWH plugins run by both, 80 equal to lv2apply in every sample frame by frame, the 81st nondeterministic in lv2apply itself; in blocks of 1024 the differences are the plugins' own dependence on run length; a control by symbol, a mono plugin per channel of a stereo file, and a 1 s tail each checked against lv2apply or exactly; through the engine the catalogue offers "Simple amplifier (LV2)" among 255 plugins, its gain as p0, and applying +6 dB to a clip measured 6.000 dB. build_macos_app now checks the helpers' libraries up front (libsndfile, portaudio, lilv through pkg-config) and bundles fwlv2. AU-27 still lacks Audio Units and a run on the owner's Mac.

### formwav builds for Linux (verified end to end here) and Windows (a script, not yet run on Windows)
- refers-to: build_linux_app; build_windows_app.ps1; src-tauri/tauri.conf.json (the .deb's dependencies); build_macos_app (--force-reinstall); native/formwav-lv2/fwlv2.c (calloc for atom buffers), build_fwlv2, native/formwav-vamp/build_fwvamp, native/formwav-nyquist/build_fwnyq (static linking under MSYS2, no libdl there); backend app/services/vamp.py (the Linux multiarch Vamp path)
- kind: explainer
- logged: v1.96.0 (in progress) · 2026-10-05

The owner: formwav has to build for Windows and Linux too. build_linux_app mirrors build_macos_app (system libraries checked with the apt line that installs them; the engine's wheel unrepaired, being only for this machine's PyInstaller; the Tauri CLI from npm when cargo's is absent; a .deb declaring libsndfile, portaudio, lilv and ALSA beside the WebKitGTK and GTK Tauri adds). Run here from start to finish: the frozen engine passed its selfcheck, the .deb (49.6 MB) installed with apt, and the installed app ran on a virtual display, its interface drawn (sidecar verification/linux_app_v1.95.0.png: Engine 1.95.0, the MIDI notice telling there is no MIDI system here), its own engine answering health at 1.95.0, listing 107 LV2 plugins, and running Nyquist through the installed fwnyq ((+ 2 3) gave 5). The installed app found no Vamp plugins: Debian and Ubuntu put them in /usr/lib/<multiarch>/vamp, which the vendored SDK's default path leaves out; on Linux the engine now adds every multiarch directory there is (6 found with VAMP_PATH unset). build_windows_app.ps1 mirrors the same steps for Windows 10 and 11: Rust's MSVC toolchain for the shell, the plugin host and the audio core; PyInstaller with Windows' ; separator; the C helpers built by the same scripts inside MSYS2's UCRT64 shell (libsndfile, portaudio, lilv from its packages) and linked statically, one self-contained .exe each; an NSIS installer. Made portable for it: fwlv2's atom buffers from calloc (Windows' C runtime has no aligned_alloc; atoms need 8-byte alignment), fwvamp without libdl under MSYS2, the three helpers linked with pkg-config --static there. Not run on Windows: that needs a Windows machine. Found on the way: build_macos_app installed the rebuilt core without --force-reinstall, so at an unchanged version pip kept the old one (the owner's v1.93.0 log); all three scripts now force it. My own slip, recorded: pkill -f formwav-desktop matched the shell running it and ended the command; processes are matched by exact name.

### The plugin host builds for Windows; checks of the Windows build from Linux
- refers-to: native/formwav-host/src/offline.rs :: Vst3Library, vst3_enter, vst3_leave, vst3_open, vst3_close; src/main.rs :: run_vst3, run_clap_gui and run_vst3_gui (Unix only, Windows answers), vst3_binary (the Windows bundle layout)
- kind: explainer
- logged: v1.96.0 (in progress) · 2026-10-05

Checked for Windows from here (the MSVC target added to Rust): the core with python and native compiles (WASAPI output, WinMM MIDI); the plugin host did not (31 errors): it loaded VST3 modules through libloading's Unix API and polled file descriptors with libc for its X11 editors. Now a VST3 module is entered and left in one place as the VST3 SDK specifies per platform (ModuleEntry and ModuleExit on Unix, InitDll and ExitDll on Windows), a Windows bundle's binary is found in Contents/x86_64-win, and the editor windows (X11) are built on Unix only, the Windows editor commands answering that they are not available there yet (native windows: not built). The host checks for Windows and both Mac architectures; on Linux it builds without a warning, the CLAP fixture measures -6.02 dB, and a real Linux VST3 (Airwindows Consolidated, its Linux release) passes through the ported path: the self-test loaded and processed it, and an offline render gave every frame, finite. The same download's LV2 build is hosted by fwlv2 (a modern plugin with atom ports: listed as supported, rendered within 0.3 dB of its VST3 build; Airwindows dithers with random seeds, so no two renders are equal); its effect settings are LV2 patch properties, which fwlv2 does not set (it runs such a plugin at its defaults). Cross-compiling the C helpers with MinGW-w64 (MSYS2's compiler family) against the libraries' headers: fwnyq.c compiles, and libnyquist does not yet (ulong and ushort, netinet/in.h, sys/resource.h): the vendored copy kept only Audacity's sys/unix files; Audacity's Windows build uses its sys/win/msvc files (switches.h, winfun.c, winstuff.c), to be restored from the same 2.4.2 tree and chosen under MSYS2.

### The Windows build's C helpers: compiled and linked for Windows from here
- refers-to: native/formwav-nyquist/libnyquist/nyquist/sys/win/msvc/ (Audacity 2.4.2's six Windows system files, restored), build_fwnyq (sys/win/msvc under MSYS2; include flags and the static link's system libraries named); native/formwav-vamp/build_fwvamp; native/formwav-lv2/build_fwlv2 (lilv's family dynamic, its DLLs copied), .gitignore; build_windows_app.ps1 (the DLLs placed); src-tauri/tauri.windows.conf.json (the DLLs installed beside fwlv2)
- kind: explainer
- logged: v1.96.0 (in progress) · 2026-10-05

Every C source of the three helpers now compiles with MinGW-w64 (MSYS2's compiler family): libnyquist's 209 once Audacity 2.4.2's sys/win/msvc files were restored (the vendored copy had kept only sys/unix; Audacity's Windows build takes its switches.h, which defines WINDOWS for the shared headers), the Vamp SDK's host sources and fwvamp (12), and fwlv2 without a warning. Then the build scripts themselves were run in their Windows branch against MSYS2's own MINGW64 packages (libsndfile 1.2.2, portaudio 19.7.0, lilv 0.26.4 and every library they use), with uname reporting MINGW and pkg-config pointed at them, on copies of the folders: all three link. What the links found: MSYS2's portaudio .pc declares no system libraries and FLAC's omits pthreads, so a static link needs them named (pthread; winmm, ole32, uuid, setupapi, ksuser, dsound; shlwapi); and the lilv family ships as DLLs only, so fwlv2 links it dynamically and ships its five DLLs (liblilv-0, libserd-0, libsord-0, libsratom-0, libzix-0: the whole closure, read with objdump) beside it, placed by build_windows_app.ps1 and installed by tauri.windows.conf.json, which Tauri merges on Windows only. Imports read with objdump: fwnyq.exe (7.4 MB) and fwvamp.exe (6.2 MB) only Windows system DLLs, self-contained; fwlv2.exe (3.9 MB) system DLLs and liblilv-0.dll. build_windows_app.ps1 parses with no error in PowerShell 7.6.6. On Linux the helpers are unchanged: fwlv2 equal to lv2apply on 80 of 81, fwvamp on 26 of 26. What only a Windows machine can show: that they run, that the installer places the DLLs beside fwlv2.exe, and the engine's PyInstaller step.

### Subtitle files from the transcript (the comparison page's Captions row)
- refers-to: frontend/src/ui/subtitles.ts :: subtitleCues, balanceLines, toSubRip, toWebVtt; ui/transcript-pane.ts (the Subtitles (SubRip) and Subtitles (WebVTT) buttons and their action); ui/labels-pane.ts :: download (exported)
- kind: explainer
- logged: v1.97.0 (in progress) · 2026-10-05

The owner's comparison page (v10, formwav against thirteen tools) left Captions, subtitles and chapters partial: the transcript made a captioned video but no subtitle file. The Transcript pane now exports its words as SubRip and WebVTT, in session time, by the conventions most subtitle guidelines share: at most 42 characters a line and two lines a cue, broken at the word nearest the middle; at most 7 s a cue, the shortest held to 5/6 s where the next cue allows; a new cue at a change of speaker, a sentence's end or a pause of 0.6 s or more; fillers left out; with several speakers, a turn's first cue begins with the speaker's name. Checked in Chromium on a real recording transcribed by the local model, in a scratch run not kept (no test scripts are kept unless the owner asks): both files from the buttons, no cue breaking a rule (the longer cue exactly 7.000 s in lines of 41 and 37 characters), the cues' words equal to the transcript's 22 in order, ffprobe reading both files as 2 cues without error; and after deleting the first three words in the transcript, a fresh export without them, every later cue earlier by the cut. No COVERAGE row changes: the page's row, not a parity row (AU-43's label subtitles and DS-08's captioned video were done).

### A track chooses the channels of its device it records (the comparison page's Multitrack recording row)
- refers-to: frontend/src/ui/inputs.ts :: trackChannels, setTrackChannels; src/audio/recorder.ts :: openInput (every channel the device has), startRecording (pick: the shared stream split, the chosen channels merged into the track's recorder); src/ui/record.ts (each armed track's choice passed); src/ui/inspector-pane.ts (the Channels in field after Input)
- kind: explainer
- logged: v1.97.0 (in progress) · 2026-10-05

The comparison page left Multitrack recording partial: tracks on one device shared its stream and lined up exactly, but every track took the device's first one or two channels. The input now opens with every channel the device has (a mono or stereo device gives what it gave before), and a track can choose one channel or a pair of its device in the Inspector (Channels in: As the device gives, 1 to 8, 1 and 2 to 7 and 8); its recording splits the shared stream and merges only those channels into its recorder, so its level, monitoring and take hold them and the device's other tracks are untouched; with no choice the take is as before. Checked in Chromium with a two-channel input (440 Hz on channel 1, 1000 Hz on channel 2), scratch runs not kept: two tracks on that one device set to channels 1 and 2 and armed together recorded mono takes holding only their own tone (440 Hz 81 dB with 1000 Hz at -38 dB; 1000 Hz 81 dB with 440 Hz at -115 dB); a take as the device gives was stereo with both tones as before; simultaneous clicks on both channels landed on the same session sample in both takes, every click (the alignment of tracks on one device kept). Two layout shifts seen in those runs (0.0063 on the first import, the media list; 0.09 on the first clip selection, the Inspector) were measured identical with this change stashed: inherited, recorded in BUILD_NOTES and to be fixed. Found on the way, in the checks rather than the code: a click arms one track and Shift-click adds one (arm.ts), and Playwright's select_option matches a string against labels as well as values. Still open in the row: tracks on different devices drift about 2 ms apart.

### The repair assistant (the comparison page's Automatic diagnosis row)
- refers-to: backend/app/services/repair_assistant.py :: features, material, clicks_per_minute, analyse, apply; app/routers/media.py :: media_repair_assistant, media_repair_assistant_apply; frontend/src/ui/inspector-pane.ts (the Repair assistant block after Mic check); src/styles/workspace.css :: .fw-repair-findings
- kind: explainer
- logged: v1.98.0 (in progress) · 2026-10-05

The page: no assistant that analyses and proposes a chain (RX's Repair Assistant analyses voice, tonal, percussion or effects material and proposes fixes at three intensities). analyse types a clip's material from four measured features (the envelope's syllabic modulation, 2 to 8 Hz of 0.3 to 30; spectral flatness; the share of the 20 strongest bins, peakiness; sharp onsets a second; pauses): percussive with at least 2 onsets a second and flatness 0.1 or more, then voice with syllabic modulation 0.28 or more, then tonal with peakiness 0.6 or more, else effects. Its findings reuse mic check's measurements (clipping, mains hum, the noise floor, loudness) and add isolated clicks (spikes in the first difference twelve times the local level, their millisecond around them below a quarter of them) and room reverb from the engine's own reverb-time estimate (above 0.65 s, read with the mains harmonics removed when hum was found: a steady hum read as a slow decay). Noise is judged for voice only (-30 dB beside hum, its residue; -50 dB without), hum outside voice only above -20 dB. Each finding becomes a catalogue effect in RX's repair order (de-clip, click removal, adaptive de-hum, denoise, dereverb, loudness) with settings stepped for Light, Medium and Heavy; apply renders the chain into one new media, and the Inspector puts it on the clip as one set-clip-media batch, one undo step. The block is always present with a fixed-height list, so analysing moves nothing below it. Checked in scratch runs, not kept: JFK's speech clean and degraded one problem at a time (hum, forty clicks, clipping, noise at -40 dBFS, a 0.9 s room) and three other materials (a chord, noise bursts, band noise) typed correctly, nine of nine; each degraded case found with its own problem and clean speech, the chord and the band noise with none (beyond level where it was off); Medium repairs re-measured: hum -12.4 to -34.6 dB, clicks 169 to 0 a minute, full-scale samples 17851 to 0, noise floor -30.2 to -42.0 dB, reverb time 0.93 s to 0.71, 0.47 and 0.39 s at the three intensities. In Chromium under 4x CPU throttling: the hum case analysed through the block, Medium applied (hum -12.4 to -35.4 dB by mic check), one undo restoring the original, the block reset on selecting another clip, the clean clip offering nothing to repair, and no layout-shift entry while analysing or repairing. Three first-draft faults were found by those runs and fixed: a flatness measure that could not tell speech from band noise, a click test that took speech transients for clicks, and hum read as reverb.

### The two inherited layout shifts fixed (DOM law)
- refers-to: frontend/src/ui/media-pane.ts (the empty note as the list's data-empty placeholder); src/styles/workspace.css (.fw-media-list's placeholder rule, the old tab rule removed); src/ui/inspector-pane.ts (the Master effects and Time track block first and always shown, Clip effects shown with a selected clip)
- kind: explainer
- logged: v1.99.0 (in progress) · 2026-10-05

Found at v1.97.0 and older than it: 0.0063 on the first import and 0.09 on the first clip selection. The Media pane's empty note was a paragraph above the list, hidden on the first import, so the list rose 66 px; it is now the list's own placeholder (a data-empty attribute drawn by a ::before rule, its text kept in the code), gone in the frame the first row takes its place. The Inspector showed the session summary, Clip effects, then Master effects with the Time track, and a clip's selection revealed about 3500 px of clip and track sections between them; the session-wide block now comes first and is shown from the first paint (shown only once tracks existed, it moved the summary 360 px on the first import, a jump the layout-shift observer did not report because the summary's text changed in the same frame, so it was measured by position), and Clip effects, acting on the selected clip alone, shows with a selected clip, after its properties. Checked under 4x CPU throttling in scratch runs, not kept: the list at 134 px before and after the first import with its first row where the placeholder was; the Master block at 76 px and the summary at 436 px on an empty page, after the first import and (the summary then hidden) with a clip selected; no layout-shift entry along either path; a master effect added through the moved block.

### ADM BWF objects written, read and rendered by the EBU's renderer (the comparison page's Surround row, first part)
- refers-to: backend/app/services/adm.py :: azimuth_of, write_bwf (and its _pcm24, _chunk, _axml, _chna)
- kind: explainer
- logged: v1.99.0 (in progress) · 2026-10-05

The page: no Atmos or other object formats. ADM BWF (the Audio Definition Model of ITU-R BS.2076 in a broadcast WAVE file per BS.2088) is the open interchange behind Atmos masters and MPEG-H: write_bwf puts each object on its own mono channel of 24-bit PCM, a chna chunk tying each channel to its audioTrackUID, audioTrackFormat and audioPackFormat, and an axml chunk holding the ADM document (a programme, its content, one object per channel with an Objects pack and channel format whose block holds the position, the PCM stream and track formats, the track UIDs). azimuth_of turns a place on formwav's surround pad (x from left to right, y from behind to ahead) into ADM's azimuth, positive to the left, 0 ahead, 180 behind. Checked with the EBU ADM Renderer (EAR 2.1.0, BSD-3-Clause-Clear, in its own environment, setuptools added for its pkg_resources import), scratch runs not kept: each file parsed, its chna read back with the IDs the axml uses, and objects rendered where their places say: ahead to the centre 100%, 30 degrees left to M+030 100%, the pad's hard left (90 degrees) between M+110 and M+030 (87%, 13%), -110 degrees to M-110 100%, and 30 degrees up ahead on a 4+5+0 layout to U+030 and U-030 (49% each). Next: the session's placed tracks exported as these objects, through a route and the export menu.

### The session exported as ADM objects (the comparison page's Surround row; PT-25 partly)
- refers-to: backend/app/services/adm.py :: export_session, _float_wav; app/routers/render.py (what=adm); frontend/src/ui/export.ts (the Objects option, the kind's type), src/io/render-client.ts (the kind's type)
- kind: explainer
- logged: v2.0.0 (in progress) · 2026-10-05

Export's Objects choice writes the session as an ADM BWF file: each track placed on the surround pad is rendered alone (the stems' way: the others muted, solos cleared), summed to mono and written as an object at its place (the pad's azimuth and its elevation in degrees, as ambisonics reads them); unplaced tracks are left out, and a session with none placed is refused with what to do. Checked end to end in a scratch run, not kept: three tone tracks (500, 1000 and 2000 Hz) placed at 30 degrees left, -110 degrees and 30 degrees up ahead, exported through the dialog (Untitled session adm.wav, no page error), parsed and rendered by the EBU ADM Renderer to 4+5+0: 500 Hz to M+030 100%, 1000 Hz to M-110 100%, 2000 Hz to U+030 and U-030 49% each; three objects in its chna. Still open for PT-25 (Dolby Atmos mixing and rendering): monitoring the objects in formwav through a renderer, a bed beside them, objects moving over time, and Dolby's own tools on the file.

### Echo, chorus and a limiter as realtime inserts (the comparison page's Realtime effect inserts row, first step)
- refers-to: native/formwav-dsp/src/fx.rs :: ECHO, CHORUS, LIMITER, Echo, Chorus, Limiter, Stage (variants, design, process, reset); backend/app/services/render.py :: FX_KINDS, _stage; frontend/src/engine/document.ts (EchoFx, ChorusFx, LimiterFx, the normalizer and the known kinds, filter automation skipping them); src/audio/player.ts (flatFx, flatStages, flatFxAuto); src/ui/lanes.ts (rowFilter, the automation lane picker); src/ui/inspector-pane.ts (labels, defaults, controls, the four add menus)
- kind: explainer
- logged: v2.1.0 (in progress) · 2026-10-05

The page: only seven effect types ran live. Three of the catalogue's most used families now run as realtime kinds in the core, on clips, tracks, buses and the master, live in the page (WebAssembly) and in exports (the same code): an echo (delay 1 to 2000 ms, feedback to 0.95, mix; out = dry + mix x delayed, fed back), a chorus (rate, depth, mix around a 15 ms delay, the channels a quarter turn apart, read between samples) and a peak limiter (ceiling, release; the channels linked, the gain falling at once so no sample passes the ceiling, recovering with the release). Each fits the clip chain's three parameters. Checked in Chromium under 4x CPU throttling through the Inspector, scratch runs not kept, the export path measured: echo at 250 ms, 0.5, 0.6 returned an impulse at 0.75, 1.0, 1.25 and 1.5 s at 0.6, 0.3, 0.15 and 0.075 of it; chorus at 0.5 Hz, 3 ms, fully wet swept its delay from 12.0 to 18.0 ms with a 2.00 s period; the limiter at -6 dB held a full-scale sine to -6.00 dBFS and left the quiet part within 0.001 dB of the render without it; a second of live playback with the echo, no page error. On a clip, an echo's repeats end with the clip (the reverb's tail path is its own); on tracks, buses and the master they ring on. Found: adding an effect row moves what is below its list (0.0036 here), an inherited behaviour of every realtime list, recorded in BUILD_NOTES.

### Realtime effect lists at a fixed height (an inherited layout shift fixed, DOM law)
- refers-to: frontend/src/styles/workspace.css :: .fw-rtfx-list, .fw-rtfx-list:empty::before
- kind: explainer
- logged: v2.2.0 (in progress) · 2026-10-05

Every realtime list (clip, track, bus, master) grew in the flow, so adding or removing a row moved whatever followed it. Rows measure 118 to 175 px at the Inspector's width (a filter 118, a compressor 175), so each list now holds a fixed 150 px, one row in full and more by scrolling inside it, with a line saying so while it is empty, as the repair assistant's list keeps a fixed height. Checked under 4x CPU throttling in a scratch run, not kept: the placeholder shown while empty; the master list's Add row, the Time track heading and the summary at 265, 301 and 586 px before, after three adds and after a removal; the list scrolling 480 px of rows in its 150; no layout-shift entry, no page error.

### Tremolo, gate, phaser and flanger as realtime inserts (the comparison page's Realtime effect inserts row, second step)
- refers-to: native/formwav-dsp/src/fx.rs :: TREMOLO, GATE, PHASER, FLANGER, Tremolo, Gate, Phaser (turnover), Flanger, Stage; backend/app/services/render.py :: FX_KINDS, _stage; frontend/src/engine/document.ts; src/audio/player.ts; src/ui/lanes.ts; src/ui/inspector-pane.ts
- kind: explainer
- logged: v2.2.0 (in progress) · 2026-10-05

Four more realtime kinds in the core, the same five places as echo, chorus and the limiter, each within the clip chain's three parameters: a tremolo (the gain swung between 1 and 1 - depth at the rate, the right channel's swing up to half a turn behind for an auto-pan), a gate (linked; open while the peak, held 10 ms, reaches the threshold, opening in 1 ms and closing with the release down to its range), a phaser (four first-order all-pass stages whose turnover sweeps from 200 Hz up by the depth in decades, fed back, mixed half and half) and a flanger (a delay swept from 1 ms up by the depth, read between samples, fed back, mixed half and half). Fifteen live kinds in all. Measured through the Inspector and the export path in scratch runs, not kept: the tremolo at 4 Hz and depth 0.5 swung its envelope from 1 to 0.500 at 4.00 Hz; the gate at -30 dB left the loud part at -0.00 dB and took the quiet part toward its -60 dB range (-56.5 dB averaged over a window still inside the 50 ms release's settling); the phaser's first notch, sought near where the LFO puts it (the turnover times tan(pi/8)), followed it from 84 to 820 Hz with a median error of 2.0% and notches about 21 dB deep; the flanger swept its delay from 1.00 to 4.00 ms over 2.00 s. Found on the way, in my checks rather than the code: the dev engine runs under uvicorn's --reload, which watches app/ and not the rebuilt core in site-packages, and my pattern for stopping it missed its real command line, so a first run measured the old core (no effect at all); a fresh process rendered the captured document correctly, and the restarted engine then did too.

### A step sequencer that places note clips (the comparison page's Pattern sequencer and clip launching row, first part)
- refers-to: frontend/src/ui/step-sequencer.ts :: patternNotes, mountStepSequencer; src/ui/media-pane.ts (mounted in the Create tab after Generate); src/styles/workspace.css (.fw-steps-grid, .fw-steps-row, .fw-step)
- kind: explainer
- logged: v2.3.0 (in progress) · 2026-10-05

The page: no pattern sequencer and no clip launching. The Create tab now holds a step sequencer: four rows of sixteen sixteenth-note steps, a pitch per row (C5, G4, E4 and C4 to start), the bars to repeat (1 to 16), and Place pattern, which renders the lit steps through the engine's note render (/api/midi/render, the path a MIDI take takes) and places them at the playhead as an ordinary note clip at the session's tempo (120 BPM without one), so the piano roll, the track's instrument and exports treat it as any note clip. The grid is drawn once; a step's toggle changes its aria-pressed alone. Checked in Chromium under 4x CPU throttling in a scratch run, not kept: six steps lit over two bars placed twelve notes, every one at a multiple of a sixteenth (6000 samples at 48 kHz and 120 BPM: 0, 12000, 24000, 48000, 60000 and 72000, then the same 96000 later), the rendered audio beginning within 22 samples of each note (the synth's attack crossing the measure's threshold), no layout-shift entry, no page error. Still open in the row: clip launching (the player looping clips and starting them on the bar).

### A clip launcher, scenes by tracks, on the next bar (the comparison page's Pattern sequencer and clip launching row, second part)
- refers-to: frontend/src/engine/document.ts :: Clip.launched, the launch-clip and stop-launched commands, endLaunched; src/ui/launcher.ts :: mountLauncher; src/ui/media-pane.ts (mounted after the step sequencer); src/styles/workspace.css (.fw-launch-scroll, .fw-launch-grid, .fw-launch-name)
- kind: explainer
- logged: v2.4.0 (in progress) · 2026-10-05

The Create tab holds a clip launcher: four scene rows by a column per track, a media file chosen per cell, a launch button per cell, a stop per track, a Scene button per row and Stop all. A launch lands on the next bar at the session's tempo and meter and writes the media's repeats (Loops, 1 to 64) onto the track from there as ordinary clips marked launched, after ending the track's launched material at that bar (a track plays one launched clip at a time); a stop ends a track's launched material on the next bar (later repeats removed, one crossing the bar shortened), never touching clips placed by hand. So launching records into the arrangement as a session performance is recorded, and the player, exports and undo treat the repeats as clips; a scene and Stop all are one batch, one undo step. Slots hold media, not arrangement clips, so a launch never doubles a clip already playing on its track. Columns are added and removed per track, never rebuilt, in a box whose sideways scrollbar is always reserved. Checked in Chromium under 4x CPU throttling, a scratch run not kept, with two one-bar media at 120 BPM: scene 1 launched from 1.3 s wrote repeats on both tracks at 96000, 192000, 288000 and 384000 (bar 2 on, a bar apart); track 1 stopped from 4.5 s kept 96000 and 192000 (its launch ending on bar 4) and left track 2's four; one undo restored the stop and a second removed the whole scene; a single slot from 0 s launched track 2 from 0; no layout-shift entry, no page error.

### Parity rows recounted against what shipped (RX-36 done; PT-03 narrowed)
- refers-to: the sidecar's COVERAGE.md (RX-36 to the done list; AP-08 and PT-03 rewritten)
- kind: explainer
- logged: v2.5.0 (in progress) · 2026-10-05

The owner asked why the parity count barely moved while the comparison page's rows closed. Two reasons: most of the page's rows map to no open parity row (subtitles from the transcript, the step sequencer, the launcher), and two shipped pieces had met parity rows without COVERAGE being updated. RX-36, defined as a repair assistant with material types and three intensities, is exactly v1.98.0's repair assistant: done (194 done, 20 partial). PT-03's gap no longer lists channel mapping inside a device (v1.97.0); it still lacks exact alignment between different devices and more than three inputs measured. From now on each shipped piece is checked against the open parity rows' own definitions when it lands.

### Audio Unit hosting, written and compiled here, to run on the owner's Mac (AU-27's last part)
- refers-to: native/formwav-host/src/au.rs :: list, process, params, check; src/main.rs (mod au, the au-check command); src/offline.rs (scan lists Audio Units, process renders through them); src/params.rs (an Audio Unit's parameters)
- kind: explainer
- logged: v2.5.0 (in progress) · 2026-10-05

AU-27 lacked Audio Units and a macOS run. fwhost now lists every effect and music-effect Audio Unit (AudioComponentFindNext), addressed by its component identity as four-character codes (Apple's AUDelay is aufx:dely:appl), reads its parameters (the parameter list and info), and renders a file through it offline: non-interleaved float stereo in 512-frame slices, the input supplied by a render callback that reads at the time stamp's sample time, parameters set by id, the unit's reported latency taken off the front. AudioToolbox's and CoreFoundation's few functions are declared in the module, as mac.rs declares CoreFoundation's. The engine's plugin service needs no change: scan entries of format au join the catalogue labelled (AU), and apply and params go through fwhost as for the other formats. fwhost au-check is the owner's check on a Mac: AUDelay at 0.1 s fully wet must move an impulse 4800 samples at 48 kHz, and AULowpass at 1 kHz must pass 200 Hz and cut 8 kHz; it prints the measurements. Here: the host builds for Linux without a warning (au-check answering that Audio Units exist only on macOS, the CLAP fixture at -6.02 dB) and compiles for both Mac architectures with no error or warning, and for Windows with the four warnings it had before (the X11 editor's imports unused there). Not yet run on a Mac.

### The plugin host without a warning on any platform
- refers-to: native/formwav-host/src/main.rs (the CLAP editor's Unix-only imports behind cfg(unix); EditorFrame allowed unused on Windows)
- kind: explainer
- logged: v2.6.0 (in progress) · 2026-10-05

Since the Windows port (v1.96.0) the host's Windows check carried four warnings: the X11 editor's imports and its frame, unused where editors are not built. The imports each line shared with code used everywhere are split, the Unix-only names behind cfg(unix), and the frame is allowed to go unconstructed on Windows. The host now builds for Linux and checks for Windows and both Mac architectures with no warning and no error; the CLAP fixture still measures -6.02 dB.

### A learned assessment in Mic check, DNSMOS P.835 (AP-08's last part); the Mic check list no longer moves the Inspector
- refers-to: backend/app/services/dnsmos.py :: score, model_path, _ensure_model; services/tools.py :: mic_check, _learned_assessment; frontend/src/ui/inspector-pane.ts (the Mic check list: always present, a placeholder line, data-checked)
- kind: explainer
- logged: v2.6.0 (in progress) · 2026-10-05

AP-08 lacked a learned assessment of the mic and room. Mic check now adds DNSMOS P.835 (Microsoft's DNS Challenge; CC BY 4.0, credited in the finding and the module): a model trained on listeners' ratings that scores the speech itself, the background and the whole from 1 to 5. dnsmos.py ports the reference script's P.835 path exactly (16 kHz, 9.01 s windows a second apart, short clips tiled, the non-personalized calibration polynomials, the windows averaged); the 1.16 MB model downloads once into the models folder and is checked against a pinned SHA-256 (no binary in the repository), and the backend's onnxruntime runs it. Findings: the three scores, a warning with Voice de-noise when the background scores under 3, and one naming distortion, a poor mic or a reverberant room when the speech does. Without the model (offline before its download) Mic check works as before and says why. Checked, scratch runs not kept: on a 16 kHz set from JFK's inaugural address (public domain: clean, white noise at 20, 10 and 0 dB SNR, a 0.8 s room, a 3 s excerpt) formwav's scores equal the reference script's on every file (largest difference 0), the model fetched into an empty folder and its checksum held; the background falls with the noise (2.99, 2.04, 1.93, 1.42) and the room lowers the speech score (3.48 to 2.82) and not the background's. Through the Inspector under 4x throttling the 0 dB clip's findings carried the learned lines (within 0.02 of the reference, the clip having been through the import's 48 kHz and full-scale clipping). The Mic check list was hidden until a check and then grew in the flow (0.0083 measured): it is now always present at the repair list's fixed height with a placeholder line, a new selection returning the placeholder; no layout-shift entry, no page error.

### Dialogue isolate through a dedicated dialogue model, DeepFilterNet3 (RX-16); RNNoise's 10 ms shift fixed
- refers-to: backend/app/services/deepfilter.py :: binary, attenuation_limit, run_file, isolate; services/effects.py :: _dialogue_isolate, NUMPY_EFFECTS, the dialogue-isolate chain
- kind: explainer
- logged: v2.7.0 (in progress) · 2026-10-05

RX-16 lacked a dedicated dialogue model. Dialogue isolate now runs DeepFilterNet3 (Hendrik Schroeter; MIT or Apache-2.0) through its project's own command-line build, deep-filter v0.5.6, fetched once per platform from the release (macOS on Apple silicon and Intel, Windows, Linux on x86_64 and ARM, each SHA-256 pinned) into the models folder: its delay compensated (-D), Strength as its attenuation limit (-20 log10(1 - s), none at 100 %, the original mixed back in as RNNoise's mix was), at 48 kHz (resampled there and back only for clips at other rates), the clip's length kept. Without the model it falls back to RNNoise as before. Checked in scratch runs, not kept: formwav's output equals deep-filter -D run directly on the same file, through the module and through the engine's effects.apply (largest difference 0 over the 526,560 samples the tool returns; formwav keeps the clip's 528,000, the last 1,440 silent); on JFK's speech at 48 kHz with white noise, babble and music-like chords at 5 dB SNR, DNSMOS overall and background rose against RNNoise from 2.59/2.91 to 3.01/4.09 (white), 2.32/2.55 to 2.92/3.97 (music) and 1.79/2.51 to 2.08/2.70 (babble), and SI-SDR from the noisy 5.0 dB to 14.8 and 11.5 dB on white and music; on babble, speech amid speech, its SI-SDR (1.4 dB) fell below the noisy input's 4.9, a limit stated plainly. Found on the way: ffmpeg's arnndn delays its whole output by one 480-sample frame (10.0 ms, correlation 0.995 at its peak), so the old Dialogue isolate shifted every clip it processed 10 ms late; the fallback and the catalogue chain now pad by 480 samples and trim the first 480, measured aligned (0 samples) at full length. Still missing for RX-16: realtime use.

### Enhance speech, learned (AP-01 measured against a criterion stated first, not met on every file)
- refers-to: backend/app/services/effects.py :: _enhance_speech, NUMPY_EFFECTS (voice-clean)
- kind: explainer
- logged: v2.8.0 (in progress) · 2026-10-05

Enhance speech is now learned: RX-12's WPE dereverberation (full from Strength 50 %), DeepFilterNet3 with Strength as its attenuation limit (0 to 60 dB, none at 100 %), a 90 Hz high-pass and the level brought to -16 LUFS under a -1 dBFS sample-peak limiter; without the model, the DSP chain as before. The criterion for AP-01 was stated to the owner before any run: on a fixed set (JFK's 1961 recording and a second clean speech file, each with white noise at 5 dB SNR, music-like chords and kicks at 5 dB and a 0.8 s room), DNSMOS overall must rise by at least 0.8 on every file at the default Strength and beat the old DSP chain on every file. Measured, scratch runs not kept: learned against input (and the old chain) 2.75 from 1.95 (1.43), 3.07 from 2.14 (1.29), 2.54 from 2.14 (2.01) for JFK; 3.09 from 2.04 (2.47), 3.22 from 1.19 (1.27), 2.89 from 1.38 (1.76) for the second file. Five of six rise by 0.81 to 2.04 and all six beat the old chain, which lowered three of them; JFK in the room rose 0.40 (its clean recording scores only 2.72), so the criterion is not met and AP-01 stays partial. Found on the way, in this code before it shipped: the loudness meter ran at ffmpeg's error log level, which hides ebur128's summary, so no leveling happened; it runs at the normal level now (an applied clip measured -16.6 LUFS, sample peaks at -1 dBFS, true peak -0.5), and the table above is the re-run with leveling.

### The frame rebuilt to the approved target: the transport in a bottom bar, the family's themes in the title bar
- refers-to: frontend/src/ui/shell.ts (the bottom bar: the transport, then the status in two lines; the dock anchor in the timeline pane); src/ui/theme-menu.ts :: mountThemeMenu; src/ui/dock.ts, agent-pane.ts, terminal-pane.ts, spectrum.ts, piano-roll.ts (anchored on .fw-dock-anchor); src/styles/frame.css (the bottom bar, the theme menu); src/styles/tokens.css (the six accent swatches as app tokens); src/main.ts
- kind: explainer
- logged: v2.9.0 (in progress) · 2026-10-05

The owner judged formwav capable but barely usable and sent a screen recording of overdub and 23 editor screenshots (research/ui_reference); after a high-fidelity target was agreed on a design canvas (the arrangement the hero, the transport at the bottom, the family's themes, an effects chain of cards, synth and pad panels), the real app is rebuilt to it a region at a time. This step is the frame. The transport (play now the one accent-filled control, the clock the largest readout at 22 px, speed and Rec settings in popovers) moved out of the timeline pane into the status row, which became a 58 px bottom bar: the transport and its meters at the left, the status at the right in two lines (what just happened over the engine, rate, tracks, length and output; tracks and length step aside when the group is narrow). The timeline pane's old row stays, hidden, as the dock anchor that the dock, agent, terminal, spectrum and piano-roll panels insert themselves before. The title bar gains a Theme menu of the family's 15 profiles from the vendored theme module, until now unreachable from the interface, and six accent swatches filled through currentColor from app tokens; a choice is applied and stored by the module. Checked in Chromium, scratch runs not kept: neither bar overflows and no transport control is clipped at 1280 by 674 or 1440 by 900 (the notice 203 and 363 px wide); Light turned the page from #111111 to #ecebe6 and Lime turned play's fill to #d4f25a, the Lime swatch marked chosen; no layout-shift entry under 4x throttling while switching; no page error.

### Track headers to the approved target: the number, what the track runs, lettered M, S, R and A
- refers-to: frontend/src/ui/lanes.ts (the header template and updateLane); src/styles/frame.css (the header grid and its buttons)
- kind: explainer
- logged: v2.9.0 (in progress) · 2026-10-05

The header showed the file's format (mono, float32, 48.0 kHz) and four unlabelled icons. It now shows the track's number (its place in the session, two digits) beside its name, a line saying its channels and how many effects it runs (Mono, no effects; the file's format and rate kept as that line's tooltip), and mute, solo, arm and automation as lettered buttons M, S, R and A beside the meter, every class, label, tooltip and handler as before. Two clashes with older sheets found and fixed on the way, both checked in Chromium: surfaces.css placed the header's parts by named grid areas, which put the A button over S and took its clicks (the area template is cleared and every part placed by a more specific rule); and its shared pressed tint outranked the pressed colours (mute now pressed red, #ef4444, solo the accent, arm the record red). Mute, solo and automation pressed and released under 4x throttling made no layout-shift entry; no page error.

### The layout to the approved target: the agent column, the Inspector as the editor's first tab, a menu bar, Settings as a popout
- refers-to: frontend/src/ui/shell.ts (the agent column and its anchor; the Inspector under the arrangement; the Edit, View and Transport menus; File's Export); src/ui/dock.ts (the Inspector as the first tab, the agent left out); src/ui/agent-pane.ts (the right column, open from the start); src/ui/file-menu.ts (every menu mounted; data-proxy items); src/ui/theme-menu.ts (the Settings popout); src/main.ts; src/styles/frame.css
- kind: explainer
- logged: v2.9.0 (in progress) · 2026-10-05

The owner judged the app still unlike the agreed target and asked for settings in a popout and a real, organized menu bar. The right column, which held the Inspector, is now the agent's (its panel filling it, the column closing with it, the Agent button its toggle). The Inspector moved under the arrangement and became the first tab of the existing dock (the editor), beside Mixer, Terminal, Notes and Spectrum, its sections flowing in columns across the editor's width; it opens there once mounted. The title bar's File menu became a menu bar: File (with Export), Edit (Undo, Redo), View (Inspector, Mixer, Notes, Spectrum, Agent, Terminal, Media pane, Settings) and Transport (Play or pause, Stop, Record, Loop), each item triggering the existing control it names, so its behaviour is that control's; the menu logic now mounts every menu. Theme and accent moved off the bar into a Settings popout. Checked in Chromium at 1280 by 674 under 4x throttling, scratch runs not kept: the agent column 284 px wide with its header fitting; the editor 744 by 260 under the arrangement, on its Inspector tab; View then Mixer switched the editor's tab, Transport then Play started playback, Settings opened with the 15 themes; no layout-shift entry when opening and closing a menu, switching tabs or opening Settings; no page error. Still open: the toolbar (963 px of controls in 744, now scrolling) and the left pane's tabs (scrolling) need their contents cut to the target's, in words.

### The editor's Effects, Synth and Pads tabs; Settings as a menu bar dropdown
- refers-to: frontend/src/ui/editor-tabs.ts :: mountEditorTabs (KINDS, card, render, hold, the touchpad); src/ui/dock.ts (the tabs in the target's order); src/ui/theme-menu.ts (the Settings menu's contents); src/ui/shell.ts (the Settings menu); src/styles/frame.css; src/styles/tokens.css (the keys' colours as app tokens); src/main.ts
- kind: explainer
- logged: v2.9.0 (in progress) · 2026-10-05

The owner asked for Settings as a menu bar dropdown on the left, not a title-bar button, and still did not see the target. Settings is now the menu bar's last menu: the family's 15 themes as checked items, the accent swatches below (choosing a theme closes the menu; an accent leaves it open to compare). Terminal and the Media pane toggle left the title bar for the View menu, leaving the session, Loudness, Agent and Export. The editor gained the target's Effects, Synth and Pads tabs after Inspector. Effects shows the selected clip's track's realtime chain as cards with accent knobs and adds, bypasses or removes effects; a knob is dragged or stepped and set on release through set-track-fx, within the Inspector's ranges for each of the fifteen kinds. Synth's two octaves of keys, Pads' sixteen pads in C minor pentatonic and the touchpad play the live instrument through player.liveNote, heard whether the transport runs or not; they do not record. Checked in Chromium at 1280 by 674, scratch runs not kept: the Settings menu listing 15 themes and 6 accents, Light applied; the editor's tabs Inspector, Effects, Synth, Pads, Mixer, Terminal, Notes, Spectrum; a compressor added through the last card, its threshold dragged up 50 px and the session's value going from -20 to -1.25 dB; an analyser on the player's own output measuring RMS 0.080 while a key or a pad was held and 0.000 after release; no layout-shift entry under 4x throttling; no page error. Found: the bottom bar's output meter does not move for live notes while the transport is stopped (it measured 0 throughout), recorded for a later fix.

### The arrangement, toolbar and browser after the approved target: track colours, clip names, the toolbar in words
- refers-to: frontend/src/ui/lanes.ts (clipNode's name chip, updateClip filling it); src/ui/workspace-layout.ts (the left pane's default width 268 px); src/styles/frame.css
- kind: explainer
- logged: v2.9.0 (in progress) · 2026-10-05

Each track takes a colour by its place (cyan, violet, amber, pink, slate, green, blue, red) through the lanes' existing colour variable, so a colour set on a track or a clip still wins; its clips are tinted, bordered and drawn in it. Each clip carries its media's name on a chip, sticky at the timeline's visible left edge so it is never under the track header. The toolbar shows its tools' own words (Grid, Shuffle, Spot, Punch, Bars, Draw, Picture, Spectrogram), which a narrow-width rule had hidden behind icons; the capitalised group labels are gone, Log Hz and the spectral selection tool appear only while spectrograms are on, and the editor tabs' own toggles stay hidden (a display rule had overridden their hidden flag). The browser's media rows show the name over its details, and its five tabs are one segmented row in a pane 28 px wider by default (a dragged width is kept). Checked in Chromium with two tracks: the chips reading jfk_clean and jfk_noise0, 6 px right of the header; the waveforms cyan and violet; the toolbar 716 of 716 px at 1280 by 674 and 876 of 876 at 1440 by 900; the browser tabs 252 of 252 on one row; neither bar overflowing; every command dispatched; the design audit clean. Found and recorded in BUILD_NOTES: the timeline's time zero sits under the track headers (inherited), the cause of a 0.004 and 0.021 layout shift on selecting a clip.

### Correction: time zero was never under the track headers; the test harness scrolled
- refers-to: the entry above; the sidecar's BUILD_NOTES.md (its entry removed)
- kind: correction
- logged: v2.9.0 (in progress) · 2026-10-05

The entry above reported the timeline's time zero under the track headers and a layout shift on selecting a clip. Neither is the app's. Measured: after one or two imports the stage's scroll is 0 and a clip at time zero starts exactly at the header's right edge (466 = 466 at 1280 by 674), the ruler's corner 192 px wide and its painted canvas from there. The checks had selected clips with the browser driver's element click, which first scrolls the element into view; a clip wider than the visible timeline was scrolled 193 px to bring its middle in, so the clips slid under the sticky header, the ruler (rightly) labelled that edge 0:02, and the wave canvases followed the scroll, which the layout-shift observer counted. Hooks on every way the stage can scroll (scrollLeft, scrollTo, scrollIntoView, focus) recorded no call from the app. Selected by a click at a visible point, as a person clicks, under 4x throttling: scroll 0, the clip selected, clips at the header's edge, no layout-shift entry. Checks now click at a visible point inside wide elements.

### The agent column after the approved target; the output meter answers the live instrument while stopped
- refers-to: frontend/src/ui/agent-pane.ts (the suggestions); src/audio/player.ts :: handlePosition (idleQuiet); src/styles/frame.css (the agent column; the clip's name chip)
- kind: explainer
- logged: v2.9.0 (in progress) · 2026-10-05

The agent column takes the target's look: your instructions as bubbles, the agent's replies as plain text, its actions as a compact monospace log, failures in red, a line saying what the agent does while the log is empty, and three suggestions above a framed input whose Run is the accent; a suggestion fills the instruction and focuses it. The output meter had shown nothing for the live instrument with the transport stopped: the core's idle render measures its peaks, but the player sent zeros whenever the transport was not playing; it now passes them on and falls to silence 200 ms after the worklet's last report (the worklet reports only while the instrument sounds), so it never holds a stale level. The clip's name chip moved from sticky to 6 px inside the clip's left edge: the clip's overflow made it the sticky reference, which had put the name 198 px in. Checked in Chromium at 1280 by 674 under 4x throttling, clicking at visible points: the agent's empty line and suggestions shown, a suggestion filling and focusing the input; the output meter at 0.713 while a Synth key was held with the transport stopped and 0.000 after release; the chips 7 px inside their clips; no layout-shift entry, no page error; every command dispatched; the design audit clean after the chips' radius moved onto the family's scale.

### The Clip tab, the browser's effects, and the mixer fitting the editor
- refers-to: frontend/src/ui/clip-tab.ts :: mountClipTab; src/ui/browser-effects.ts :: mountBrowserEffects; src/ui/editor-tabs.ts (KINDS exported); src/ui/dock.ts (Clip the first tab); src/main.ts (the editor opens on Clip); src/styles/frame.css
- kind: explainer
- logged: v2.10.0 (in progress) · 2026-10-06

The editor's first tab is now the target's Clip tab: the selected clip's settings as one grid of labelled fields, each through the engine's own command (the track's name by rename-track, start by move-clip, gain by set-clip-gain, fades and their shape by set-clip-fades, sound type by set-clip-type, colour by set-clip-color), its source and length shown, a field being typed in never overwritten, and a line asking for a selection when there is none; the editor opens on it, the Inspector staying as the complete settings. Under the session's media the browser lists the fifteen realtime effects in four groups (EQ and filters, Dynamics, Space and movement, Repair), each with a line on what it does; choosing one appends it to the selected clip's track with the Effects tab's own defaults (the effect table now shared) and opens that tab on it. The mixer scrolls inside the editor when its strips are taller, so the routing menus are reachable again, and its mute and solo read M and S like the track headers (the icons hidden; buttons, labels and pressed states unchanged). Checked in Chromium at 1280 by 674 with two tracks under 4x throttling, clicking at visible points: the tabs Clip, Inspector, Effects, Synth, Pads, Mixer, Terminal, Notes, Spectrum, the editor on Clip; the second clip's true values shown (jfk_noise0, float32 at 48.0 kHz, start 0.000 s, length 11.000 s); gain -3 dB, fade-in 0.5 s, Dialogue and amber set through the tab and read back from the session; Echo from the browser landing in the second track's chain with the Effects tab opened; the mixer's 295 px of strips scrolling in 225; no layout-shift entry; no page error.

### The mixer's strips redesigned to the approved target
- refers-to: frontend/src/ui/mixer.ts (stripNode: the kind, lettered M and S, the Route disclosure; updateStrip: the strip's colour); src/styles/frame.css (the strip's grid, the rotated meter, Add bus and Add VCA beside the strips)
- kind: explainer
- logged: v2.10.0 (in progress) · 2026-10-06

The owner disliked the mixer: each strip stacked its name, meters, fader, level, pan, mute and solo and five routing controls in one tall column (295 px in a 225 px editor). A strip is now a card with its track's colour on its top edge (the track's own, else the lanes' palette by place; the master the accent): the name over its kind with the pan knob beside them, the fader with its meter standing beside it (the horizontal meter rotated, so the meter code is untouched), the level, M and S as letters, and the routing (output, VCA, send and its level, automation mode, and Remove on buses and VCAs) folded under a Route disclosure that opens across the strip. Add bus and Add VCA moved to a column beside the strips. Every control, class and handler is kept. Two layout faults found and fixed on the way: the rotated meter's box had widened its grid column and cut the names to two letters (the column is now fixed at 30 px), and an older rule capping each strip part at its column's width had squeezed the meter's box to 30 px, misplacing its rotation (lifted for the meter). Checked in Chromium at 1280 by 674 with two tracks under 4x throttling, clicking at visible points: the strips 187 px tall and the mixer 225 of 225 px high and 716 of 716 wide; the names whole; the top edges cyan, violet and the accent, matching the lanes; a fader dragged to +7.1 dB and read back from the session with its readout; M and S setting mute and solo; Route opening on output, VCA, send, send level and automation mode; each meter 84 px tall level with its fader (both 451 to 535 px) and showing level in playback; no layout-shift entry; no page error.

### The redesign wired through: the agents reach realtime chains, the View menu every tab, the README the interface
- refers-to: frontend/src/ui/agent-pane.ts (SYSTEM; KIND_SUMMARY; the set_track_effects tool; get_session's effects; the suggestions); src/ui/shell.ts (the View menu); backend/formwav_mcp/server.py :: formwav_get_session; README.md (The interface; the theme count)
- kind: explainer
- logged: v2.10.1 (in progress) · 2026-10-06

An integration audit of the redesign at the owner's request found four gaps. The in-app agent could neither see nor change the realtime chains the Effects tab shows: it gains set_track_effects (a track's chain replaced, each effect's kind and parameters checked against the shared effect table's ranges, each kind's defaults filling the rest, applied by set-track-fx), its get_session reports each track's chain, and its instructions tell it which tool renders into a clip and which sets a live chain. One of its suggestions (cutting filler words) asked for something no tool can do; it became one the tools can (measuring and setting track gains). The View menu reached none of the four new tabs; it now lists Clip, Inspector, Effects, Synth and Pads. The MCP server's formwav_get_session now reports each saved track's chain too (its render already played them). The README described no interface at all and counted 14 themes; it has a section on the interface as it is and counts 15. Checked: the agent's real loop run in Chromium with the engine's model step answered by a script (scratch, not kept): the request carrying 17 tools and the instructions naming set_track_effects, get_session's effects field, a high-pass at 90 Hz and a compressor at -18 dB and 3:1 landing in the track's chain with their defaults and shown as two cards in the Effects tab, a 3000:1 ratio refused (ratio must be a number from 1 to 20) and logged as failed; View then Clip, Effects, Synth and Pads each opening its tab; the MCP tool, run in its own venv on a saved session, listing the track's high-pass and bypassed compressor (the scratch session's file then removed by hand, the engine having no route to delete one).

### RX-16, the core half: the dialogue isolate as a live stage, its latency cancelled by reading ahead
- refers-to: native/formwav-dsp/src/fx.rs :: VOICE, VOICE_FRAME, Voice, Stage::latency; src/render.rs :: mix_buses (the read-ahead and priming), reset_fx, add_bus_stage, bus_primed, prime_scratch; native/formwav-dsp/Cargo.toml (nnnoiseless 0.5.2, BSD-3-Clause, no default features); backend/app/services/render.py (FX_KINDS voice 16, _stage, the own-bus rule)
- kind: explainer
- logged: v2.10.2 (in progress) · 2026-10-06

RX-16 asks for the dialogue isolate realtime and offline; offline has been done since v2.7.0, so this adds the live half to the audio core. The Voice stage runs RNNoise's network and weights through nnnoiseless (pure Rust, so it builds for the browser's audio worklet as well), one network per channel on 480-sample frames, Strength blending the cleaned signal with the original held equally far back. The core had no latency compensation, and this stage delays its signal, so a track holding it would have played late against the others; instead of delaying everything else, a bus whose chain reports a latency now mixes its clips that far ahead, and after a seek, a loop's wrap or a new stage first primes the chain with the samples it reads past, so what it plays lands on time in playback and export alike. A track holding the stage plays through a bus of its own, as one holding a compressor does. The latency was measured, not assumed: declared at one frame (480 samples), an export came out exactly 480 samples late, RNNoise adding a frame of its own through its overlapping windows (the same 10 ms ffmpeg's arnndn showed at v2.7.0), so the stage declares two frames (960) and holds the dry signal two frames back. Checked through the engine's export of the noisy JFK recording at 48 kHz, scratch scripts not kept: the isolated render's lag against the dry render 0 samples; Strength 0 identical to the dry render (largest difference 0 over 528,000 samples, so the read-ahead, the priming and the dry path line up exactly); the floor (10th percentile of 50 ms windows) from -17.3 to -46.7 dB and speech (90th percentile) from -10.5 to -12.1 dB; the core's 24 tests pass and it builds for WebAssembly. Still to come before RX-16 closes: the interface's side (the document's kind, the player's own-bus rule and translation, the shared effect table so the Effects tab, the browser and the agent's tool offer it), the worklet's core rebuilt, live playback measured, and the two other lock files that build the core updated for the new dependency. Found on the way: the disk was full (17 MB free); stale scratch environments in /tmp and the core's debug build were removed (2.6 GB free).

### RX-16 done: the live dialogue isolate wired through the interface and measured in playback
- refers-to: frontend/src/engine/document.ts (VoiceFx, the kinds set, the normaliser, the automation rule); src/audio/player.ts (the own-bus rule, the bus stage, the per-clip and automation exclusions); src/ui/editor-tabs.ts (KINDS voice); src/ui/browser-effects.ts (Repair); src/ui/inspector-pane.ts (the track and bus menus, label, default, Strength); src/ui/lanes.ts (the filter-only helpers); native/formwav-clap/Cargo.lock, spikes/audio/Cargo.lock; README.md
- kind: explainer
- logged: v2.10.2 (in progress) · 2026-10-06

The interface learns the voice kind everywhere it lists realtime kinds: the document's type, its kinds and its normaliser (strength 0 to 1, default 1), the player's rule sending a track that holds it through a bus of its own (as the export does, buses being where the core reads ahead), its stage as the core's kind 16, and its exclusion from per-clip chains and filter automation. One entry in the shared effect table offers it as Dialogue isolate in the Effects tab, the browser's Repair group and the agent's set_track_effects at once; the Inspector offers it on track and user-bus chains, not the master's or a clip's, which have no read-ahead. The worklet's core was rebuilt with oc_install's own locked step (164,588 to 613,628 bytes, RNNoise's weights most of it), and the two other lock files that build the core record the new dependency (each resolving under --locked without a build). Checked in Chromium at 1280 by 674 with the noisy JFK recording, clicking at visible points: chosen from the browser's Repair group it landed in the track's chain at full strength, its card showing a Strength knob and the header reading Mono, 1 effect; the agent's set_track_effects description listing voice (strength 0 to 1), its request captured with no model called; live playback measured on the player's own output, the floor (10th percentile of 140 reads over 5.6 s) at -47.5 dB with the stage on and -17.3 dB with it bypassed, the loud parts at -11.0 and -10.0 dB; no page error. With the offline half done since v2.7.0, RX-16 (dialogue isolate, realtime and offline) is done: 196 rows.

### PT-24, first step: ARA 2 through CLAP, a plug-in's ARA factories read
- refers-to: native/formwav-host/src/ara.rs :: clap_ara_factory, CLAP_EXT_ARA_FACTORY(_COMPAT), factory_json, check; src/ara_sys.rs (generated); src/main.rs (ara-check)
- kind: explainer
- logged: v2.10.3 (in progress) · 2026-10-06

PT-24 asks for ARA 2 plug-in integration (the protocol through which Melodyne-style editors read a host's audio and render their edits). Celemony's ARA SDK has been open source (Apache-2.0) since 2022, its examples include a test plug-in and a test host, and ARA has a CLAP binding (ARACLAP.h) in plain C, so it can be hosted in Rust on formwav-host's existing CLAP loading with no C++ layer and verified here rather than only on the owner's machines. The SDK (ARA_API, ARA_Library and ARA_Examples at their 2025-11-06 heads) and the CLAP SDK (MIT) were fetched outside the repository (the sidecar's research/ara); the examples built for CLAP with CMake (a missing include of limits in the SDK's ARAContentLogger.h was forced in through the compiler flags, the SDK's files untouched), and the SDK's own test host ran its own test plug-in over CLAP with its generated audio (content reading, playback rendering and archiving, exit 0), the baseline that any later failure is formwav's. ARA's C API (ARAInterface.h) was turned into Rust once by bindgen 0.73.2 and committed as ara_sys.rs (2,011 lines, its layout checks kept, so building formwav needs no libclang), ARACLAP.h's small factory struct written by hand. The new `fwhost ara-check <plugin.clap>` loads a plug-in, asks its CLAP entry for the ARA factory extension (the final id, then the draft id older plug-ins answer to) and prints every factory as JSON, each field read only when the plug-in's struct size reaches past it (ARA's convention for plug-ins built against older headers) and copied by value first (ARA's structs are packed). On the SDK's test plug-in it reports what the SDK's own host printed: ARATestPlugIn 2.3.0 by ARA SDK Examples, its document archive id and the compatible file-chunk archive id, notes analyzable, no playback transformations, audio file chunks stored; with its CLAP id, its ARA factory id and ARA API generations 3 to 6. Not yet exercised: a plug-in without ARA (formwav's own CLAP is not built in this container). Next: the document controller (audio sources read through the host's audio access, analysis requested and read back), then a playback region rendered through the plug-in's CLAP instance bound as playback renderer, then archives stored in the session. PT-24 stays scheduled until a document is built and analyzed.

### PT-24, step two: an ARA document built round a file and analyzed; PT-24 partial
- refers-to: native/formwav-host/src/ara.rs :: Source, Reader, the host interfaces (audio access, archiving, content access, model updates), Opened, open, analyze; src/main.rs (ara-analyze)
- kind: explainer
- logged: v2.10.3 (in progress) · 2026-10-06

The host side of an ARA document, ported from the SDK's MiniHost.c to Rust on the generated bindings, so each callback's signature is checked against ARA's own header: audio access serving a file's samples to the plug-in's readers (32- or 64-bit floats as it asks, silence outside the file), archiving, and the host's own content (none: every query says so), every function of each interface filled, since a plug-in may call anything inside the struct size the host declares; model updates counted through atomics, as the plug-in calls them from its analysis thread. `fwhost ara-analyze <plugin.clap> <in.wav>` builds the document in MiniHost's order (a musical context, a region sequence, the file as an audio source, an audio modification, a playback region), opens the samples, requests note analysis, delivers model updates while polling whether it is incomplete, reads the notes back through a content reader, and tears the document down in reverse. The test plug-in's analysis is deterministic (each run of non-zero samples a note, its peak the volume), so it was checked on a signal whose answer is known, constant blocks between exact silence: the notes came back exactly 0.5 s for 1.0 s at volume 0.5 and 2.0 s for 0.5 s at 0.25, with the invalid pitch and frequency the plug-in assigns by design, finished in 0.16 s with 9 progress and 1 content notifications; the same for a stereo file whose channels differ; a library that is not a plug-in refused cleanly (no clap_entry); the build free of warnings. PT-24 moves to partial (counted: done 196, partial 19, scheduled 16, so covered 215 of 231): still missing a playback region rendered through a plug-in instance bound as playback renderer, its edits archived in the session, and the interface's side.

### PT-24, step three: a clip rendered through the plug-in as ARA playback renderer
- refers-to: native/formwav-host/src/ara.rs :: clap_ara_plugin_extension, CLAP_EXT_ARA_PLUGINEXTENSION(_COMPAT), Host, initialize, Doc (build, teardown), render, analyze; src/main.rs (ara-render)
- kind: explainer
- logged: v2.10.4 (in progress) · 2026-10-06

The document's setup moved into shared pieces, a boxed Host owning the four interfaces (so the pointers the plug-in holds stay put) and a Doc built in the SDK's MiniHost's order and torn down in reverse, and analyze was rebuilt on them; on the way, an edit of mine had fenced the old function's body in a compiled-out item to avoid retyping it, which was then deleted outright (no dead code left). `fwhost ara-render <plugin.clap> <in.wav> <out.wav>` creates a CLAP instance of the plug-in, binds it to the document through ARA's CLAP plug-in extension with the playback renderer role assigned (all three roles known, as the SDK binds), gives it the playback region, configures its main input and output to the file's channel count, and processes it with silence as its input and a playing transport at each block's position (the SDK's CLAPRenderBuffer's flags and fixed-point seconds), so everything it outputs comes from the document through ARA. Checked on the SDK's test plug-in, whose renderer plays its region unedited: the JFK recording (mono, 16 kHz, 176,000 frames), a stereo 48 kHz file whose channels differ, and a mono 48 kHz file each came back identical to its source in every channel (largest difference 0); analysis on the shared pieces still returned its exact two notes; the build free of warnings. Found on the way: without the port configuration the test plug-in rendered the stereo file as a mono downmix in its first channel ((L + R) / 2, its second silent), the mono file having hidden it; configuring the ports as the SDK's own host does fixed it. PT-24 stays partial: its edits archived in the session, and the interface's side, are still to come.

### PT-24, step four: the plug-in's state archived and restored (ARA 2's partial persistency)
- refers-to: native/formwav-host/src/ara.rs :: ArchiveWriter, ArchiveReader, the archiving callbacks, Doc (restored; build's restore), analyze_notes, read_notes, archive_file, store, restore; src/main.rs (ara-store, ara-restore)
- kind: explainer
- logged: v2.10.5 (in progress) · 2026-10-06

An ARA plug-in keeps its state (analysis results, and in an editor like Melodyne the user's edits) in archives the host stores and hands back. The archiving callbacks, stubs until now, became real: a writer collecting the bytes the plug-in writes at the positions it gives, a reader serving them back and refusing ranges outside them, and the archive's format id reported when asked. `fwhost ara-store` analyzes a file and has the plug-in write its state for every object (storeObjectsToArchive, ARA 2's partial persistency, as the SDK's test host stores), saving the archive with its format's id in front; `fwhost ara-restore` checks that id against the plug-in's own and compatible archive ids, recreates the document's objects under the persistent ids they were stored with, has the plug-in restore its state into them inside the same editing cycle (restoreObjectsFromArchive before endEditing, as the SDK's test host restores), and reads the notes without requesting analysis. The analysis and note reading moved into helpers shared by analyze, store and restore. Checked on the SDK's test plug-in with the known signal: the store finished its analysis and wrote a 196-byte archive in the plug-in's format; restored in a separate process, the plug-in accepted it and the same two notes (0.5 s for 1.0 s at 0.5, 2.0 s for 0.5 s at 0.25) came back with no analysis requested; the control, the same path and timing with the plug-in's format id but an empty payload, restored nothing and held no notes, so the restored notes came from the archive; an archive in a foreign format was refused; analysis and stereo rendering, re-run after the document's setup changed, still exact; the build free of warnings. PT-24 stays partial: the interface's side (the archive kept in the session, the plug-in chosen and run from the app) is still to come.

### PT-24 done: ARA in the app, a clip analysed and rendered from the Clip tab, its plug-in's state saved with the session
- refers-to: backend/app/services/plugins.py :: ara_plugins, _ara_run, _ara_installed, ara_analyze, ara_render; app/routers/media.py (GET /api/ara/plugins, POST /api/media/{id}/ara/analyze, /ara/render); frontend/src/engine/document.ts (ClipAra, Clip.ara, set-clip-ara); src/ui/clip-tab.ts (the ARA row); src/ui/browser-effects.ts; src/styles/frame.css; native/formwav-host/src/ara.rs (read_archive; render with an archive); src/main.rs; README.md
- kind: explainer
- logged: v2.10.6 (in progress) · 2026-10-06

The engine lists the installed ARA plug-ins (each CLAP plug-in its scan found asked once with ara-check, named plugin:clap:<path> as the other plug-ins are, and only those ever loaded), analyses a media file with one (ara-store, returning the notes it found and its archive in base64, its format's id first) and renders a media file through one with that archive restored first (ara-render now takes an archive, read by the same checked reader ara-restore uses, the plug-in refusing to restore it ending the render) into new media. The document gains Clip.ara (the plug-in, its label, the archive's format id, the archive and the notes found) and set-clip-ara, so the plug-in's state is part of the session file; the Clip tab gains an ARA row (the plug-ins, Analyse, Render, and a line saying what the clip holds), both working on the clip's original audio, which the state describes. Checked through the engine and in Chromium at 1280 by 674 under 4x throttling, clicking at visible points, with the ARA SDK's test plug-in installed where the scan looks (a scratch link): the plug-in listed (ARATestPlugIn 2.3.0, notes) and an unscanned path refused (404); Analyse storing a 258-byte archive (2 notes) on the clip; Render putting the plug-in's render on the clip, identical to the source (largest difference 0.0), the original kept for Restore; the session saved through the engine and read back with the same archive (the scratch session then removed). Two layout faults found and fixed on the way: the ARA status line wrapped, so it now holds one fixed line; and new media (a render, an import) pushed the browser's effects list, which v2.10.0 had placed inside the media list itself, so it now follows the list (marked as part of the media panel, so the other tabs hide it) and the list scrolls within a fixed height; the browser's tab bar now holds one height on every tab, where it had moved between 18 and 30 px. A report of mine in between, that the effects list stayed visible on the Voice tab, was my check clicking near a tab's corner; clicked at its centre, the tabs hide and show both lists both ways. Found and recorded in BUILD_NOTES, inherited: the Voice tab shifts its own sections as it loads (0.0146). With hosting, the document controller and analysis, playback rendering, archiving and the app's side all in place, PT-24 (ARA 2 plug-in integration) is done: 197 rows.

### Two layout shifts of the redesign's, found by v2.10.6's gate and fixed
- refers-to: frontend/src/styles/frame.css (the agent column's header; the docked mixer's hidden state)
- kind: explainer
- logged: v2.10.6 (in progress) · 2026-10-06

The release gate now measures layout shifts across its whole interface run, and found three entries after the browser's tabs (0.0244, 0.0244, 0.0558) that its own labels had wrongly put on the tab switch: traced with each action labelled and the moving elements recorded, the tab switches made none, and two later steps did. An agent run moved its conversation 34 px down and back (0.0042 and 0.0244): v2.9.0 had let the agent column's header wrap, so the state text that appears while the agent works (Thinking...) pushed its buttons onto a second line; the header now stays one line, the state text ellipsed between the title and the buttons (fitting the 284 px column at 45 px, both buttons whole). Opening the docked Mixer moved it from nowhere to its place (0.0323): v2.10.0's rule giving the docked mixer display: flex overrode its hidden flag, so a hidden mixer sat in the layout at zero size; a hidden mixer is now out of the layout. Re-run under 4x throttling, an agent run, the Mixer opened and the Clip tab returned to made no layout-shift entry; no page error.

### The Voice tab no longer shifts its sections as it loads
- refers-to: frontend/src/ui/voice-pane.ts (BODY's state line); src/styles/frame.css (.fw-voice-state)
- kind: explainer
- logged: v2.10.7 (in progress) · 2026-10-06

Recorded at v2.10.6 as an inherited fault: opening the browser's Voice tab dropped its sections about 126 px (0.0146) as the engine's status message filled an empty paragraph above them. The paragraph now starts with a line of its own (Checking the voice engine...) and holds a fixed height that fits the engine's longest message whole (144 px, the message measured at 138), scrolling one longer. Opened twice under 4x throttling at 1288 by 683: no layout-shift entry, the message fitting its box (144 of 144 px); the design audit clean. The BUILD_NOTES entry, its criterion met, is removed.

### DS-14 done: recorded sound effects and music in the Library, from Wikimedia Commons, royalty-free, each keeping its credit
- refers-to: backend/app/services/catalogue.py :: royalty_free, search, preview, import_item; app/routers/media.py (GET /api/library/catalogue/search, /preview; POST /import); frontend/src/ui/media-pane.ts (the catalogue's search, preview and add); src/engine/document.ts (MediaRef.credit); src/styles/frame.css; README.md
- kind: explainer
- logged: v2.10.7 (in progress) · 2026-10-06

DS-14 (a royalty-free stock media library) had ten synthesised sounds and lacked recorded music and sound effects from a licensed catalogue, and search. The engine now searches Wikimedia Commons' audio files (its public API, no key, a User-Agent naming formwav as Wikimedia asks) and keeps only royalty-free licences, read from each file's own licence metadata: public domain, CC0 and CC BY of any version, which allow any use, commercial included; share-alike, non-commercial, no-derivatives and GFDL are left out. Each result carries the credit its licence asks for (title, author, licence and source), previewed through the engine (same-origin) and imported through the engine's own importer (any format it reads), the credit travelling on the media into the document, so it is saved with the session. Files are fetched only from Commons' upload host over HTTPS, so the engine cannot be pointed elsewhere. Checked: the licence rule on ten licence names (public domain, CC0, CC BY 4.0, 3.0 and CC-BY-2.0 allowed; CC BY-SA 4.0, BY-NC 3.0, BY-ND 4.0, GFDL and BY-SA 3.0 de refused); live searches returning only those licences (rain 6, piano 18 through the interface); a preview's bytes matching the catalogue's size; a foreign host and plain HTTP refused; in Chromium under 4x throttling, piano searched and its first result (Piano-phrase, CC BY 3.0, Xavier-Serra) added on a new track as Piano-phrase.wav (169,600 frames at 44.1 kHz resampled to 184,599 at 48 kHz) with its credit in the document and the notice, no layout shift, no page error. Found on the way: Commons appends tracking parameters to its file URLs, which had become the imported file's suffix; the suffix is now read from the URL's path. DS-14 is done: 198 rows.

### Cloud projects, the engine side: Google Drive and Dropbox, ported from formcut 2.6.3
- refers-to: backend/app/routers/cloud.py; backend/app/main.py; sidecar verification/verify_cloud.py
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

Asked by the owner, against the comparison's Cloud projects and collaboration row (none): formcut's cloud module, the same author's, Apache-2.0, ported rather than rewritten. Its sign-in (PKCE with S256; Google's desktop flow redirecting to this engine on the loopback, Dropbox's code pasted back with no secret), token storage and refresh, listing, Google's resumable uploads and Dropbox's chunked upload sessions are formcut's code unchanged; formwav's changes, each made by a replacement asserted to match once: its data folder (the token file written whole, then moved into place, readable by its owner only; a damaged one set aside), a formwav folder in the cloud, a saved session (whose .fmw holds the document and its media, so it reopens anywhere) or a media file as what is saved, a .fmw opened from the cloud becoming a project here (never over one already here) and anything else imported as media, and imports and uploads run within the request, formwav having no job runner. formcut's own test, with its fake that follows each service's documentation, was carried over beside the code (its fake verbatim, its job-based tests rewritten for sessions and the formwav folder, one test added for sessions opening as projects): 9 of 9 pass. The interface comes next. By the comparison's own grading a cloud save without shared editing is partial (Audacity's is graded so), so this half of the row is the storage; collaboration is the other half.

### Enhance speech against Adobe Podcast's Enhance Speech v2, on the owner's examples
- refers-to: backend/app/services/effects.py :: _enhance_speech; sidecar verification/compare_adobe_enhance.py (and its .json, _levelled.json); sidecar spikes/adobe (the inputs, FLAC)
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison's One-click speech enhancement row asked for a comparison with Adobe's output; the owner ran two of his own recordings through Adobe Podcast (a 20.6 s recording at strength 67 percent, and a 38.8 s video's audio at 50 and 76 percent). formwav's Enhance speech was run on the same originals at the same strengths, and the original, Adobe's output and formwav's were scored by DNSMOS P.835 as the engine scores (16 kHz mono, its reference windows). formwav lifts both recordings a long way (the noisy video from 1.21 overall to 2.94 and 3.03) but Adobe scores higher on all three: overall 3.50, 3.25 and 3.28 against formwav's 3.19, 2.94 and 3.03. formwav levels to -16 LUFS, 5 to 9 dB louder than Adobe's output, so its outputs were scored again scaled to Adobe's exact level: 3.35, 3.00 and 3.05, still 0.15, 0.25 and 0.23 below Adobe, which also leads on speech (SIG) and background (BAK) in all three, and formwav's speech score on the first recording sits a little under the original's. These are two recordings scored by one learned metric, with no listening test made here; they say Adobe is ahead on the owner's material. The row stays partial until a stronger open model closes the gap, measured on these same files.

### Devices on the local network, paired: the engine side, ported from formcut 2.6.3
- refers-to: backend/app/routers/remote.py; backend/app/core/security.py (the network branch); backend/app/core/store.py; backend/app/routers/cloud.py (onto the shared store); backend/app/main.py; sidecar verification/verify_remote.py
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The ground for remote recording (and for shared editing): formcut's remote module, the same author's, ported. Off by default; turned on from the desktop, a second listener opens on every network interface at a fixed port (8978 by default, beside formcut's 8977) and serves the same app, while the loopback listener and its checks are untouched. Its server marks every request it carries, and formwav's security middleware now has formcut's branch for marked requests: only a paired device, or the pairing page itself, gets through (a page request from an unpaired device is sent to /pair), and the rule that a change needs the local header holds on both listeners. Pairing is formcut's: a six-digit code shown on the desktop, alive five minutes and good once, five wrong codes cancelling every live code, and a device token handed back in an HttpOnly, SameSite=Strict cookie (or presented as a bearer token), kept only as a hash; only the desktop turns the listener on, shows codes or removes devices. The JSON stores of cloud and remote now share one helper (core/store.py: written whole then moved into place, private where they hold tokens, a damaged file set aside). formcut's own test, carried over with formwav's names (its translation test dropped, formwav having no translation files): 9 of 9 pass, including the real listener started on a free port marking its requests even from this machine; the cloud test still 9 of 9 on the shared store. Pairing in Settings and the guests' recording room come next.

### Remote recording, a track per guest: the recording room
- refers-to: backend/app/routers/room.py (the room, /room); backend/app/routers/remote.py (pairing leads to /room); backend/app/main.py; frontend/src/ui/room.ts (Settings > Devices on this network; Room beside Rec); frontend/src/main.ts; frontend/src/styles/workspace.css; sidecar verification/verify_room.py
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison's Remote recording row (none). Devices paired through the network listener join a room; the desktop starts and stops a take; every guest records its own microphone where it sits, losslessly (32-bit float through an AudioWorklet, the browser's echo cancellation, noise suppression and gain control off), and sends the take when the desktop stops; the desktop places each take on its own track at the playhead the take started from, moved by its measured start offset. Every room answer carries the engine's clock, so a guest knows, to within its round trip on the local network, when on that clock its first sample was taken. Guests use a small page the engine serves at /room (no editor bundle, so it suits a phone; a tap starts the microphone, as mobile browsers require; the middleware sends an unpaired device to /pair, and pairing now leads to /room). The desktop has Settings > Devices on this network (the listener's switch, the address to open, a pairing code counting down its five minutes, the paired devices with Remove) and Room beside Rec in the transport (who is here and what each is doing, Start take and Stop take). Checked: verify_room.py, 3 of 3 (an unpaired device refused; check-ins, and only the desktop starting and stopping; a take arriving as media with its offset, a stale take and a desktop upload refused, placed takes leaving the list), with remote and cloud at 21 of 21; and in two Chromium browsers through an engine serving the built app, a guest whose microphone was fed the JFK recording: paired, joined, shown as ready and then recording, its take placed on its own track as Studio C (room take).wav, 3.54 s for a take that ran 3.52 s by the host's clock, starting 96 ms after the host's. Found on the way: a take from a guest that had not yet checked in left it out of the room (it now counts as present), and the Room popover's rows slid sideways as their text changed (the transport popover's centring rule won over the room's by load order; its layout now wins): no layout-shift entry on opening the room, starting or stopping, no page error on either side. The room works on the local network (or a VPN joining two networks); its takes line up by clock, which the multitrack step refines by the audio itself.

---

## app/services/local_dub.py {#app-services-local-dub}

### app/services/local_dub.py · the translation model's download names formwav as its User-Agent
- refers-to: app/services/local_dub.py :: `install` (the request for LANGS[lang][3]); app/core/version.py :: VERSION
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

Install dubbing language failed for everyone: on 2026-10-06 argos-net.com answered urllib's default User-Agent (Python-urllib/3.12) with 403 Forbidden, while the same address fetched with another User-Agent returned the model. The download now sends `formwav/<version>`. Checked through the engine: POST /api/providers/local-dub/es/install brought the English to Spanish model in (model.bin and sentencepiece.model in models/translate/en_es), after which the dubbing tests below ran.

---

## tests/requirements.txt and tests/requirements_ear.txt {#tests-requirements}

### tests/requirements.txt · what the tests add to the engine's environment
- refers-to: tests/requirements.txt, tests/requirements_ear.txt; .gitignore (backend/tests/.venv-ear/, .pytest_cache/)
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

The tests are written on the owner's explicit ask (2026-10-06: tests and fixtures move into the repository and CI runs them on every push). They run in the engine's own venv, which needs two more packages, pinned: pytest 9.1.1 and Playwright 1.63.0 (its Chromium from `python -m playwright install chromium`). The EBU ADM Renderer is the judge for ADM files and lives in a venv of its own beside the tests (`backend/tests/.venv-ear`, Python 3.12, `ear==2.1.0` with `setuptools<70`, which its pkg_resources import needs): its pins conflict with nothing of the engine's only because it is apart. Run from backend: `python -m pytest tests` (the interface tests in tests/e2e need `npm run build` in frontend first). A test that needs a model, a network service or a key skips and says what to install; nothing is downloaded by a test.

---

## tests/conftest.py {#tests-conftest}

### tests/conftest.py · the tests make their own material and never touch the owner's
- refers-to: tests/conftest.py :: the paid keys removed, FORMWAV_DATA_DIR, `model`, `client`, `jfk_wav`, `speech_48k`, `engine_url`
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

Adopted from formcut's conftest. Every key or address that could reach a paid service (ElevenLabs, fal, Anthropic, ACE-Step) is removed from the environment before the engine is imported, so no test can spend money; the stand-ins set their own. The engine's data folder is a fresh temporary folder per run (removed at the end), so media, sessions and settings never mix with the owner's; the speech runtime (Kokoro's environment, 1 GB) is linked in rather than reinstalled. The client sends the local header and a loopback Host as the app does. `speech_48k` is the JFK recording at 48 kHz through ffmpeg, the shared input of most audio tests; `engine_url` starts a real engine on a free port for tests that need one over HTTP (the MCP server, an agent client), and fails with the path of its log if it does not answer within 60 s.

---

## tests/fixtures {#tests-fixtures}

### tests/fixtures · real speech and one service's contract
- refers-to: tests/fixtures/README.md, jfk.wav, elevenlabs_contract.json
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Only what a test cannot generate is kept: whisper.cpp's public-domain JFK sample (byte-identical, its SHA-256 in the README) and the extract of ElevenLabs' OpenAPI document (37,837 bytes for 18 operations, against the full document's 2.25 MB). Everything else (tones, noise, rooms, music beds, clicks, sessions) is made by the test that uses it, from a fixed seed.

---

## tests/stand_ins {#tests-stand-ins}

### tests/stand_ins · services judged by their own documents, not by formwav's expectations
- refers-to: tests/stand_ins/elevenlabs.py, acestep.py, anthropic.py, extract_elevenlabs_contract.py
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

A stand-in answers as the service would and records each request's problems against the service's own description, so a test fails when formwav sends something the service would refuse. ElevenLabs' reads the contract extract (methods, paths, required fields, enums and ranges); ACE-Step's follows its API.md (the task types, the fields each takes, the key) and refuses as it would; Anthropic's answers the Messages API with a scripted three-turn plan that reads the tool results it is sent (get_session, then set_track_gain, set_clip_fades and add_marker on the ids it found, then a summary), proving the in-app agent's loop and its chaining by id, never a model's judgement. Each serves on a free port in a thread for the life of its test module.

---

## tests/test_acestep.py {#tests-acestep}

### tests/test_acestep.py · ACE-Step 1.5's REST server, by its API.md
- refers-to: tests/test_acestep.py; app/services/acestep.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Status reads the server's models; each of the seven tasks the Create tab offers (text to music with lyrics, cover, repaint, an added layer, extraction, completion, a repaint ending before it starts) comes back as media; no request broke the documented API; a repaint whose end precedes its start is sent as -1 (to the end), as API.md defines; the stand-in itself refuses five bad bodies and a missing key, so its approval means something; with the server gone, formwav names the command that starts it (acestep-api).

---

## tests/test_adm.py {#tests-adm}

### tests/test_adm.py · ADM files judged by the EBU's own renderer
- refers-to: tests/test_adm.py; app/services/adm.py; app/routers/render.py (what=adm)
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

formwav's ADM BWF files are rendered by the EBU ADM Renderer (ear-render, 0+5+0) and the speakers' shares of each object's tone measured: objects that stand still play over 99% from their speaker; a moving object starts over 95% at its first point, sits between 40 and 60% on each side halfway and ends over 99% at its last; a bed plays from its own channels; and the session export route writes moving objects and a bed that the renderer places so. Skips, saying how to install it, where the renderer's venv is missing (FORMWAV_EAR_BIN points elsewhere).

---

## tests/test_agents.py {#tests-agents}

### tests/test_agents.py · Settings > Agents against a scratch home folder
- refers-to: tests/test_agents.py; app/routers/agents.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

HOME, USERPROFILE and APPDATA point into the test's own folder, so the owner's agent configurations are never read or written. Six clients shown with the server's command present; Codex's TOML keeps its settings and other servers, is backed up, and a second add does not duplicate; Cursor and Claude Desktop merge beside other servers; a broken file is refused and left byte for byte; Claude Code without its command says so; a paired device is refused; and the command Cursor's written file names starts the MCP server, which answers formwav_status through the MCP SDK's own client.

---

## tests/test_cloud.py {#tests-cloud}

### tests/test_cloud.py · Google Drive and Dropbox against a fake of both
- refers-to: tests/test_cloud.py; app/routers/cloud.py; app/services/projects.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Ported from formcut's own tests with the cloud service (v2.10.8). A local server plays both services: the PKCE challenge is the standard S256 form; Google signs in on the loopback with PKCE and drive.file, asking for read access only for a full drive; Dropbox signs in with a pasted code and no secret; both list in one shape; importing brings media in and opens a session as a project; Google saves into one formwav folder through a resumable session; Dropbox saves small sessions whole and large ones in an upload session; an expiring token is refreshed first and an unknown service refused.

---

## tests/test_elevenlabs.py {#tests-elevenlabs}

### tests/test_elevenlabs.py · every ElevenLabs route checked against ElevenLabs' contract
- refers-to: tests/test_elevenlabs.py; app/services/elevenlabs.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Each of the 21 routes formwav offers for ElevenLabs is called with media made in the test and must be answered and handled (its media placed, its JSON read); across all of them no request may break the contract extract (a missing required field, a value outside a range, an unknown enum value, a wrong method or path); and Scribe's transcript is kept where formwav keeps transcripts, so the Transcript tab reads it.

---

## tests/test_engine.py {#tests-engine}

### tests/test_engine.py · the engine imports, mounts each route once, states one version and stays on this machine
- refers-to: tests/test_engine.py; app/main.py; app/core/security.py :: LocalOnly; desktop_entry.py :: main; every version site
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

The import and the routes are formcut's CI check made a test. The version test reads every machine-readable version site (the engine, the MCP server, package.json and its lock's two entries, the core's Cargo.toml and the three lock files that build it, the shell's Cargo.toml, lock and tauri.conf.json, the README's badge and its text, the three logs' headers) against app/core/version.py and checks the form v(major).(middle 0 to 99).(minor 0 to 9), so a release cannot miss one; /api/health must report the same version for the engine and for the core installed beside it, so an engine running a stale core fails. The lockdown is checked from outside: another machine, a rebinding page's Host and a change without the local header are refused with 403 and their reasons, every answer carries nosniff, and the desktop entry serves on 127.0.0.1 (uvicorn.run captured, so nothing listens).

---

## tests/test_kinds.py {#tests-kinds}

### tests/test_kinds.py · one set of nineteen live kinds, one code each, every kept value designable
- refers-to: tests/test_kinds.py, tests/kinds_probe.mjs; frontend/src/ui/editor-tabs.ts :: KINDS; frontend/src/engine/document.ts :: cleanFx; frontend/src/audio/player.ts :: flatStages; app/services/render.py :: FX_KINDS, `_stage`; native/formwav-dsp/src/fx.rs :: the kind constants, Stage::design; frontend/public/core/formwav_dsp.wasm
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

CLAUDE.md's warning that a live kind lives in many places at once, made a check. kinds_probe.mjs loads the interface's own modules through the project's Vite (its SSR loader, so TypeScript and the worklet's URL import resolve as in the app) and the shipped WebAssembly core: the catalogue's kinds, what the document keeps (its clamps found by passing values far below and above every field, its fallbacks by passing none), the player's stage for each, and whether the core designs that stage (fw_add_master_stage returns 0 for a refused one: an echo of 0.5 ms, a chorus at 12 Hz, an unknown kind). Asserted: the same 19 kinds in the catalogue, the document, the export and the core's constants; one code per kind in all of them; the core designs every kind at the document's fallback, lowest and highest values, so nothing the document keeps is silently skipped; each catalogue knob's both ends are kept by the document and designed by the core; and the export's defaults for a missing field equal the document's fallbacks. All hold. Seen and left for the owner: the catalogue's initial values differ from the Inspector's defaults for two kinds (denoise's sensitivity 0 against 3 dB; reverb's room 0.5 against 0.6, and the catalogue's card has no Mix knob, its mix coming from the fallback 0.25), and the chorus knob stops at 5 Hz where the document and core allow 10.

---

## tests/test_local_dub.py {#tests-local-dub}

### tests/test_local_dub.py · dubbing on this machine judged by a human rendering and by a second listener
- refers-to: tests/test_local_dub.py; app/services/local_dub.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

JFK's line dubbed into Spanish: the words' F1 against the standard human rendering above 0.7; each sentence placed where it was said within 2 ms and sped up by at most 1.35 times; the dub as long as the source within 0.01 s; and a multilingual Whisper (tiny, another model than the one that transcribed the source) hearing the Spanish that was to be said with an F1 above 0.6. Skips without Kokoro, the Spanish model or faster-whisper.

---

## tests/test_local_speech.py {#tests-local-speech}

### tests/test_local_speech.py · speech made here, heard back by Whisper
- refers-to: tests/test_local_speech.py; app/services/local_speech.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Kokoro offers its 54 voices; a spoken sentence is heard back by Whisper with at least 80% of its words; Regenerate takes its reference from the clip at the clip's rate and splices to the exact length (the media's frames equal the source's plus the reported change), with Kokoro standing in for a cloning engine, since Pocket TTS and Chatterbox need PyTorch. Skips without Kokoro.

---

## tests/test_mcp.py and tests/mcp_probe.py {#tests-mcp}

### tests/test_mcp.py · the MCP server driven by the MCP SDK's own client, tool by tool
- refers-to: tests/test_mcp.py, tests/mcp_probe.py; formwav_mcp/server.py
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

mcp_probe.py runs in the MCP server's own venv (its Starlette and the engine's FastAPI do not share one) against a real engine, starts the server over stdio with the SDK's client and calls every tool. Each of the 34 checks passes only when the tool works where its work can run, or fails with the instruction a person needs (a key, an install, a device), never with a stack trace; de-bleed is asked to use the recording as its own reference and must refuse. The ADM the server renders is judged by the EBU renderer as test_adm judges the engine's. A check the probe ran that this list does not know fails too, so a new tool cannot go unchecked.

---

## tests/test_plan_parity.py and tests/player_plan.mjs {#tests-plan-parity}

### tests/test_plan_parity.py · the browser plans what the export renders
- refers-to: tests/test_plan_parity.py, tests/player_plan.mjs; frontend/src/audio/player.ts :: planClips, flatStages; frontend/src/engine/document.ts :: cleanFx; app/services/render.py :: plan, `_stage`
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

The render entry "plan mirrors the interface" warned that two copies of one rule set drift and that only a null test between the renderers guards them; this is that guard in the repository, at the plan where it is cheap. player_plan.mjs loads planClips through the project's Vite and runs it on each session after cleanFx (as the browser holds it); the test runs the export's plan on the same session and compares them field by field: each clip's media, place, length, gain, pan, fades and shape, bus, gain and pan envelopes, chain, chain automation and compressor, and each bus's gain, pan and stages, with the master's stages. 96 sessions: every kind on a track (an automated filter after it), on a clip's own chain, on a track routed to a user bus, on a bus and on the master, and one fuller session (four fade shapes, pan automation, volume automation under a clip envelope, a pitched clip, a send, a VCA, a muted track, a muted bus, a clip at another rate, a bypassed stage). It found the reverb and dialogue isolate the export ran in clip chains (the render entry above); all 96 now agree.

---

## tests/test_remote.py {#tests-remote}

### tests/test_remote.py · devices on the local network, paired or refused
- refers-to: tests/test_remote.py; app/routers/remote.py; app/core/security.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Ported from formcut's own tests with the network listener (v2.10.8). The network side refuses everything until paired; a fresh code pairs one device with a strict cookie, works once and not after it expires; five wrong codes cancel every live code; only the desktop manages pairing; removing a device ends its access; a bearer token works for clients without cookies; codes need the listener on while loopback is unchanged; and the real listener marks its requests even from this machine.

---

## tests/test_restoration.py {#tests-restoration}

### tests/test_restoration.py · de-hum, de-click and de-reverb through the export, on time
- refers-to: tests/test_restoration.py; app/services/render.py; native/formwav-dsp/src/fx.rs :: DeHum, DeClick, DeReverb, Voice
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

The sidecar's verify_live_restoration.py and verify_dereverb.py made tests, read at lag 0 rather than shifted by hand. Measured here: hum alone, each of eight harmonics of 60 Hz down 121.7 to 202.1 dB (asserted under -40); speech through de-hum, its level -0.226 dB and its spectrum away from the notches 0.033 dB from the original on average (under 0.5 and 0.1); 40 clicks of 0.6 repaired to 0.0059 at worst (under 0.05); 47 of 528,000 samples of clean speech changed by de-click (under 0.05%); in a synthetic room (T60 0.8 s, direct and reverberant energy equal), the tail in the pauses from -23.4 to -25.6 dB against the speech and SI-SDR from -1.68 to -0.52 dB (asserted at least 1.5 dB and 0.8 dB better). For de-click, de-reverb and the dialogue isolate on a track and on a bus: the export's cross-correlation peak against the dry export at 0, and at transparent settings the export equal to the dry one. The places with no read-ahead are strict expected failures (a clip's chain, the master's, a track routed to a user bus; 172 and 1023 samples late), so the day a fix lands they fail and are moved over.

---

## tests/test_room.py {#tests-room}

### tests/test_room.py · remote recording's room
- refers-to: tests/test_room.py; app/routers/room.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

From the v2.10.8 room harness: an unpaired device is refused the room; a guest checks in and only the desktop starts and stops a take; a take arrives as media with its offset and leaves the list once placed.

---

## tests/test_speech_regions.py {#tests-speech-regions}

### tests/test_speech_regions.py · where people speak, under music too
- refers-to: tests/test_speech_regions.py; app/services/vad.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

Silero VAD on the JFK speech: found in stretches with pauses between, more than 5 s of it; under a music bed 6 dB below the speech (four chords, decaying each second) more than 90% of the clean speech's time still found; the bed alone not taken for speech; a cut inside a word called unsafe and one in a pause safe. Skips without the model (Mark where people speak fetches it).

---

## tests/test_sync.py {#tests-sync}

### tests/test_sync.py · takes lined up by their sound, to a quarter of a sample
- refers-to: tests/test_sync.py; app/services/sync.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

The speech delayed by fractions of a sample in the frequency domain (2.317 ms late, 37.5 ms early, 450 ms late), each coloured by a different microphone (a 33-point Hann low-pass) with its own noise: each delay is found within 0.25 samples, and unrelated noise is not aligned.

---

## tests/test_three_way.py {#tests-three-way}

### tests/test_three_way.py · speech, music and ambience, each nearer its own part than the mix was
- refers-to: tests/test_three_way.py; app/services/three_way.py, deepfilter.py
- kind: explainer
- logged: v2.12.5 (in progress) · 2026-10-06

The sidecar's verify_three_way.py made a test. A stereo mix of known parts: the JFK speech in the centre, music 8 dB under it (chords, bass, a kick on every beat and a hat between), decorrelated pink noise 14 dB under it swelling at 0.2 Hz. Measured here: the three stems add up to the mix within 2.2e-8 (asserted under 1e-6); SI-SDR against each true part, speech 12.06 dB (the mix 7.00), music 0.65 (-8.16), ambience -3.93 (-14.49), gains of 5.07, 8.81 and 10.56 dB, as at v2.11.4 (asserted above 3, 6 and 8). Skips without DeepFilterNet's build in the models folder.

---

## tests/e2e/test_interface.py {#tests-e2e-interface}

### tests/e2e/test_interface.py · the built interface in Chromium against a real engine
- refers-to: tests/e2e/test_interface.py, tests/stand_ins/anthropic.py; frontend/dist; frontend/src/ui/shell.ts, agents.ts, agent-pane.ts, labels-pane.ts, meter.ts, record.ts
- kind: rationale
- logged: v2.12.5 (in progress) · 2026-10-06

What the release gate's interface run checked, kept. An engine serves the built app with its own data and home folders and the Anthropic stand-in as its model; each test opens a fresh browser at 1288 by 683, the smallest window the app is held to, watching page errors, console errors and every layout-shift entry from the first paint. The app boots under a CPU slowed four times with no error and no shift; the page does not scroll and the transport bar neither overflows nor wraps, with OUT, the phase meter and IN in view; every menu item's target exists once, and each View menu item reaches its control; an imported file becomes one track that plays; Settings > Agents lists the six clients and its dialog does not move as they load; and the in-app agent carries out the stand-in's chain (three model calls, each with the 30 tools and the key, the three tool results without an error, Undo run offered, the marker named agent at 00:01.000 in the Labels tab). Skips where the interface is not built or Chromium is missing.
