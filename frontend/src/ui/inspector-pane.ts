import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import type { FadeShape } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

const BODY = `
<p class="fw-empty-note fw-insp-empty"></p>
<div class="fw-insp-section fw-insp-clip" hidden>
  <div class="fw-insp-head">Clip</div>
  <label class="fw-field"><span>Start</span><input type="number" step="0.001" min="0" data-f="start"><output>s</output></label>
  <div class="fw-field"><span>Length</span><output data-o="length"></output><span></span></div>
  <label class="fw-field"><span>Clip gain</span><input type="range" min="-24" max="24" step="0.1" data-f="gain"><output data-o="gain"></output></label>
  <label class="fw-field"><span>Fade in</span><input type="number" step="0.01" min="0" data-f="fadeIn"><output>s</output></label>
  <label class="fw-field"><span>Fade out</span><input type="number" step="0.01" min="0" data-f="fadeOut"><output>s</output></label>
  <label class="fw-field"><span>Fade curve</span><select data-f="shape"><option value="linear">Linear</option><option value="equal-power">Equal power</option><option value="s-curve">S-curve</option><option value="exponential">Exponential</option></select><span></span></label>
</div>
<div class="fw-insp-section fw-insp-effects" hidden>
  <div class="fw-insp-head">Effects</div>
  <button type="button" class="fw-ibtn fw-btn-export fw-voice-go" data-fx="enhance" title="formcut's voice-clean: rumble cut, denoise, gentle compression and a limiter">Enhance speech</button>
  <label class="fw-field fw-field-stack"><span>Effect</span><select data-fx="pick"></select></label>
  <button type="button" class="fw-ibtn" data-fx="apply">Apply to this clip</button>
</div>
<div class="fw-insp-section fw-insp-track" hidden>
  <div class="fw-insp-head fw-insp-track-name">Track</div>
  <label class="fw-field"><span>Volume</span><input type="range" min="-60" max="12" step="0.1" data-f="volume"><output data-o="volume"></output></label>
  <label class="fw-field"><span>Pan</span><input type="range" min="-1" max="1" step="0.01" data-f="pan"><output data-o="pan"></output></label>
</div>`;

const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const panText = (v: number) => (v === 0 ? "C" : `${v < 0 ? "L" : "R"} ${Math.round(Math.abs(v) * 100)}`);

/** The selected clip and its track, as formcut's inspector shows the selected clip's properties. */
export function mountInspector(host: HTMLElement, engine: Engine): void {
  const body = host.querySelector<HTMLElement>(".fw-inspector-body");
  const meta = host.querySelector<HTMLElement>(".fw-pane-inspector .fw-pane-meta");
  if (!body) return;
  body.innerHTML = BODY;
  const field = <T extends HTMLElement>(name: string) => body.querySelector<T>(`[data-f="${name}"]`);
  const out = (name: string) => body.querySelector<HTMLElement>(`[data-o="${name}"]`);
  let selected: string[] = [];

  const find = (doc: SessionDoc): { track: Track; clip: Clip } | null => {
    if (selected.length !== 1) return null;
    for (const track of doc.tracks) {
      const clip = track.clips.find((c) => c.id === selected[0]);
      if (clip) return { track, clip };
    }
    return null;
  };
  const put = (el: HTMLInputElement | HTMLSelectElement | null, value: string) => {
    if (el && document.activeElement !== el && el.value !== value) el.value = value;
  };
  const show = (el: Element | null, on: boolean) => {
    if (el instanceof HTMLElement && el.hidden === on) el.hidden = !on;
  };

  const render = () => {
    const doc = engine.get("document");
    const hit = find(doc);
    show(body.querySelector(".fw-insp-empty"), !hit);
    show(body.querySelector(".fw-insp-clip"), !!hit);
    show(body.querySelector(".fw-insp-track"), !!hit);
    show(body.querySelector(".fw-insp-effects"), !!hit);
    if (!hit) {
      const seconds = doc.tracks.reduce((end, t) => Math.max(end, ...t.clips.map((c) => (c.start + c.length) / doc.sampleRate)), 0);
      setText(body.querySelector(".fw-insp-empty"), selected.length > 1 ? `${selected.length} clips selected. Select one clip to edit its properties.` : doc.tracks.length ? `Session: ${doc.tracks.length} track${doc.tracks.length === 1 ? "" : "s"}, ${(doc.sampleRate / 1000).toFixed(1)} kHz, ${seconds.toFixed(1)} s. Select a clip to edit its properties.` : "Import audio to begin. Selecting a clip shows its properties here.");
      setText(meta, "");
      return;
    }
    const { track, clip } = hit;
    const rate = doc.sampleRate;
    setText(meta, doc.media[clip.mediaId]?.name ?? "");
    put(field<HTMLInputElement>("start"), (clip.start / rate).toFixed(3));
    setText(out("length"), `${(clip.length / rate).toFixed(3)} s`);
    put(field<HTMLInputElement>("gain"), String(clip.gainDb));
    setText(out("gain"), db(clip.gainDb));
    put(field<HTMLInputElement>("fadeIn"), ((clip.fadeIn ?? 0) / rate).toFixed(2));
    put(field<HTMLInputElement>("fadeOut"), ((clip.fadeOut ?? 0) / rate).toFixed(2));
    put(field<HTMLSelectElement>("shape"), clip.fadeShape ?? "linear");
    setText(body.querySelector(".fw-insp-track-name"), `Track · ${track.name}`);
    const automated = track.automation;
    const volume = field<HTMLInputElement>("volume");
    const pan = field<HTMLInputElement>("pan");
    put(volume, String(track.gainDb));
    put(pan, String(track.pan ?? 0));
    if (volume && volume.disabled !== !!automated?.volume?.length) volume.disabled = !!automated?.volume?.length;
    if (pan && pan.disabled !== !!automated?.pan?.length) pan.disabled = !!automated?.pan?.length;
    setText(out("volume"), automated?.volume?.length ? "auto" : db(track.gainDb));
    setText(out("pan"), automated?.pan?.length ? "auto" : panText(track.pan ?? 0));
  };

  body.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.f === "gain") setText(out("gain"), db(Number(el.value)));
    else if (el.dataset.f === "volume") setText(out("volume"), db(Number(el.value)));
    else if (el.dataset.f === "pan") setText(out("pan"), panText(Number(el.value)));
  });
  body.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const doc = engine.get("document");
    const hit = find(doc);
    if (!hit) return;
    const { track, clip } = hit;
    const rate = doc.sampleRate;
    const num = Number(el.value);
    const trackId = track.id;
    const clipId = clip.id;
    switch (el.dataset.f) {
      case "start":
        if (Number.isFinite(num)) engine.dispatch({ type: "move-clip", trackId, clipId, start: Math.max(0, Math.round(num * rate)) });
        break;
      case "gain":
        engine.dispatch({ type: "set-clip-gain", trackId, clipId, gainDb: num });
        break;
      case "fadeIn":
      case "fadeOut": {
        const fadeIn = el.dataset.f === "fadeIn" ? Math.round(Math.max(0, num) * rate) : clip.fadeIn ?? 0;
        const fadeOut = el.dataset.f === "fadeOut" ? Math.round(Math.max(0, num) * rate) : clip.fadeOut ?? 0;
        if (Number.isFinite(num)) engine.dispatch({ type: "set-clip-fades", trackId, clipId, fadeIn, fadeOut, shape: clip.fadeShape });
        break;
      }
      case "shape":
        engine.dispatch({ type: "set-clip-fades", trackId, clipId, fadeIn: clip.fadeIn ?? 0, fadeOut: clip.fadeOut ?? 0, shape: el.value as FadeShape });
        break;
      case "volume":
        engine.dispatch({ type: "set-track-gain", trackId, gainDb: num });
        break;
      case "pan":
        engine.dispatch({ type: "set-track-pan", trackId, pan: num });
        break;
    }
    render();
  });

  const pick = body.querySelector<HTMLSelectElement>('[data-fx="pick"]');
  void fetch("/api/effects")
    .then((res) => (res.ok ? res.json() : []))
    .then((groups: { group: string; effects: { id: string; label: string }[] }[]) => {
      if (!pick) return;
      pick.replaceChildren(
        ...groups.map((g) => {
          const group = document.createElement("optgroup");
          group.label = g.group;
          group.append(...g.effects.map((fx) => new Option(fx.label, fx.id)));
          return group;
        }),
      );
    })
    .catch(() => undefined);
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  body.addEventListener("click", async (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-fx]")?.dataset.fx;
    if (action !== "enhance" && action !== "apply") return;
    const hit = find(engine.get("document"));
    const name = action === "enhance" ? "voice-clean" : pick?.value;
    if (!hit || !name) return;
    const buttons = [...body.querySelectorAll<HTMLButtonElement>("button[data-fx]")];
    for (const b of buttons) b.disabled = true;
    const label = action === "enhance" ? "Enhance speech" : pick?.selectedOptions[0]?.textContent ?? name;
    setText(notice, `Applying ${label}...`);
    try {
      const res = await fetch(`/api/media/${hit.clip.mediaId}/effect?name=${encodeURIComponent(name)}`, { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      engine.dispatch({ type: "set-clip-media", trackId: hit.track.id, clipId: hit.clip.id, media: out as unknown as MediaRef });
      setText(notice, `Applied ${label} to the clip`);
    } catch (err) {
      setText(notice, `Could not apply ${label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      for (const b of buttons) b.disabled = false;
    }
  });

  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail;
    render();
  });
  engine.subscribe("document", render);
  render();
}
