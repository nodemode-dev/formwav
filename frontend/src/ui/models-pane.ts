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
  run: (v: Record<string, string>) => Promise<{ media: MediaRef; at?: number }>;
}
type Providers = { providers: { id: string; ready: boolean; needs: string; presets?: { model: string; label: string; fields: string[] }[]; models?: { id: string; label: string; fields?: string[] }[] }[] };

export function mountModelsPane(host: HTMLElement, engine: Engine): void {
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
<button type="button" class="fw-btn fw-models-go">Make it on a new track</button><p class="fw-models-state" aria-live="polite"></p>`;
  lib.after(box);
  const $ = <T extends HTMLElement>(sel: string) => box.querySelector<T>(sel) as T;
  const kind = $<HTMLSelectElement>(".fw-models-kind");
  const voice = $<HTMLSelectElement>(".fw-models-voice");
  const clip = $<HTMLSelectElement>(".fw-models-clip");
  const go = $<HTMLButtonElement>(".fw-models-go");
  const state = $<HTMLElement>(".fw-models-state");
  const value = (field: string) => (box.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`.fw-models-${field}`)?.value ?? "").trim();

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: url.includes("/dub/") ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: url.includes("/dub/") ? undefined : JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return out;
  };
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const choices: Choice[] = [];

  const build = (p: Providers) => {
    const el = p.providers.find((x) => x.id === "elevenlabs");
    const fal = p.providers.find((x) => x.id === "fal");
    const local = p.providers.find((x) => x.id === "local");
    if (el) {
      choices.push({ id: "el-speech", label: "Speech (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["text", "voice"], run: async (v) => ({ media: await post("/api/providers/elevenlabs/speech", { text: v.text, voice_id: v.voice }) }) });
      choices.push({ id: "el-sound", label: "Sound effect (ElevenLabs)", ready: el.ready, needs: el.needs, fields: ["text", "duration"], run: async (v) => ({ media: await post("/api/providers/elevenlabs/sound", { text: v.text, duration_s: Number(v.duration) }) }) });
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
            if (st.status === "dubbed") return { media: st.media, at: c.start };
          }
        },
      });
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
    for (const f of ["text", "voice", "prompt", "tags", "lyrics", "duration", "model", "input", "clip", "language"]) v[f] = value(f);
    go.disabled = true;
    setText(state, `Making it with ${c.label}...`);
    try {
      const { media, at } = await c.run(v);
      engine.dispatch({ type: "import-media", media, at: at ?? engine.get("transport").positionSamples });
      setText(state, `Added ${media.name}`);
    } catch (err) {
      setText(state, err instanceof Error ? err.message : String(err));
    } finally {
      go.disabled = false;
    }
  });
  fetch("/api/providers").then((r) => r.json()).then(build).catch(() => setText(state, "The engine did not list its models"));
}
