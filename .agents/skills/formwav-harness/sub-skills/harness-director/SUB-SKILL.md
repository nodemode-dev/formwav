---
name: harness-director
description: "First look at any formwav job: checks the engine and what is installed, identifies the media or session, and routes to the right workflow or tool. Load first when the request is broad or unclear."
---

# Harness director

## Purpose

Turn a request into a plan that will not fail at the first call. Most failures with formwav's tools come from acting before checking: a generator called whose engine is not installed, a session name guessed, a file path invented.

## Procedure

1. **Is the engine up?** Call `formwav_status`. If it fails, stop and tell the person to start formwav; see the setup sub-skill when the tools themselves are missing.
2. **What is ready?** For anything that generates, transcribes with speakers, regenerates or dubs, call `formwav_local_models_status`. It lists the local speech engines and dubbing languages installed and which providers have keys. Choose an engine that is ready, and say so when the person asked for one that is not.
3. **What is the subject?** Media: `formwav_list_media` with a word from its name, or `formwav_import_audio` with the path the person gave. A session: `formwav_list_sessions`, then `formwav_get_session`. Never guess an id or a name; list and pick.
4. **Which workflow?** Repair, words, music, dubbing, recording, delivery or cloud: load `sub-skills/workflows/SUB-SKILL.md` and follow the matching one. For a single call, `sub-skills/tools/SUB-SKILL.md` says which tool and with what.
5. **Report.** Every media id made, what each is, the measurements before and after, and any file written.

## Gate

The engine answered, the subject is a listed id or name, and the engine for any generation is one the status lists as ready.
