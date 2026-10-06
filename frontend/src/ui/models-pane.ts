import type { Engine, MediaRef } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * The Models section of the Media pane (the model-provider layer, owner decision v1.20.0): speech in an ElevenLabs
 * voice, sound effects, music from ACE-Step and other fal models or from open-weight models on this machine, and a
 * clip dubbed into another language (DS-13). What the engine reports as set up is offered; the rest is listed with
 * the key or file it needs. Every result lands as media on a new track: at the playhead, or for a dub at its clip's
 * start. The section and all its fields are built once; choosing a kind only shows and hides rows.
 */
interface Choice {
  id: string;
  label: string;
  ready: boolean;
  needs: string;
  fields: string[];
  run: (v: Record<string, string>) => Promise<{ media: MediaRef; at?: number } | { done: string }>;
}
type Providers = { providers: { id: string; ready: boolean; needs: string; presets?: { model: string; label: string; fields: string[] }[]; models?: { id: string; label: string; fields?: string[] }[] }[] };

export function mountModelsPane(host: HTMLElement, engine: Engine): void {
  let lastDub: { job: string; lang: string } | null = null;
  let lastDesign: { description: string; ids: string[] } | null = null;
  const lib = host.querySelector<HTMLElement>(".fw-library");
  if (!lib) return;
  const box = document.createElement("section");
  box.className = "fw-insp-section fw-models";
  box.innerHTML = `<h3>Models</h3><label class="fw-models-row">Make<select class="fw-models-kind" aria-label="What to make"></select></label>
<label class="fw-models-row" data-field="text">Text<textarea rows="2" class="fw-models-text"></textarea></label>
<label class="fw-models-row" data-field="voice">Voice<select class="fw-models-voice"></select></label>
<label class="fw-models-row" data-field="prompt">Prompt<textarea rows="2" class="fw-models-prompt"></textarea></label>
<label class="fw-models-row" data-field="tags">Tags<input class="fw-models-tags" placeholder="lo-fi, piano, warm"></label>
<label class="fw-models-row" data-field="lyrics">Lyrics<textarea rows="2" class="fw-models-lyrics" placeholder="[inst] for none"></textarea></label>
<label class="fw-models-row" data-field="duration">Seconds<input type="number" min="1" max="600" value="10" class="fw-models-duration"></label>
<label class="fw-models-row" data-field="model">Model<input class="fw-models-model" placeholder="fal-ai/..."></label>
<label class="fw-models-row" data-field="input">Input JSON<textarea rows="2" class="fw-models-input">{}</textarea></label>
<label class="fw-models-row" data-field="clip">Clip<select class="fw-models-clip"></select></label>
<label class="fw-models-row" data-field="language">Language<input class="fw-models-language" value="es" placeholder="es, fr, de, ja"></label>
<label class="fw-models-row" data-field="musicmodel">Music model<select class="fw-models-musicmodel"><option value="music_v1">Music v1</option><option value="music_v2">Music v2</option><option value="music_v2_5">Music v2.5</option></select></label>
<label class="fw-models-row" data-field="stems">Stems<select class="fw-models-stems"><option value="six">Six: vocals, drums, bass, piano, guitar, other</option><option value="two">Two: vocals and the rest</option></select></label>
<label class="fw-models-row" data-field="speakers">Speakers<input type="number" min="1" max="32" class="fw-models-speakers" placeholder="found by itself"></label>
<label class="fw-models-row" data-field="keyterms">Key terms<input class="fw-models-keyterms" placeholder="names and words to get right, comma-separated"></label>
<label class="fw-models-row" data-field="lines">Lines<textarea rows="3" class="fw-models-lines" placeholder="Rachel: Where were you?&#10;Adam: [laughs] Right here."></textarea></label>
<label class="fw-models-row" data-field="preview">Preview<select class="fw-models-preview"><option value="">Design a voice first</option></select></label>
<label class="fw-models-row fw-models-check" data-field="loop"><input type="checkbox" class="fw-models-loop"> Loop seamlessly</label>
<label class="fw-models-row fw-models-check" data-field="instrumental"><input type="checkbox" class="fw-models-instrumental"> Instrumental only</label>
<label class="fw-models-row fw-models-check" data-field="denoise"><input type="checkbox" class="fw-models-denoise"> Remove background noise first</label>
<button type="button" class="fw-btn fw-models-go">Make it on a new track</button><p class="fw-models-state" aria-live="polite"></p>`;
  lib.after(box);
  const $ = <T extends HTMLElement>(sel: string) => box.querySelector<T>(sel) as T;
  const kind = $<HTMLSelectElement>(".fw-models-kind");
  const voice = $<HTMLSelectElement>(".fw-models-voice");
  const clip = $<HTMLSelectElement>(".fw-models-clip");
  const go = $<HTMLButtonElement>(".fw-models-go");
  const state = $<HTMLElement>(".fw-models-state");
  const value = (field: string) => {
    const el = box.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`.fw-models-${field}`);
    if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked ? "1" : "";
    return (el?.value ?? "").trim();
  };

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: url.includes("/dub/") ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: url.includes("/dub/") ? undefined : JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return out;
  };
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const choices: Choice[] = [];
  // The clip under the time selection (on a selected track, or any), and the selection in its source's own seconds.
  const regenTarget = () => {
    const sel = engine.get("selection");
    if (!sel || sel.end <= sel.start) return null;
    const doc = engine.get("document");
    for (const t of doc.tracks) {
      if (sel.trackIds.length && !sel.trackIds.includes(t.id)) continue;
      const c = t.clips.find((x) => x.start <= sel.start && x.start + x.length >= sel.end);
      if (!c) continue;
      const rate = doc.media[c.mediaId]?.sampleRate ?? doc.sampleRate;
      const ratio = rate / doc.sampleRate;
      return { t, c, ratio, startS: (c.sourceIn + (sel.start - c.start) * ratio) / rate, endS: (c.sourceIn + (sel.end - c.start) * ratio) / rate };
    }
    return null;
  };

  const build = (p: Providers) => {
    const el = p.providers.find((x) => x.id === "elevenlabs");
    const fal = p.providers.find((x) => x.id === "fal");
    const local = p.providers.find((x) => x.id === "local");
    if (el) {
      choices.push({ id: "el-speech", label: "Speech (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["text", "voice"], run: async (v) => ({ media: await post("/api/providers/elevenlabs/speech", { text: v.text, voice_id: v.voice }) }) });
      choices.push({
        id: "el-regen", label: "Regenerate the selected words in their speaker's voice (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["text"],
        run: async (v) => {
          const target = regenTarget();
          if (!target) throw new Error("Select the words to replace first: drag across them on a clip in the lanes");
          const { t, c, startS, endS, ratio } = target;
          const out = await post("/api/providers/elevenlabs/regenerate", { media_id: c.mediaId, start_s: startS, end_s: endS, text: v.text });
          const delta = Math.round(out.delta_frames / ratio);
          const later = t.clips.filter((x) => x.id !== c.id && x.start >= c.start + c.length);
          engine.dispatch({
            type: "batch",
            commands: [
              { type: "set-clip-media", trackId: t.id, clipId: c.id, media: out.media },
              { type: "set-clip-bounds", trackId: t.id, clipId: c.id, start: c.start, sourceIn: c.sourceIn, length: c.length + delta },
              ...later.map((x) => ({ type: "move-clip" as const, trackId: t.id, clipId: x.id, start: x.start + delta })),
            ],
          });
          return { done: `Replaced ${(endS - startS).toFixed(2)} s with ${Number(out.inserted_s).toFixed(2)} s in the speaker's voice${later.length ? `; ${later.length} later clip${later.length === 1 ? "" : "s"} moved ${(delta / engine.get("document").sampleRate).toFixed(2)} s` : ""}` };
        },
      });
      choices.push({ id: "el-sound", label: "Sound effect (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["text", "duration", "loop"], run: async (v) => ({ media: await post("/api/providers/elevenlabs/sound", { text: v.text, duration_s: Number(v.duration), loop: !!v.loop }) }) });
      choices.push({
        id: "el-dub", label: "Dub a clip (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["clip", "language"],
        run: async (v) => {
          const [trackId, clipId] = v.clip.split("/");
          const c = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((x) => x.id === clipId);
          if (!c) throw new Error("Choose a clip to dub");
          const job = await post("/api/providers/elevenlabs/dub", { media_id: c.mediaId, target_lang: v.language || "es" });
          const t0 = performance.now();
          for (;;) {
            await sleep(3000);
            setText(state, `Dubbing into ${v.language}... ${Math.round((performance.now() - t0) / 1000)} s`);
            const st = await post(`/api/providers/elevenlabs/dub/${encodeURIComponent(job.job)}?lang=${encodeURIComponent(v.language)}&source=${encodeURIComponent(job.source ?? "")}`, null);
            if (st.status === "dubbed") {
              lastDub = { job: job.job, lang: v.language || "es" };
              return { media: st.media, at: c.start };
            }
          }
        },
      });
      // The rest of ElevenLabs (the v11 plan's 1.5): each request checked against ElevenLabs' OpenAPI document
      const clipOf = (v: Record<string, string>, what: string) => {
        const [trackId, clipId] = v.clip.split("/");
        const c = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((x) => x.id === clipId);
        if (!c) throw new Error(`Choose a clip ${what}`);
        return c;
      };
      const placeAll = (refs: MediaRef[], at: number) => engine.dispatch({ type: "batch", commands: refs.map((media) => ({ type: "import-media" as const, media, at })) });
      choices.push({ id: "el-music", label: "Music or a song (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["prompt", "lyrics", "duration", "musicmodel", "instrumental"],
        run: async (v) => ({ media: await post("/api/providers/elevenlabs/music", { prompt: v.prompt, lyrics: v.lyrics, seconds: Number(v.duration) || undefined, model_id: v.musicmodel, instrumental: !!v.instrumental }) }) });
      choices.push({ id: "el-voicechanger", label: "Change a clip's voice (ElevenLabs voice changer)", ready: el.ready, needs: el.needs, fields: ["clip", "voice", "denoise"],
        run: async (v) => { const c = clipOf(v, "to re-voice"); return { media: await post("/api/providers/elevenlabs/voice-changer", { media_id: c.mediaId, voice_id: v.voice, remove_background_noise: !!v.denoise }), at: c.start }; } });
      choices.push({ id: "el-isolate", label: "Isolate the voice in a clip (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["clip"],
        run: async (v) => { const c = clipOf(v, "to clean"); return { media: await post("/api/providers/elevenlabs/isolate", { media_id: c.mediaId }), at: c.start }; } });
      choices.push({ id: "el-stems", label: "Separate a clip into stems (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["clip", "stems"],
        run: async (v) => {
          const c = clipOf(v, "to separate");
          const out = await post("/api/providers/elevenlabs/stems", { media_id: c.mediaId, six: v.stems !== "two" });
          placeAll(out.stems, c.start);
          return { done: `Placed ${out.stems.length} stems on their own tracks under the clip, in one undo step` };
        } });
      choices.push({ id: "el-scribe", label: "Transcribe a clip with Scribe v2: speakers and sounds (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["clip", "speakers", "keyterms", "language"],
        run: async (v) => {
          const c = clipOf(v, "to transcribe");
          const keyterms = v.keyterms.split(",").map((k) => k.trim()).filter(Boolean);
          const out = await post("/api/providers/elevenlabs/transcribe", { media_id: c.mediaId, speakers: Number(v.speakers) || undefined, keyterms, entities: true, language: v.language.length === 2 ? v.language : "" });
          const words = out.words as { speaker?: number; event?: boolean }[];
          const speakers = new Set(words.map((w) => w.speaker).filter((x) => x !== undefined)).size;
          return { done: `Scribe v2: ${words.filter((w) => !w.event).length} words, ${speakers} speaker${speakers === 1 ? "" : "s"}, ${words.filter((w) => w.event).length} sound events; kept as the clip's transcript (scribe_v2)` };
        } });
      choices.push({ id: "el-design", label: "Design a voice from a description (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["prompt", "text"],
        run: async (v) => {
          const out = await post("/api/providers/elevenlabs/design", { description: v.prompt, text: v.text });
          lastDesign = { description: v.prompt, ids: out.previews.map((p: { generated_voice_id: string }) => p.generated_voice_id) };
          const pick = box.querySelector<HTMLSelectElement>(".fw-models-preview") as HTMLSelectElement;
          pick.replaceChildren(...lastDesign.ids.map((id, i) => new Option(`Preview ${i + 1}`, id)));
          placeAll(out.previews.map((p: { media: MediaRef }) => p.media), engine.get("transport").positionSamples);
          return { done: `Placed ${out.previews.length} previews on new tracks; keep the one you like with Keep a designed voice` };
        } });
      choices.push({ id: "el-keep", label: "Keep a designed voice (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["preview", "text"],
        run: async (v) => {
          if (!lastDesign || !v.preview) throw new Error("Design a voice first, then choose its preview");
          const out = await post("/api/providers/elevenlabs/voices", { name: v.text || "Designed voice", description: lastDesign.description, generated_voice_id: v.preview });
          voice.append(new Option(out.name, out.voice_id));
          return { done: `Kept ${out.name} among your voices` };
        } });
      choices.push({ id: "el-dialogue", label: "A dialogue between voices (ElevenLabs v3)", ready: el.ready, needs: el.needs, fields: ["lines"],
        run: async (v) => {
          const byName = new Map([...voice.options].map((o) => [o.textContent?.trim().toLowerCase() ?? "", o.value]));
          const lines = v.lines.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
            const at = l.indexOf(":");
            const who = at > 0 ? l.slice(0, at).trim().toLowerCase() : "";
            if (!byName.has(who)) throw new Error(`No voice named ${l.slice(0, Math.max(at, 0)).trim() || "(none)"}: start each line with a voice's name and a colon`);
            return { voice_id: byName.get(who), text: l.slice(at + 1).trim() };
          });
          return { media: await post("/api/providers/elevenlabs/dialogue", { lines }) };
        } });
      choices.push({ id: "el-align", label: "Align a script to a clip (ElevenLabs forced alignment)", ready: el.ready, needs: el.needs, fields: ["clip", "text"],
        run: async (v) => {
          const c = clipOf(v, "to align");
          const out = await post("/api/providers/elevenlabs/align", { media_id: c.mediaId, text: v.text });
          return { done: `Timed ${out.words.length} words of the script against the clip; kept as its transcript (alignment)` };
        } });
      choices.push({ id: "el-dubsubs", label: "Translated subtitles of the last dub (ElevenLabs)", ready: el.ready, needs: el.needs, fields: [],
        run: async () => {
          if (!lastDub) throw new Error("Dub a clip first");
          const res = await fetch(`/api/providers/elevenlabs/dub/${encodeURIComponent(lastDub.job)}/transcript?lang=${encodeURIComponent(lastDub.lang)}`);
          const out = await res.json();
          if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([out.subtitles], { type: "application/x-subrip" }));
          a.download = `dub-${lastDub.lang}.srt`;
          a.click();
          URL.revokeObjectURL(a.href);
          return { done: `Saved the ${lastDub.lang} subtitles as dub-${lastDub.lang}.srt` };
        } });
    }
    for (const preset of fal?.presets ?? []) {
      choices.push({ id: `fal:${preset.model}`, label: `${preset.label} (fal)`, ready: !!fal?.ready, needs: fal?.needs ?? "FAL_KEY", fields: preset.fields, run: async (v) => ({ media: await post("/api/providers/fal/generate", { model: preset.model, input: Object.fromEntries(preset.fields.map((f) => [f, f === "duration" ? Number(v.duration) : v[f]])) }) }) });
    }
    if (fal) choices.push({ id: "fal-other", label: "Another fal model (fal)", ready: fal.ready, needs: fal.needs, fields: ["model", "input"], run: async (v) => ({ media: await post("/api/providers/fal/generate", { model: v.model, input: JSON.parse(v.input || "{}") }) }) });
    for (const m of local?.models ?? []) {
      choices.push({ id: `local:${m.id}`, label: `${m.label} (this machine)`, ready: true, needs: "", fields: m.fields ?? ["prompt", "duration"], run: async (v) => ({ media: await post("/api/providers/local/generate", { model: m.id, prompt: v.prompt || v.text, lyrics: v.lyrics, duration_s: Number(v.duration) }) }) });
    }
    if (!local?.models?.length) choices.push({ id: "local-none", label: "Open-weight models on this machine", ready: false, needs: "backend/models/local_models.json", fields: [], run: async () => Promise.reject(new Error("no local model")) });
    for (const c of choices) {
      const option = document.createElement("option");
      option.value = c.id;
      option.disabled = !c.ready;
      option.textContent = c.ready ? c.label : `${c.label}: needs ${c.needs}`;
      kind.append(option);
    }
    const first = choices.find((c) => c.ready);
    if (first) kind.value = first.id;
    show();
  };

  let voicesLoaded = false;
  const show = () => {
    const c = choices.find((x) => x.id === kind.value);
    for (const row of box.querySelectorAll<HTMLElement>("[data-field]")) row.hidden = !c?.fields.includes(row.dataset.field ?? "");
    go.disabled = !c?.ready;
    if (c?.fields.includes("voice") && !voicesLoaded) {
      voicesLoaded = true;
      fetch("/api/providers/elevenlabs/voices").then((r) => r.json()).then((d: { voices?: { voice_id: string; name: string }[] }) => {
        for (const v of d.voices ?? []) {
          const o = document.createElement("option");
          o.value = v.voice_id;
          o.textContent = v.name;
          voice.append(o);
        }
      }).catch(() => setText(state, "Could not list the voices"));
    }
    if (c?.id === "el-regen") {
      const target = regenTarget();
      const text = box.querySelector<HTMLTextAreaElement>(".fw-models-text");
      if (!target) setText(state, "Select the words to replace on a clip, then type what they should say");
      else if (text) {
        fetch(`/api/media/${target.c.mediaId}/transcript`, { method: "POST" })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no transcript"))))
          .then((d: { words?: { text: string; start: number; end: number }[] }) => {
            const words = (d.words ?? []).filter((w) => w.end > target.startS + 0.02 && w.start < target.endS - 0.02).map((w) => w.text.trim());
            if (words.length && !text.value.trim()) text.value = words.join(" ");
            setText(state, words.length ? "Edit the words, then make it" : "Type what the selection should say");
          })
          .catch(() => setText(state, "Type what the selection should say (no transcript for this clip)"));
      }
    }
    if (c?.fields.includes("clip")) {
      const doc = engine.get("document");
      const rate = doc.sampleRate;
      const wanted = doc.tracks.flatMap((t) => t.clips.map((x) => ({ v: `${t.id}/${x.id}`, label: `${t.name}: ${doc.media[x.mediaId]?.name ?? "clip"} at ${(x.start / rate).toFixed(1)} s` })));
      const have = [...clip.options].map((o) => o.value).join("|");
      if (have !== wanted.map((w) => w.v).join("|")) {
        clip.replaceChildren(...wanted.map((w) => Object.assign(document.createElement("option"), { value: w.v, textContent: w.label })));
      }
    }
  };
  kind.addEventListener("change", show);
  box.addEventListener("focusin", (e) => {
    if ((e.target as HTMLElement).classList.contains("fw-models-clip")) show();
  });
  go.addEventListener("click", async () => {
    const c = choices.find((x) => x.id === kind.value);
    if (!c?.ready) return;
    const v: Record<string, string> = {};
    for (const f of ["text", "voice", "prompt", "tags", "lyrics", "duration", "model", "input", "clip", "language", "musicmodel", "stems", "speakers", "keyterms", "lines", "preview", "loop", "instrumental", "denoise"]) v[f] = value(f);
    go.disabled = true;
    setText(state, `Making it with ${c.label}...`);
    try {
      const result = await c.run(v);
      if ("done" in result) {
        setText(state, result.done);
      } else {
        engine.dispatch({ type: "import-media", media: result.media, at: result.at ?? engine.get("transport").positionSamples });
        setText(state, `Added ${result.media.name}`);
      }
    } catch (err) {
      setText(state, err instanceof Error ? err.message : String(err));
    } finally {
      go.disabled = false;
    }
  });
  // Until the engine lists its models the section shows one line, not a stack of empty fields; it asks again every 4 s.
  const kindRow = kind.closest<HTMLElement>("label");
  for (const row of box.querySelectorAll<HTMLElement>("[data-field]")) row.hidden = true;
  if (kindRow) kindRow.hidden = true;
  go.hidden = true;
  const load = () =>
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: Providers) => {
        if (kindRow) kindRow.hidden = false;
        go.hidden = false;
        setText(state, "");
        build(p);
      })
      .catch(() => {
        setText(state, "The engine is offline; models appear here once it starts.");
        window.setTimeout(load, 4000);
      });
  load();
}
