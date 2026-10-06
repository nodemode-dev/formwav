/**
 * The editor's Clip tab, after the approved target (research/ui_reference): the selected clip's settings as one grid
 * of fields, each editing through the engine's own command, as the Inspector's fields do: the track's name
 * (rename-track), the clip's start (move-clip), gain (set-clip-gain), fades and their shape (set-clip-fades), sound
 * type (set-clip-type) and colour (set-clip-color); its source and length are shown. A field being typed in is never
 * overwritten by an update. A dock panel like the others: its toggle flips its hidden flag.
 */
import type { Engine } from "../engine";
import type { Clip, SessionDoc, Track } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

const COLORS = ["cyan", "violet", "amber", "pink", "slate", "green", "blue", "red"];
const SHAPES: Array<[string, string]> = [["linear", "Linear"], ["equal-power", "Equal power"], ["s-curve", "S-curve"], ["exponential", "Exponential"]];
const TYPES: Array<[string, string]> = [["", "Not set"], ["dialogue", "Dialogue"], ["music", "Music"], ["effects", "Effects"], ["ambience", "Ambience"]];

export function mountClipTab(host: HTMLElement, engine: Engine): void {
  const anchor = host.querySelector<HTMLElement>(".fw-pane-timeline .fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]');
  if (!anchor || !view) return;
  const panel = document.createElement("section");
  panel.className = "fw-editor-panel fw-cliptab";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Clip");
  const field = (label: string, control: string, wide = false) => `<label class="fw-cf${wide ? " fw-cf-wide" : ""}"><span class="fw-cf-label">${label}</span>${control}</label>`;
  panel.innerHTML = `<p class="fw-cliptab-empty">Select a clip to see its settings here.</p><div class="fw-cliptab-grid">${[
    field("Track name", `<input type="text" data-f="name" maxlength="80">`, true),
    field("Source", `<output data-f="source"></output>`, true),
    field("Start (s)", `<input type="number" data-f="start" min="0" step="0.001">`),
    field("Length (s)", `<output data-f="length"></output>`),
    field("Gain (dB)", `<input type="number" data-f="gain" min="-60" max="24" step="0.1">`),
    field("Sound type", `<select data-f="type">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`),
    field("Fade in (s)", `<input type="number" data-f="fadeIn" min="0" step="0.01">`),
    field("Fade out (s)", `<input type="number" data-f="fadeOut" min="0" step="0.01">`),
    field("Fade shape", `<select data-f="shape">${SHAPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`),
    `<div class="fw-cf fw-cf-wide"><span class="fw-cf-label">Colour</span><div class="fw-cf-colors" role="group" aria-label="Clip colour"><button type="button" class="fw-cf-color" data-color="" aria-label="The track's colour" title="The track's colour"></button>${COLORS.map((c) => `<button type="button" class="fw-cf-color" data-color="${c}" aria-label="${c}" title="${c}" style="color: var(--fw-color-${c})"></button>`).join("")}</div></div>`,
  ].join("")}</div>`;
  anchor.before(panel);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.dataset.cliptab = "";
  toggle.setAttribute("aria-pressed", "false");
  toggle.hidden = true;
  toggle.textContent = "Clip";
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-pressed", String(!panel.hidden));
  });
  view.append(toggle);

  const f = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-f="${name}"]`) as T;
  let selected: string[] = [];
  const find = (doc: SessionDoc): { track: Track; clip: Clip } | null => {
    for (const track of doc.tracks) {
      const clip = track.clips.find((c) => c.id === selected[0]);
      if (clip) return { track, clip };
    }
    return null;
  };
  const sec = (samples: number, doc: SessionDoc) => samples / doc.sampleRate;
  const put = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    if (document.activeElement !== el && el.value !== value) el.value = value;
  };
  const render = () => {
    const doc = engine.get("document");
    const hit = find(doc);
    panel.classList.toggle("is-empty", !hit);
    if (!hit) return;
    const { track, clip } = hit;
    const media = doc.media[clip.mediaId];
    put(f<HTMLInputElement>("name"), track.name);
    setText(f("source"), media ? `${media.name}, ${media.format}, ${(media.sampleRate / 1000).toFixed(1)} kHz` : "");
    put(f<HTMLInputElement>("start"), sec(clip.start, doc).toFixed(3));
    setText(f("length"), sec(clip.length, doc).toFixed(3));
    put(f<HTMLInputElement>("gain"), clip.gainDb.toFixed(1));
    put(f<HTMLSelectElement>("type"), clip.soundType ?? "");
    put(f<HTMLInputElement>("fadeIn"), sec(clip.fadeIn ?? 0, doc).toFixed(2));
    put(f<HTMLInputElement>("fadeOut"), sec(clip.fadeOut ?? 0, doc).toFixed(2));
    put(f<HTMLSelectElement>("shape"), clip.fadeShape ?? "linear");
    for (const b of panel.querySelectorAll<HTMLElement>(".fw-cf-color")) b.setAttribute("aria-pressed", String((b.dataset.color ?? "") === (clip.color ?? "")));
  };

  panel.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const doc = engine.get("document");
    const hit = find(doc);
    if (!hit) return;
    const { track, clip } = hit;
    const ids = { trackId: track.id, clipId: clip.id };
    const samples = (v: string) => Math.max(0, Math.round(Number(v) * doc.sampleRate));
    const value = el.value;
    if (!Number.isFinite(Number(value)) && el instanceof HTMLInputElement && el.type === "number") return render();
    switch (el.dataset.f) {
      case "name":
        if (value.trim()) engine.dispatch({ type: "rename-track", trackId: track.id, name: value.trim() });
        break;
      case "start":
        engine.dispatch({ type: "move-clip", ...ids, start: samples(value) });
        break;
      case "gain":
        engine.dispatch({ type: "set-clip-gain", ...ids, gainDb: Math.min(24, Math.max(-60, Number(value))) });
        break;
      case "type":
        engine.dispatch({ type: "set-clip-type", ...ids, soundType: (value || null) as "dialogue" | "music" | "effects" | "ambience" | null });
        break;
      case "fadeIn":
      case "fadeOut":
      case "shape": {
        const fadeIn = el.dataset.f === "fadeIn" ? samples(value) : (clip.fadeIn ?? 0);
        const fadeOut = el.dataset.f === "fadeOut" ? samples(value) : (clip.fadeOut ?? 0);
        const shape = (el.dataset.f === "shape" ? value : (clip.fadeShape ?? "linear")) as Clip["fadeShape"];
        engine.dispatch({ type: "set-clip-fades", ...ids, fadeIn: Math.min(fadeIn, clip.length), fadeOut: Math.min(fadeOut, clip.length), shape });
        break;
      }
    }
    render();
  });
  panel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".fw-cf-color");
    const hit = b ? find(engine.get("document")) : null;
    if (!b || !hit) return;
    engine.dispatch({ type: "set-clip-color", trackId: hit.track.id, clipId: hit.clip.id, color: b.dataset.color ?? "" });
  });
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail ?? [];
    render();
  });
  engine.subscribe("document", render);
  render();
}
