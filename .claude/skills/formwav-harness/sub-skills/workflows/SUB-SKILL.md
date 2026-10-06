---
name: workflows
description: "Step-by-step formwav workflows with the exact tools in order: repairing a recording, podcast cleanup, transcript work and regenerating words, music and songs, sound effects, dubbing, recording a take, rendering and delivering a session, and the cloud. Load for any formwav job with more than one step."
---

# Workflows

## Purpose

Give each common job its order of tools, so steps receive the values earlier steps produce and nothing is skipped. The full steps are in `references/workflows.md`; this page says which to use.

## Which workflow

| The person wants | Workflow in references/workflows.md |
| --- | --- |
| A noisy, humming, clicking, roomy or leaking recording fixed | Repair a recording |
| An interview or podcast made clean and even | Podcast cleanup |
| Words changed, or the opening redone | Transcript work |
| A song, a bed of music, a jingle | Music and songs |
| A whoosh, rain, a door, an ambience | Sound effects |
| The same speech in another language | Dubbing |
| A take from an audio interface | Recording a take |
| A finished file of a session, stereo, 5.1 or ADM | Deliver a session |
| Files into or out of Google Drive or Dropbox | The cloud |

## Before any of them

Run the director's first two checks (`formwav_status`, and `formwav_local_models_status` before generating). Keep the list of media ids made, with what each is.

## What the tools do not do yet

They do not edit a saved session's mix (gains, pans, track order) or cut words out of a media: say so, and point the person to formwav's own interface, where the Transcript tab cuts words and the in-app agent edits the session. Shared editing of one session from several devices is in the interface too.
