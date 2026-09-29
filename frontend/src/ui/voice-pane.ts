import type { Engine } from "../engine";
import { importFile } from "../io/media-client";
import { setText } from "../vendor/nodemode/dom-stable";

/** formwave's /status, as its engine reports it. */
interface VoiceStatus {
  loaded: boolean;
  model: string | null;
  loading: boolean;
  available_models: string[];
  model_modes: string[];
  speakers: string[];
  device?: { device?: string };
  transcription_available: boolean;
  asr_models: { id: string; name: string; available: boolean; active: boolean }[];
}

const MODES: Record<string, string> = { voice_clone: "Clone a voice", custom: "Preset voice", voice_design: "Design a voice" };
const LANGUAGES = ["English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"];
const modelLabel = (id: string) => id.replace(/^Qwen\/Qwen3-TTS-12Hz-/, "Qwen3-TTS ").replace(/-/g, " ");

const BODY = `
<p class="fw-empty-note fw-voice-state"></p>
<section class="fw-insp-section">
  <div class="fw-insp-head">Model</div>
  <label class="fw-field"><span>Checkpoint</span><select data-v="model"></select><button type="button" class="fw-ibtn" data-v="load">Load</button></label>
</section>
<section class="fw-insp-section">
  <div class="fw-insp-head">Generate speech</div>
  <label class="fw-field"><span>Mode</span><select data-v="mode"></select><span></span></label>
  <label class="fw-field" data-for="custom"><span>Voice</span><select data-v="speaker"></select><span></span></label>
  <label class="fw-field" data-for="voice_clone"><span>Reference</span><select data-v="ref"></select><span></span></label>
  <label class="fw-field fw-field-stack" data-for="voice_clone"><span>Its words</span><textarea data-v="refText" rows="2" placeholder="What the reference clip says"></textarea></label>
  <label class="fw-field fw-field-stack" data-for="custom voice_design"><span>Voice notes</span><textarea data-v="instruct" rows="2" placeholder="For example: a warm, low voice, speaking slowly"></textarea></label>
  <label class="fw-field"><span>Language</span><select data-v="language">${LANGUAGES.map((l) => `<option>${l}</option>`).join("")}</select><span></span></label>
  <label class="fw-field fw-field-stack"><span>Text</span><textarea data-v="text" rows="4" placeholder="What the voice should say"></textarea></label>
  <button type="button" class="fw-ibtn fw-btn-export fw-voice-go" data-v="generate">Generate to the timeline</button>
</section>
<section class="fw-insp-section">
  <div class="fw-insp-head">Transcribe</div>
  <label class="fw-field"><span>Model</span><select data-v="asr"></select><span></span></label>
  <button type="button" class="fw-ibtn" data-v="transcribe">Transcribe the selected clip</button>
  <textarea class="fw-voice-transcript" data-v="transcript" rows="5" readonly placeholder="The transcript appears here"></textarea>
</section>`;

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  return typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`;
}

function setOptions(select: HTMLSelectElement, items: [string, string][]): void {
  const signature = JSON.stringify(items);
  if (select.dataset.options === signature) return;
  const keep = select.value;
  select.dataset.options = signature;
  select.replaceChildren(...items.map(([value, label]) => new Option(label, value)));
  if (items.some(([value]) => value === keep)) select.value = keep;
}

/** formwave's voice in formwav: load a Qwen3-TTS checkpoint, generate speech onto the timeline, transcribe a clip. */
export function mountVoicePane(host: HTMLElement, engine: Engine): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-media");
  const body = host.querySelector<HTMLElement>(".fw-voice-body");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  if (!pane || !body) return;
  body.innerHTML = BODY;
  const field = <T extends HTMLElement>(name: string) => body.querySelector<T>(`[data-v="${name}"]`) as T;
  const stateLine = body.querySelector<HTMLElement>(".fw-voice-state");
  let status: VoiceStatus | null = null;
  let busy = false;
  let selected: string[] = [];
  let generated = 0;
  let lastError = "";
  const say = (text: string) => setText(stateLine, text);

  const selectedMedia = () => {
    const doc = engine.get("document");
    for (const t of doc.tracks) for (const c of t.clips) if (c.id === selected[0]) return doc.media[c.mediaId];
    return undefined;
  };
  const enable = (name: string, on: boolean) => {
    const el = field<HTMLButtonElement | HTMLSelectElement>(name);
    if (el.disabled === on) el.disabled = !on;
  };

  const render = () => {
    const doc = engine.get("document");
    setOptions(field<HTMLSelectElement>("ref"), Object.values(doc.media).map((m) => [m.id, m.name]));
    const s = status;
    setOptions(field<HTMLSelectElement>("model"), (s?.available_models ?? []).map((id) => [id, modelLabel(id)]));
    const modes = s?.loaded ? s.model_modes : [];
    setOptions(field<HTMLSelectElement>("mode"), modes.map((m) => [m, MODES[m] ?? m]));
    setOptions(field<HTMLSelectElement>("speaker"), (s?.speakers ?? []).map((v) => [v, v]));
    setOptions(field<HTMLSelectElement>("asr"), (s?.asr_models ?? []).map((m) => [m.id, m.available ? m.name : `${m.name} (not downloaded)`]));
    const mode = field<HTMLSelectElement>("mode").value;
    for (const row of body.querySelectorAll<HTMLElement>("[data-for]")) {
      const on = (row.dataset.for ?? "").split(" ").includes(mode);
      if (row.hidden === on) row.hidden = !on;
    }
    enable("model", !!s && !busy && !s.loading);
    enable("load", !!s && !busy && !s.loading);
    enable("generate", !!s?.loaded && !busy);
    enable("asr", !!s && !busy);
    enable("transcribe", !!s?.transcription_available && selected.length === 1 && !busy);
    if (!s) return;
    if (lastError) {
      say(lastError);
      return;
    }
    const device = s.device?.device ?? "this computer";
    say(
      s.loading
        ? "Loading the model..."
        : s.loaded && s.model
          ? `${modelLabel(s.model)} loaded (${device}).`
          : `Load a checkpoint to generate speech. Models run on this computer (${device}).`,
    );
  };

  const refresh = async () => {
    const res = await fetch("/api/voice/status").catch(() => null);
    if (!res) {
      status = null;
      say("The engine is not reachable.");
    } else if (!res.ok) {
      status = null;
      say(await readError(res));
    } else status = (await res.json()) as VoiceStatus;
    render();
    if (status?.loading) window.setTimeout(() => void refresh(), 1500);
  };

  const run = async (task: () => Promise<void>) => {
    busy = true;
    lastError = "";
    render();
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      say(message);
      setText(notice, message);
    } finally {
      busy = false;
      await refresh();
    }
  };

  const mediaFile = async (id: string, name: string) => {
    const res = await fetch(`/api/media/${id}/audio`);
    if (!res.ok) throw new Error(`could not read ${name}`);
    return new File([await res.blob()], name, { type: "audio/wav" });
  };

  body.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).dataset.v === "mode") render();
  });
  body.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v;
    if (action === "load")
      void run(async () => {
        const form = new FormData();
        form.set("model_id", field<HTMLSelectElement>("model").value);
        say("Loading the model...");
        const res = await fetch("/api/voice/load", { method: "POST", body: form });
        if (!res.ok) throw new Error(await readError(res));
      });
    else if (action === "generate")
      void run(async () => {
        const mode = field<HTMLSelectElement>("mode").value;
        const text = field<HTMLTextAreaElement>("text").value.trim();
        if (!text) throw new Error("Type what the voice should say.");
        const form = new FormData();
        form.set("text", text);
        form.set("language", field<HTMLSelectElement>("language").value);
        form.set("mode", mode);
        form.set("speaker", field<HTMLSelectElement>("speaker").value);
        form.set("instruct", field<HTMLTextAreaElement>("instruct").value);
        form.set("ref_text", field<HTMLTextAreaElement>("refText").value);
        if (mode === "voice_clone") {
          const ref = engine.get("document").media[field<HTMLSelectElement>("ref").value];
          if (!ref) throw new Error("Choose a reference clip from Media to clone.");
          form.set("ref_audio", await mediaFile(ref.id, "reference.wav"));
        }
        say("Generating...");
        const res = await fetch("/api/voice/generate", { method: "POST", body: form });
        if (!res.ok) throw new Error(await readError(res));
        const { audio_b64 } = (await res.json()) as { audio_b64: string };
        const bytes = Uint8Array.from(atob(audio_b64), (ch) => ch.charCodeAt(0));
        generated += 1;
        const doc = engine.get("document");
        const media = await importFile(new File([bytes], `Voice ${generated}.wav`, { type: "audio/wav" }), doc.tracks.length ? doc.sampleRate : undefined);
        engine.dispatch({ type: "import-media", media, at: engine.get("transport").positionSamples });
        setText(notice, `Generated ${media.name} onto a new track at the playhead`);
      });
    else if (action === "transcribe")
      void run(async () => {
        const media = selectedMedia();
        if (!media) throw new Error("Select one clip to transcribe.");
        const asr = field<HTMLSelectElement>("asr").value;
        if (asr && !status?.asr_models.find((m) => m.id === asr)?.active) {
          const pick = new FormData();
          pick.set("asr_id", asr);
          const chosen = await fetch("/api/voice/asr/select", { method: "POST", body: pick });
          if (!chosen.ok) throw new Error(await readError(chosen));
        }
        const form = new FormData();
        form.set("audio", await mediaFile(media.id, media.name));
        say("Transcribing...");
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        if (!res.ok) throw new Error(await readError(res));
        field<HTMLTextAreaElement>("transcript").value = ((await res.json()) as { text: string }).text;
      });
  });

  pane.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".fw-pane-tab");
    const name = tab?.dataset.tab;
    if (!tab || !name || (pane.dataset.tab ?? "media") === name) return;
    pane.dataset.tab = name;
    for (const t of pane.querySelectorAll<HTMLElement>(".fw-pane-tab")) {
      t.classList.toggle("is-active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    }
    for (const panel of pane.querySelectorAll<HTMLElement>("[data-panel]")) panel.hidden = panel.dataset.panel !== name;
    if (name === "voice") void refresh();
  });
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail;
    render();
  });
  engine.subscribe("document", render);
  render();
}
