/**
 * The editor's Effects, Synth and Pads tabs, after the approved target (research/ui_reference). Effects shows the
 * selected clip's track's realtime chain as cards with knobs: a knob is dragged up or down, or stepped with the arrow
 * keys, and its value is set on release through set-track-fx, as the Inspector's fields set it, within the ranges the
 * Inspector allows (the audio core skips a stage outside them); a card is bypassed or removed, and the last card adds
 * an effect. Synth's two octaves of keys, Pads' sixteen pads and the touchpad play the live instrument
 * (player.liveNote, the instrument MIDI input plays), heard whether the transport runs or not. Each panel is a dock
 * panel: its toggle flips its hidden flag, so the dock's tabs and its one-at-a-time rule treat it like the others.
 */
import type { Engine } from "../engine";
import { cleanSynth, DEFAULT_SYNTH, type SynthPatch, type TrackFx } from "../engine/document";
import { PROCESSOR_BY_ID, processorValues } from "../engine/processors";
import type { Player } from "../audio/player";
import { renderNoteMedia } from "../audio/notes";
import { setText } from "../vendor/nodemode/dom-stable";

type Param = [key: string, label: string, min: number, max: number, unit: string, log?: boolean, steps?: string[]];
interface Kind {
  label: string;
  sub: string;
  params: Param[];
  init: Record<string, number>;
}

const FREQ: Param = ["freq", "Frequency", 20, 20000, "Hz", true];
export const KINDS: Record<string, Kind> = {
  highpass: { label: "High-pass", sub: "Cuts below", params: [FREQ, ["q", "Q", 0.1, 18, ""]], init: { freq: 100, gainDb: 0, q: 0.707 } },
  lowpass: { label: "Low-pass", sub: "Cuts above", params: [FREQ, ["q", "Q", 0.1, 18, ""]], init: { freq: 8000, gainDb: 0, q: 0.707 } },
  peak: { label: "Peak EQ", sub: "Boosts or cuts a band", params: [FREQ, ["gainDb", "Gain", -24, 24, "dB"], ["q", "Q", 0.1, 18, ""]], init: { freq: 1000, gainDb: 0, q: 1 } },
  lowshelf: { label: "Low shelf", sub: "Lows up or down", params: [FREQ, ["gainDb", "Gain", -24, 24, "dB"]], init: { freq: 200, gainDb: 0, q: 0.707 } },
  highshelf: { label: "High shelf", sub: "Highs up or down", params: [FREQ, ["gainDb", "Gain", -24, 24, "dB"]], init: { freq: 6000, gainDb: 0, q: 0.707 } },
  compressor: { label: "Compressor", sub: "Evens the level", params: [["thresholdDb", "Threshold", -60, 0, "dB"], ["ratio", "Ratio", 1, 20, ":1"], ["makeupDb", "Makeup", 0, 24, "dB"]], init: { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 150, makeupDb: 0 } },
  denoise: { label: "Denoise", sub: "Lowers steady noise", params: [["reductionDb", "Reduction", 0, 40, "dB"], ["sensitivityDb", "Sensitivity", -6, 12, "dB"]], init: { reductionDb: 12, sensitivityDb: 0 } },
  dehum: { label: "De-hum", sub: "Takes out mains hum", params: [["baseHz", "Hum", 20, 400, "Hz"], ["harmonics", "Harmonics", 1, 16, ""], ["q", "Q", 1, 200, ""]], init: { baseHz: 60, harmonics: 8, q: 30 } },
  dereverb: { label: "De-reverb", sub: "Takes down room echo", params: [["t60", "Reverb time", 0.2, 3, "s"], ["reductionDb", "At most", 0, 30, "dB"]], init: { t60: 0.8, reductionDb: 6 } },
  declick: { label: "De-click", sub: "Repairs clicks", params: [["sensitivity", "Threshold", 3, 30, "x"], ["maxMs", "Longest click", 0.1, 2, "ms"]], init: { sensitivity: 8, maxMs: 1 } },
  voice: { label: "Dialogue isolate", sub: "Keeps only the voice", params: [["strength", "Strength", 0, 1, ""]], init: { strength: 1 } },
  reverb: { label: "Reverb", sub: "A room around it", params: [["room", "Room", 0, 1, ""], ["damping", "Damping", 0, 1, ""], ["width", "Width", 0, 1, ""]], init: { room: 0.5, damping: 0.5, width: 1 } },
  echo: { label: "Echo", sub: "Repeats that fade", params: [["delayMs", "Delay", 1, 2000, "ms"], ["feedback", "Feedback", 0, 0.95, ""], ["mix", "Mix", 0, 1, ""]], init: { delayMs: 300, feedback: 0.35, mix: 0.4 } },
  chorus: { label: "Chorus", sub: "Thickens it", params: [["rateHz", "Rate", 0.05, 5, "Hz"], ["depthMs", "Depth", 0, 10, "ms"], ["mix", "Mix", 0, 1, ""]], init: { rateHz: 0.8, depthMs: 3, mix: 0.5 } },
  limiter: { label: "Limiter", sub: "A ceiling for peaks", params: [["ceilingDb", "Ceiling", -30, 0, "dB"], ["releaseMs", "Release", 1, 1000, "ms"]], init: { ceilingDb: -1, releaseMs: 80 } },
  tremolo: { label: "Tremolo", sub: "A pulsing level", params: [["rateHz", "Rate", 0.05, 20, "Hz"], ["depth", "Depth", 0, 1, ""], ["spread", "Spread", 0, 1, ""]], init: { rateHz: 4, depth: 0.5, spread: 0 } },
  gate: { label: "Gate", sub: "Silences the gaps", params: [["thresholdDb", "Threshold", -80, 0, "dB"], ["releaseMs", "Release", 1, 2000, "ms"], ["rangeDb", "Range", -80, 0, "dB"]], init: { thresholdDb: -40, releaseMs: 100, rangeDb: -60 } },
  phaser: { label: "Phaser", sub: "A sweeping notch", params: [["rateHz", "Rate", 0.05, 10, "Hz"], ["depth", "Depth", 0, 1, ""], ["feedback", "Feedback", 0, 0.9, ""]], init: { rateHz: 0.5, depth: 1, feedback: 0.5 } },
  flanger: { label: "Flanger", sub: "A jet-like sweep", params: [["rateHz", "Rate", 0.05, 5, "Hz"], ["depthMs", "Depth", 0, 5, "ms"], ["feedback", "Feedback", -0.9, 0.9, ""]], init: { rateHz: 0.25, depthMs: 3, feedback: 0.5 } },
};

/** The studio processors' groups as the browser names them. */
export const PROCESSOR_GROUPS: Record<string, string> = { Eq: "EQ", Dynamics: "Dynamics", Reverb: "Reverb", Delay: "Delay", Modulation: "Modulation", Harmonic: "Harmonic", Pitch: "Pitch", Utility: "Utility" };
const UNITS: Record<string, string> = { Db: "dB", Hz: "Hz", Ms: "ms", Percent: "%", Ratio: ":1", Semitones: "st", Cents: "ct", Seconds: "s" };
const processorKinds = new Map<string, Kind>();

/** A processor's card: its parameters from the core's table, switches and choices stepped through their names. */
export function processorKind(id: string): Kind | undefined {
  const info = PROCESSOR_BY_ID.get(id);
  if (!info) return undefined;
  let k = processorKinds.get(id);
  if (!k) {
    const params: Param[] = info.params.map((p) => [p.id, p.name, p.min, p.max, UNITS[p.unit] ?? "", p.taper === "Log", p.unit === "Toggle" ? ["Off", "On"] : p.unit === "Choice" ? p.choices : undefined]);
    k = { label: info.name, sub: PROCESSOR_GROUPS[info.category] ?? "Utility", params, init: processorValues(info, undefined) };
    processorKinds.set(id, k);
  }
  return k;
}

const kindOf = (f: TrackFx): Kind | undefined => (f.kind === "processor" ? processorKind(f.id) : KINDS[f.kind]);
const valuesOf = (f: TrackFx): Record<string, number> => (f.kind === "processor" ? f.values : (f as unknown as Record<string, number>));

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const PENTA = [0, 3, 5, 7, 10];

const toT = (v: number, p: Param) => (p[5] ? Math.log(v / p[2]) / Math.log(p[3] / p[2]) : (v - p[2]) / (p[3] - p[2]));
const fromT = (t: number, p: Param) => {
  const c = Math.min(1, Math.max(0, t));
  return p[5] ? p[2] * Math.pow(p[3] / p[2], c) : p[2] + c * (p[3] - p[2]);
};
const fmt = (v: number, unit: string) => {
  if (unit === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${v < 10 ? v.toFixed(2) : Math.round(v)} Hz`;
  if (unit === "dB") return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  if (unit === ":1") return `${v.toFixed(1)}:1`;
  if (unit === "ms") return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  if (unit === "%") return `${Math.round(v)}%`;
  if (unit === "s") return `${v.toFixed(2)} s`;
  if (unit === "st" || unit === "ct") return `${v > 0 ? "+" : ""}${Math.round(v)} ${unit}`;
  return v.toFixed(2);
};
const shown = (v: number, p: Param) => (p[6] ? p[6][Math.round(v)] ?? "" : fmt(v, p[4]));
const arc = (t: number) => {
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(24 + 17 * Math.sin(a)).toFixed(2)} ${(24 - 17 * Math.cos(a)).toFixed(2)}`;
  };
  const span = 270 * Math.min(1, Math.max(0.002, t));
  return `M ${pt(-135)} A 17 17 0 ${span > 180 ? 1 : 0} 1 ${pt(-135 + span)}`;
};
const TRACK_ARC = arc(1);
interface SynthParam {
  key: "attack" | "release" | "cutoff" | "resonance";
  label: string;
  min: number;
  max: number;
}
const SYNTH_PARAMS: SynthParam[] = [
  { key: "attack", label: "Attack", min: 0.001, max: 2 },
  { key: "release", label: "Release", min: 0.01, max: 5 },
  { key: "cutoff", label: "Cutoff", min: 40, max: 20000 },
  { key: "resonance", label: "Resonance", min: 0.5, max: 12 },
];
const SYNTH_PRESETS: SynthPatch[] = [
  DEFAULT_SYNTH,
  { name: "Glass pad", wave: "saw", attack: 0.25, decay: 0.6, sustain: 0.8, release: 1.2, cutoff: 2400, resonance: 4 },
  { name: "Pluck", wave: "saw", attack: 0.002, decay: 0.25, sustain: 0, release: 0.2, cutoff: 3200, resonance: 2 },
  { name: "Warm bass", wave: "saw", attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.15, cutoff: 600, resonance: 6 },
  { name: "Square lead", wave: "square", attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.25, cutoff: 5000, resonance: 1.5 },
  { name: "Bell", wave: "sine", attack: 0.002, decay: 1.2, sustain: 0, release: 1.5, cutoff: 0, resonance: 0.707 },
];
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const synthT = (p: SynthParam, v: number) => (p.key === "cutoff" && v <= 0 ? 1 : clamp01(Math.log(Math.max(p.min, v) / p.min) / Math.log(p.max / p.min)));
const synthV = (p: SynthParam, t: number) => (p.key === "cutoff" && t >= 0.995 ? 0 : p.min * (p.max / p.min) ** clamp01(t));
const synthFmt = (p: SynthParam, v: number) =>
  p.key === "cutoff" ? (v <= 0 ? "Open" : v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`) : p.key === "resonance" ? v.toFixed(1) : v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(1)} s`;
const glyph = (paths: string, w = 2.6) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" aria-hidden="true">${paths}</svg>`;
const POWER = glyph(`<path d="M12 3v8"></path><path d="M6.3 7.3a8 8 0 1011.4 0"></path>`);
const CROSS = glyph(`<path d="M6 6l12 12"></path><path d="M18 6L6 18"></path>`);
const PLUS = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>`;
const ARROW = `<svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true"><path d="M2 7h20" stroke="currentColor" stroke-width="2"></path><path d="M19 3l5 4-5 4" fill="none" stroke="currentColor" stroke-width="2"></path></svg>`;

function panel(cls: string, label: string): HTMLElement {
  const p = document.createElement("section");
  p.className = `fw-editor-panel ${cls}`;
  p.hidden = true;
  p.setAttribute("aria-label", label);
  return p;
}

export function mountEditorTabs(host: HTMLElement, engine: Engine, player: Player): void {
  const anchor = host.querySelector<HTMLElement>(".fw-pane-timeline .fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]');
  if (!anchor || !view) return;

  const chain = panel("fw-chain", "Effects");
  chain.innerHTML = `<div class="fw-chain-head"><span class="fw-chain-title"></span><span class="fw-chain-hint">Drag a knob up or down, or use the arrow keys; it applies when you let go.</span></div><div class="fw-chain-row"></div>`;
  const synth = panel("fw-synth", "Synth");
  const keys: string[] = [];
  const blacks: string[] = [];
  const whites = [0, 2, 4, 5, 7, 9, 11];
  for (let i = 0; i < 14; i++) {
    const pitch = 48 + Math.floor(i / 7) * 12 + whites[i % 7];
    keys.push(`<button type="button" class="fw-key" data-pitch="${pitch}" aria-label="${noteName(pitch)}" style="left: ${((i * 100) / 14).toFixed(3)}%"><span>${i % 7 === 0 ? noteName(pitch) : ""}</span></button>`);
    if ([0, 1, 3, 4, 5].includes(i % 7)) blacks.push(`<button type="button" class="fw-key fw-key-black" data-pitch="${pitch + 1}" aria-label="${noteName(pitch + 1)}" style="left: calc(${(((i + 0.68) * 100) / 14).toFixed(3)}% - 1px)"></button>`);
  }
  const synthKnob = (p: SynthParam) =>
    `<div class="fw-knob" data-synth-key="${p.key}" tabindex="0" role="slider" aria-label="${p.label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" title="Drag up or down, or use the arrow keys; it applies when you let go"><svg viewBox="0 0 48 48" aria-hidden="true"><path class="fw-knob-track" d="${TRACK_ARC}"></path><path class="fw-knob-arc" d="${arc(0)}"></path><circle cx="24" cy="24" r="11"></circle></svg><span class="fw-knob-value"></span><span class="fw-knob-label">${p.label}</span></div>`;
  synth.innerHTML = `<div class="fw-synth-side"><div class="fw-synth-top"><select class="fw-synth-preset" aria-label="Synth preset">${SYNTH_PRESETS.map((p) => `<option value="${p.name}">${p.name}</option>`).join("")}<option value="Custom">Custom</option></select><span class="fw-synth-chip" title="Any MIDI keyboard you plug in plays this synth too">MIDI keyboards play it too</span></div><div class="fw-seg fw-wave-seg" role="group" aria-label="Oscillator wave">${(["sine", "triangle", "saw", "square"] as const).map((w) => `<button type="button" class="fw-seg-btn" data-wave="${w}" aria-pressed="false">${w[0].toUpperCase()}${w.slice(1)}</button>`).join("")}</div><div class="fw-synth-knobs">${SYNTH_PARAMS.map(synthKnob).join("")}</div></div><div class="fw-keys" role="group" aria-label="Keys, C3 to B4">${keys.join("")}${blacks.join("")}</div>`;
  const pads = panel("fw-pads", "Pads");
  const padNotes = Array.from({ length: 16 }, (_, i) => 48 + Math.floor(i / 5) * 12 + PENTA[i % 5]);
  pads.innerHTML = `<div class="fw-pad-grid" role="group" aria-label="Pads, C minor pentatonic">${padNotes.map((p) => `<button type="button" class="fw-pad" data-pitch="${p}">${noteName(p)}</button>`).join("")}</div><div class="fw-touch-side"><div class="fw-touch-head"><span class="fw-synth-title">Touchpad</span><span class="fw-synth-hint" title="Hold to play. Across picks the note in C minor pentatonic, up plays it harder.">Across picks the note, up plays harder</span></div><button type="button" class="fw-touch" aria-label="Touchpad: across picks the note, up sets how hard it plays"><span class="fw-touch-dot"></span></button></div>`;
  for (const p of [chain, synth, pads]) anchor.before(p);

  const toggles: Array<[HTMLElement, string]> = [[chain, "data-chain"], [synth, "data-synth"], [pads, "data-pads"]];
  for (const [p, attr] of toggles) {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "fw-mode";
    t.setAttribute(attr, "");
    t.setAttribute("aria-pressed", "false");
    t.hidden = true;
    t.textContent = p.getAttribute("aria-label") ?? "";
    t.addEventListener("click", () => {
      p.hidden = !p.hidden;
      t.setAttribute("aria-pressed", String(!p.hidden));
    });
    view.append(t);
  }

  // Effects: the selected clip's track (its lane's place among the lanes, which follow the session's track order)
  const row = chain.querySelector<HTMLElement>(".fw-chain-row") as HTMLElement;
  const title = chain.querySelector<HTMLElement>(".fw-chain-title");
  const target = () => {
    const doc = engine.get("document");
    const lanes = [...host.querySelectorAll<HTMLElement>(".fw-lane")];
    const lane = host.querySelector(".fw-clip[aria-selected='true']")?.closest<HTMLElement>(".fw-lane");
    const i = lane ? lanes.indexOf(lane) : -1;
    return doc.tracks[i >= 0 ? i : 0] ?? null;
  };
  const card = (f: TrackFx, i: number) => {
    const k = kindOf(f);
    if (!k) return "";
    const v = valuesOf(f);
    const knobs = k.params
      .map((p) => {
        const value = Number(v[p[0]] ?? k.init[p[0]] ?? p[2]);
        return `<div class="fw-knob" data-i="${i}" data-key="${p[0]}" tabindex="0" role="slider" aria-label="${k.label} ${p[1]}" aria-valuemin="${p[2]}" aria-valuemax="${p[3]}" aria-valuenow="${value}"><svg viewBox="0 0 48 48" aria-hidden="true"><path class="fw-knob-track" d="${TRACK_ARC}"></path><path class="fw-knob-arc" d="${arc(toT(value, p))}"></path><circle cx="24" cy="24" r="11"></circle></svg><span class="fw-knob-value">${shown(value, p)}</span><span class="fw-knob-label">${p[1]}</span></div>`;
      })
      .join("");
    return `<div class="fw-fx-card${k.params.length > 3 ? " fw-fx-card-wide" : ""}" data-i="${i}"><div class="fw-fx-top"><span class="fw-fx-names"><span class="fw-fx-name">${k.label}</span><span class="fw-fx-sub">${k.sub}</span></span><button type="button" class="fw-fx-bypass" data-i="${i}" aria-pressed="${!f.bypass}" aria-label="${k.label} on" title="On or bypassed">${POWER}</button><button type="button" class="fw-fx-remove" data-i="${i}" aria-label="Remove ${k.label}" title="Remove">${CROSS}</button></div><div class="fw-fx-knobs">${knobs}</div></div><span class="fw-fx-link" aria-hidden="true">${ARROW}</span>`;
  };
  const addCard = `<button type="button" class="fw-fx-add fw-fx-add-btn" title="Pick an effect in the browser's Effects tab; it joins this track's chain">${PLUS}<span>Add an effect</span></button>`;
  let shape = "";
  const render = () => {
    const track = target();
    const fx = track?.fx ?? [];
    setText(title, track ? `${track.name}: ${fx.length === 0 ? "no effects yet" : fx.length === 1 ? "one effect, live" : `${fx.length} effects, live`}` : "Import a recording to give it effects");
    const next = `${track?.id ?? ""}|${fx.map((f) => (f.kind === "processor" ? f.id : f.kind)).join(",")}`;
    if (next !== shape) {
      shape = next;
      row.innerHTML = track ? fx.map(card).join("") + addCard : "";
      return;
    }
    fx.forEach((f, i) => {
      const k = kindOf(f);
      if (!k) return;
      const v = valuesOf(f);
      row.querySelector(`.fw-fx-bypass[data-i="${i}"]`)?.setAttribute("aria-pressed", String(!f.bypass));
      for (const p of k.params) {
        const knob = row.querySelector<HTMLElement>(`.fw-knob[data-i="${i}"][data-key="${p[0]}"]`);
        if (!knob || knob.dataset.dragging) continue;
        const value = Number(v[p[0]] ?? k.init[p[0]] ?? p[2]);
        knob.querySelector(".fw-knob-arc")?.setAttribute("d", arc(toT(value, p)));
        setText(knob.querySelector(".fw-knob-value"), shown(value, p));
        knob.setAttribute("aria-valuenow", String(value));
      }
    });
  };
  const setFx = (fn: (list: TrackFx[]) => TrackFx[]) => {
    const track = target();
    if (track) engine.dispatch({ type: "set-track-fx", trackId: track.id, fx: fn([...(track.fx ?? [])]) });
  };
  const paramOf = (knob: HTMLElement): Param | undefined => {
    const f = target()?.fx?.[Number(knob.dataset.i)];
    return f ? kindOf(f)?.params.find((p) => p[0] === knob.dataset.key) : undefined;
  };
  const commit = (knob: HTMLElement, value: number) => {
    const i = Number(knob.dataset.i);
    const key = knob.dataset.key ?? "";
    setFx((list) => list.map((f, j) => (j !== i ? f : f.kind === "processor" ? { ...f, values: { ...f.values, [key]: value } } : ({ ...f, [key]: value } as TrackFx))));
  };
  row.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const bypass = el.closest<HTMLElement>(".fw-fx-bypass");
    if (bypass) return setFx((list) => list.map((f, j) => (j === Number(bypass.dataset.i) ? { ...f, bypass: !f.bypass } : f)));
    const remove = el.closest<HTMLElement>(".fw-fx-remove");
    if (remove) return setFx((list) => list.filter((_, j) => j !== Number(remove.dataset.i)));
    if (el.closest(".fw-fx-add-btn")) {
      const browserToggle = host.querySelector<HTMLButtonElement>('.fw-panel-toggle[data-pane="media"]');
      if (browserToggle?.getAttribute("aria-pressed") === "false") browserToggle.click();
      host.querySelector<HTMLButtonElement>('.fw-pane-media .fw-pane-tab[data-tab="effects"]')?.click();
      host.querySelector<HTMLInputElement>("[data-browse-search]")?.focus();
    }
  });
  row.addEventListener("pointerdown", (e) => {
    const knob = (e.target as HTMLElement).closest<HTMLElement>(".fw-knob");
    const p = knob ? paramOf(knob) : undefined;
    if (!knob || !p) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    knob.dataset.dragging = "1";
    const startY = e.clientY;
    const startT = toT(Number(knob.getAttribute("aria-valuenow")), p);
    let value = fromT(startT, p);
    const move = (ev: PointerEvent) => {
      value = fromT(startT + (startY - ev.clientY) / 160, p);
      knob.querySelector(".fw-knob-arc")?.setAttribute("d", arc(toT(value, p)));
      setText(knob.querySelector(".fw-knob-value"), shown(value, p));
    };
    const up = () => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
      delete knob.dataset.dragging;
      commit(knob, Number(value.toPrecision(4)));
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
  });
  row.addEventListener("keydown", (e) => {
    const knob = (e.target as HTMLElement).closest<HTMLElement>(".fw-knob");
    const p = knob ? paramOf(knob) : undefined;
    if (!knob || !p) return;
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.02 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.02 : 0;
    if (!step) return;
    e.preventDefault();
    const now = Number(knob.getAttribute("aria-valuenow"));
    commit(knob, p[6] ? Math.min(p[3], Math.max(p[2], Math.round(now) + Math.sign(step))) : Number(fromT(toT(now, p) + step, p).toPrecision(4)));
  });
  engine.subscribe("document", render);
  host.addEventListener("fw-selection", render);
  host.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".fw-clip")) window.setTimeout(render, 0);
  });
  render();

  // Synth and Pads: a held key or pad sounds until it is let go; the touchpad's note follows the pointer
  const hold = (root: HTMLElement, selector: string) => {
    root.addEventListener("pointerdown", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(selector);
      if (!b) return;
      const pitch = Number(b.dataset.pitch);
      b.setPointerCapture(e.pointerId);
      b.setAttribute("aria-pressed", "true");
      void player.liveNote(pitch, 100);
      const end = () => {
        b.removeEventListener("pointerup", end);
        b.removeEventListener("pointercancel", end);
        b.setAttribute("aria-pressed", "false");
        void player.liveNote(pitch, 0);
      };
      b.addEventListener("pointerup", end);
      b.addEventListener("pointercancel", end);
    });
  };
  hold(synth, ".fw-key");
  hold(pads, ".fw-pad");

  // Synth: the session's built-in synth (the live instrument and every note track without an instrument of its own).
  // A drag is heard at once through the live instrument; letting go commits the patch with the note clips it renders,
  // one undo step
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const presetPick = synth.querySelector<HTMLSelectElement>(".fw-synth-preset") as HTMLSelectElement;
  const currentSynth = () => cleanSynth(engine.get("document").synth ?? DEFAULT_SYNTH);
  const paintSynth = (p: SynthPatch) => {
    const name = SYNTH_PRESETS.some((x) => x.name === p.name) ? p.name : "Custom";
    if (presetPick.value !== name) presetPick.value = name;
    for (const b of synth.querySelectorAll<HTMLElement>("[data-wave]")) {
      const on = String(b.dataset.wave === p.wave);
      if (b.getAttribute("aria-pressed") !== on) b.setAttribute("aria-pressed", on);
    }
    for (const sp of SYNTH_PARAMS) {
      const knob = synth.querySelector<HTMLElement>(`[data-synth-key="${sp.key}"]`);
      if (!knob || knob.dataset.dragging) continue;
      const v = p[sp.key];
      knob.querySelector(".fw-knob-arc")?.setAttribute("d", arc(synthT(sp, v)));
      setText(knob.querySelector(".fw-knob-value"), synthFmt(sp, v));
      knob.setAttribute("aria-valuenow", synthT(sp, v).toFixed(3));
      knob.setAttribute("aria-valuetext", synthFmt(sp, v));
    }
  };
  let commitSeq = 0;
  const commitSynth = async (change: Partial<SynthPatch>) => {
    const next = cleanSynth({ ...currentSynth(), ...change });
    const seq = ++commitSeq;
    const doc = engine.get("document");
    const clips = doc.tracks.filter((t) => !t.instrument).flatMap((t) => t.clips.filter((c) => c.notes?.length).map((c) => ({ t, c })));
    if (!clips.length) {
      engine.dispatch({ type: "set-synth", patch: next });
      return;
    }
    void player.setLivePatch(next);
    setText(notice, `Rendering ${clips.length} note clip${clips.length === 1 ? "" : "s"} with ${next.name}`);
    try {
      const media = await Promise.all(clips.map(({ t, c }) => renderNoteMedia(engine, t.id, c.id, c.notes ?? [], next)));
      if (seq !== commitSeq) return;
      engine.dispatch({ type: "batch", commands: [{ type: "set-synth", patch: next }, ...clips.map(({ t, c }, i) => ({ type: "set-clip-notes" as const, trackId: t.id, clipId: c.id, notes: c.notes ?? [], media: media[i] }))] });
      setText(notice, `${next.name}: ${clips.length} note clip${clips.length === 1 ? "" : "s"} rendered with it`);
    } catch (err) {
      if (seq !== commitSeq) return;
      setText(notice, `Could not render the notes with the new sound: ${err instanceof Error ? err.message : String(err)}`);
      paintSynth(currentSynth());
      void player.setLivePatch(currentSynth());
    }
  };
  presetPick.addEventListener("change", () => {
    const preset = SYNTH_PRESETS.find((p) => p.name === presetPick.value);
    if (preset) void commitSynth(preset);
  });
  synth.querySelector(".fw-wave-seg")?.addEventListener("click", (e) => {
    const wave = (e.target as HTMLElement).closest<HTMLElement>("[data-wave]")?.dataset.wave as SynthPatch["wave"] | undefined;
    if (wave && wave !== currentSynth().wave) void commitSynth({ wave, name: "Custom" });
  });
  const synthParamOf = (knob: HTMLElement) => SYNTH_PARAMS.find((p) => p.key === knob.dataset.synthKey);
  synth.addEventListener("pointerdown", (e) => {
    const knob = (e.target as HTMLElement).closest<HTMLElement>("[data-synth-key]");
    const sp = knob ? synthParamOf(knob) : undefined;
    if (!knob || !sp) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    knob.dataset.dragging = "1";
    const startY = e.clientY;
    const startT = synthT(sp, currentSynth()[sp.key]);
    let draft: SynthPatch = currentSynth();
    const move = (ev: PointerEvent) => {
      const v = synthV(sp, startT + (startY - ev.clientY) / 160);
      draft = { ...currentSynth(), [sp.key]: v, name: "Custom" };
      knob.querySelector(".fw-knob-arc")?.setAttribute("d", arc(synthT(sp, v)));
      setText(knob.querySelector(".fw-knob-value"), synthFmt(sp, v));
      void player.setLivePatch(draft);
    };
    const up = () => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
      delete knob.dataset.dragging;
      if (draft[sp.key] !== currentSynth()[sp.key]) void commitSynth({ [sp.key]: Number(draft[sp.key].toPrecision(4)), name: "Custom" });
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
  });
  synth.addEventListener("keydown", (e) => {
    const knob = (e.target as HTMLElement).closest<HTMLElement>("[data-synth-key]");
    const sp = knob ? synthParamOf(knob) : undefined;
    if (!knob || !sp) return;
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.02 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.02 : 0;
    if (!step) return;
    e.preventDefault();
    void commitSynth({ [sp.key]: Number(synthV(sp, synthT(sp, currentSynth()[sp.key]) + step).toPrecision(4)), name: "Custom" });
  });
  engine.subscribe("document", () => paintSynth(currentSynth()));
  paintSynth(currentSynth());
  const touch = pads.querySelector<HTMLElement>(".fw-touch") as HTMLElement;
  const dot = pads.querySelector<HTMLElement>(".fw-touch-dot") as HTMLElement;
  let sounding: number | null = null;
  const at = (e: PointerEvent) => {
    const r = touch.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    dot.style.left = `${(x * 100).toFixed(2)}%`;
    dot.style.top = `${((1 - y) * 100).toFixed(2)}%`;
    const step = Math.min(14, Math.floor(x * 15));
    return { pitch: 48 + Math.floor(step / 5) * 12 + PENTA[step % 5], velocity: Math.round(40 + y * 87) };
  };
  touch.addEventListener("pointerdown", (e) => {
    touch.setPointerCapture(e.pointerId);
    touch.setAttribute("aria-pressed", "true");
    const n = at(e);
    sounding = n.pitch;
    void player.liveNote(n.pitch, n.velocity);
  });
  touch.addEventListener("pointermove", (e) => {
    if (sounding === null) return;
    const n = at(e);
    if (n.pitch === sounding) return;
    void player.liveNote(sounding, 0);
    sounding = n.pitch;
    void player.liveNote(n.pitch, n.velocity);
  });
  const release = () => {
    if (sounding !== null) void player.liveNote(sounding, 0);
    sounding = null;
    touch.setAttribute("aria-pressed", "false");
  };
  touch.addEventListener("pointerup", release);
  touch.addEventListener("pointercancel", release);
}
