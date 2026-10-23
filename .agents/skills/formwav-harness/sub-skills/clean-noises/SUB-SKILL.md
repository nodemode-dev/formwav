---
name: clean-noises
description: "Clean clicks, crackle, pops, ticks, mouth noises, whistles and other short noises out of a recording as an agent: find each event, select it with a box, heal it as an explicit step, and check by measuring before and after. Use when the person asks to remove clicks, crackle, pops, a chirp, a bump or a single noise from a recording, to heal or spot-repair a sound, or to do what the spectrogram heal brush does. Trigger on remove the click, crackle, de-click, heal, spot heal, spectral repair, formwav_heal_selection, clean up noises in this take."
---

# Clean clicks, crackle and noises

## What the person gets

The short noises they named are gone from a new copy of the recording and the speech or music around them is untouched. In the app this is done by painting or boxing a sound in the spectrogram and pressing Heal; an agent does the same two steps through tools, so no brush and no window is needed.

## Why it is two steps

Selecting and healing are separate on purpose. A selection is only a set of boxes; nothing changes until Heal is asked for. So the agent decides the boxes from measurements, then calls Heal once, and then measures the result. Never ask the app to heal as a side effect of marking something (a brush stroke, a drag, a hover): the brush only selects, and Heal is an explicit call.

## Steps, in order

1. `formwav_status`, then find the media with `formwav_list_media` or bring the file in with `formwav_import_audio`. Keep its `media_id`; sources never change.
2. Measure the whole recording: `formwav_analyze_media` (peak, RMS, clipped samples, DC offset). Keep the numbers for the report.
3. Find candidate events. formwav has no click detector tool, so measure or listen:
   - Export the media with `formwav_export_media` to a path the person gave (or a scratch path) and read the samples with your own tools. A click is a sample-to-sample jump far above its surroundings (for example a first difference more than 8 times the median over the previous 50 ms); crackle is a run of such jumps; a chirp or whistle is a narrow band that stands out of the spectrogram.
   - If you can reach the engine's loopback HTTP, `GET /api/media/{media_id}/spectrogram.png` shows the spectrogram and `GET /api/media/{media_id}/spectrum?start=[s]&end=[s]` measures a stretch.
   - `formwav_speech_regions` tells you where speech is, so a candidate inside a word can be judged more carefully than one in a pause.
   - List each event with its time. If an event is doubtful, say so rather than healing it.
4. Select each event with a box: `from` and `to` in seconds of the media (the event's extent padded by about 5 to 10 ms either side), `low` and `high` in Hz (a click or crackle is broadband: low 200 to high half the sample rate; a whistle or chirp: just the band it occupies, with a little margin). Keep one box per event so you can check each. Keep a record of the boxes; they are the selection.
5. Heal explicitly: `formwav_heal_selection` with `media_id` and `boxes` (all the boxes of one pass, up to 2000). It returns new media and keeps the source. A pass is one call; check it before another. For a long, heavily crackled stretch with hundreds of events, whole-recording `formwav_apply_effect` with a de-click or de-crackle effect (find the id with `formwav_list_effects` and the word click or crackle) is the right tool, not hundreds of boxes.
6. Check by measuring, before and after. Export the healed media and, with your own tools, compare each box's window with the source: the event's peak or its band's level should fall to about its surroundings (within roughly 3 dB of the 50 ms either side), and the samples outside the boxes should be unchanged within rounding. Run `formwav_analyze_media` on the result and report both sets of numbers. If an event is still there, widen that box or tighten its band and heal again from the source with the corrected boxes, never stack passes on a bad result.
7. Report: the media ids made, the events found with their times and boxes, the numbers before and after, and anything you left alone and why.

## Never

- Never ask the app to heal on a brush stroke, drag or any selection gesture, and never drive the interface to paint, box or lasso a selection. The boxes you pass to `formwav_heal_selection` are the selection; the call is the heal.
- Never heal without having measured the event first, and never report a heal without the after measurement.
- Never change the engine's heal setting (`FORMWAV_HEAL_SOURCE`) to get a result; it is the person's choice.
- Never overwrite the source or export over the person's original file.
