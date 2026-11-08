import type { Engine, SessionDoc } from "../engine";
import { emptyDocument, sessionLength, type AutoPoint, type Clip, type MediaRef, type Track, type TrackFx } from "../engine/document";
import { importFile } from "../io/media-client";
import { commands } from "./commands";
import "../styles/start-content.css";

/**
 * Home > Start's Demos and Templates, as the form family shows "Try the demo" and its templates on Start (formdeck's
 * card grids). Kept apart from home.ts, which mounts START_CONTENT_HTML in its Start page and nothing else.
 *
 * Demos: the three browser demos (demo/ Mix, demos/repair, demos/produce) as real formwav sessions. Their recordings
 * ship in the build under /demos/<id>/ (scripts/demo-media.py decodes the demos' packs there, with peaks.json for the
 * thumbnails); opening one imports them into the engine and loads a new unsaved session, so the demo is never written
 * over. Templates: a new session whose tracks, colours, buses, sends and effects are made by the reducer's own commands.
 * Both go through projects.ts (fw-load-session) for its unsaved-changes guard and session name; File > New from
 * template, Help > Demos and the demo items, and the commands demo.open and template.new, reach the same paths.
 */

const RATE = 44100;
type Peaks = Record<string, { file: string; peaks: number[] }>;

const filter = (kind: "highpass" | "lowpass" | "peak" | "lowshelf" | "highshelf", freq: number, gainDb = 0, q = 0.707, automation?: { freq: AutoPoint[] }): TrackFx => ({ kind, freq, gainDb, q, ...(automation ? { automation } : {}) });
const comp = (thresholdDb: number, ratio: number, makeupDb = 0, attackMs = 10, releaseMs = 150): TrackFx => ({ kind: "compressor", thresholdDb, ratio, attackMs, releaseMs, makeupDb });
const reverb = (room: number, damping: number, mix: number): TrackFx => ({ kind: "reverb", room, damping, mix, width: 1 });
const limiter = (ceilingDb = -1): TrackFx => ({ kind: "limiter", ceilingDb, releaseMs: 80 });
const denoise = (reductionDb = 12, sensitivityDb = 3): TrackFx => ({ kind: "denoise", reductionDb, sensitivityDb });
const dehum = (bypass = false): TrackFx => ({ kind: "dehum", baseHz: 60, harmonics: 8, q: 30, ...(bypass ? { bypass: true } : {}) });
const declick = (): TrackFx => ({ kind: "declick", sensitivity: 8, maxMs: 1 });

// ---- demos -------------------------------------------------------------------------------------------------------

interface DemoClip {
  file: string;
  /** Where it starts, in seconds or (Produce) beats, and how long, in the same unit (absent: the whole file). */
  at: number;
  length?: number;
  offset?: number;
  gainDb?: number;
}
interface DemoTrack {
  name: string;
  color: string;
  gainDb?: number;
  pan?: number;
  mute?: boolean;
  view?: "spectrogram";
  fx?: TrackFx[];
  send?: number;
  clips: DemoClip[];
  volume?: [number, number][];
}
interface Demo {
  id: "mix" | "repair" | "produce";
  title: string;
  blurb: string;
  session: string;
  /** Seconds per unit of the clips' times: 1 for seconds, 60 / bpm for beats. */
  unit: number;
  bpm?: number;
  tracks: DemoTrack[];
  bus?: { name: string; fx: TrackFx[] };
  masterFx?: TrackFx[];
  masterGainDb?: number;
  markers: [number, string, string][];
}

const BEAT = 60 / 130;
const DEMOS: Demo[] = [
  {
    id: "mix",
    title: "Mix",
    blurb: "A five-track field report: launch radio, a reading, piano and a Saturn bed",
    session: "Round the Moon, a field report",
    unit: 1,
    tracks: [
      { name: "Launch radio", color: "cyan", view: "spectrogram", fx: [filter("highpass", 120)], clips: [{ file: "launch-radio", at: 0 }] },
      { name: "Narration", color: "green", fx: [filter("highpass", 80), comp(-20, 3, 3)], send: -14, clips: [{ file: "narration", at: 16.4 }] },
      { name: "Narration take 2 (hum)", color: "amber", mute: true, fx: [dehum(true), filter("highpass", 80)], clips: [{ file: "narration-take2", at: 16.4 }] },
      { name: "Piano", color: "violet", gainDb: -3, send: -10, clips: [{ file: "piano", at: 0 }] },
      { name: "Saturn radio waves", color: "slate", gainDb: -3, pan: -0.3, clips: [{ file: "saturn", at: 18 }] },
    ],
    bus: { name: "Room", fx: [reverb(0.6, 0.5, 1)] },
    masterFx: [limiter(-1)],
    markers: [[0, "Launch", "cyan"], [16.4, "Reading", "green"], [18, "Saturn", "slate"]],
  },
  {
    id: "repair",
    title: "Repair",
    blurb: "A 1917 record with crackle and hiss, three more noisy sources and a repair chain",
    session: "Repair bench",
    unit: 1,
    tracks: [
      { name: "One-Step, 1917 (78 rpm)", color: "amber", view: "spectrogram", fx: [declick(), denoise(10, 3), filter("highpass", 60), filter("peak", 2500, 2, 0.8), comp(-24, 2.5, 4), limiter(-1)], clips: [{ file: "onestep", at: 0 }] },
      { name: "Vesti la giubba, 1907 (shellac)", color: "red", mute: true, fx: [declick(), denoise(14, 2), filter("highshelf", 6000, 3), limiter(-1)], clips: [{ file: "shellac", at: 0 }] },
      { name: "Reading with 60 Hz hum", color: "green", mute: true, fx: [dehum(), filter("highpass", 80), comp(-20, 3, 3)], clips: [{ file: "narration-take2", at: 0 }] },
      { name: "Launch commentary", color: "cyan", mute: true, fx: [filter("highpass", 150), denoise(12, 3), filter("peak", 3000, 3, 1)], clips: [{ file: "launch-radio", at: 0 }] },
    ],
    markers: [[0, "Original record", "amber"]],
  },
  {
    id: "produce",
    title: "Produce",
    blurb: "32 bars at 130 BPM: stems, loops, filter sweeps, a reverb bus and seven markers",
    session: "Cold Open, 32 bars at 130 BPM",
    unit: BEAT,
    bpm: 130,
    tracks: [
      { name: "Score", color: "violet", gainDb: -3, send: -8, clips: [{ file: "piano", at: 0, length: 20 }], volume: [[0, -4], [12, -4], [18, -40], [20, -60]] },
      { name: "Texture", color: "slate", gainDb: -9, send: -6, fx: [filter("lowpass", 900, 0, 0.707, { freq: [] })], clips: [{ file: "saturn", at: 0, length: 28 }, { file: "launch-roar", at: 24, length: 8, gainDb: -3 }, { file: "launch-roar", at: 88, length: 8, gainDb: -3 }] },
      { name: "Keys", color: "blue", gainDb: -4, fx: [filter("highpass", 140), { kind: "chorus", rateHz: 0.8, depthMs: 3, mix: 0.3 }], send: -12, clips: [{ file: "keys-a", at: 16, length: 16, offset: 16, gainDb: -2 }, { file: "keys-b", at: 32, length: 32 }, { file: "keys-brk", at: 64, length: 32 }, { file: "keys-c", at: 96, length: 32 }] },
      { name: "Drums", color: "red", fx: [filter("lowpass", 16000, 0, 0.707, { freq: [] }), comp(-18, 3, 2)], clips: [{ file: "drums-a", at: 16, length: 16, offset: 16 }, { file: "drums-b", at: 32, length: 32 }, { file: "drums-c", at: 96, length: 32 }] },
      { name: "Bass", color: "amber", gainDb: -2, fx: [comp(-20, 4, 2)], clips: [{ file: "bass-b", at: 32, length: 32 }, { file: "bass-c", at: 96, length: 32 }] },
      { name: "Perc", color: "pink", gainDb: -10, fx: [filter("highpass", 400), { kind: "echo", delayMs: 346, feedback: 0.3, mix: 0.2 }], clips: [48, 52, 56, 60].map((at) => ({ file: "loop-kit-a", at, length: 4 })).concat([112, 116, 120, 124].map((at) => ({ file: "loop-kit-b", at, length: 4 }))) },
    ],
    bus: { name: "Verb", fx: [reverb(0.8, 0.55, 1)] },
    masterFx: [limiter(-1)],
    masterGainDb: -6,
    markers: [[0, "Cold open", "cyan"], [16, "Build", "violet"], [32, "Drop A", "amber"], [64, "Break", "slate"], [88, "Riser", "pink"], [96, "Drop B", "amber"], [124, "Outro", "green"]],
  },
];
// the filter sweeps of the Produce demo, in beats: the Texture's low-pass opens into each drop, the Drums' closes in the build
const SWEEPS: Record<string, [number, number][]> = {
  Texture: [[0, 900], [16, 5000], [24, 900], [32, 16000], [33, 1500], [88, 900], [96, 16000], [97, 1800]],
  Drums: [[0, 16000], [16, 500], [32, 16000]],
};

const peaksCache = new Map<string, Promise<Peaks>>();
const peaksOf = (id: string): Promise<Peaks> => {
  let p = peaksCache.get(id);
  if (!p) {
    p = fetch(`/demos/${id}/peaks.json`).then((r) => (r.ok ? (r.json() as Promise<Peaks>) : {}));
    peaksCache.set(id, p);
  }
  return p;
};

async function buildDemo(demo: Demo): Promise<SessionDoc> {
  const peaks = await peaksOf(demo.id);
  const files = [...new Set(demo.tracks.flatMap((t) => t.clips.map((c) => c.file)))];
  const refs = new Map<string, MediaRef>();
  for (const name of files) {
    const file = peaks[name]?.file;
    if (!file) throw new Error(`the build has no ${name} for this demo`);
    const res = await fetch(`/demos/${demo.id}/${file}`);
    if (!res.ok) throw new Error(`${file} answered ${res.status}`);
    const blob = await res.blob();
    refs.set(name, await importFile(new File([blob], file), RATE));
  }
  const at = (v: number) => Math.round(v * demo.unit * RATE);
  const busId = demo.bus ? `${demo.id}-bus` : undefined;
  const tracks: Track[] = demo.tracks.map((t, i) => {
    const id = `${demo.id}-t${i + 1}`;
    const clips: Clip[] = t.clips.map((c, k) => {
      const media = refs.get(c.file) as MediaRef;
      const whole = sessionLength(media, RATE);
      const sourceIn = Math.round(((c.offset ?? 0) * demo.unit * media.sampleRate));
      const length = Math.max(1, Math.min(c.length !== undefined ? at(c.length) : whole, whole - at(c.offset ?? 0)));
      return { id: `${id}c${k + 1}`, mediaId: media.id, start: at(c.at), sourceIn, length, gainDb: c.gainDb ?? 0 };
    });
    const fx = t.fx?.map((f) => (f.kind === "lowpass" && SWEEPS[t.name] ? { ...f, automation: { freq: SWEEPS[t.name].map(([b, v]) => ({ time: at(b), value: v })) } } : f));
    return {
      id,
      name: t.name,
      color: t.color,
      channels: Math.min(2, refs.get(t.clips[0].file)?.channels ?? 2),
      gainDb: t.gainDb ?? 0,
      pan: t.pan ?? 0,
      mute: t.mute ?? false,
      solo: false,
      clips,
      ...(t.view ? { view: t.view } : {}),
      ...(fx?.length ? { fx } : {}),
      ...(busId && t.send !== undefined ? { sends: [{ busId, gainDb: t.send }] } : {}),
      ...(t.volume ? { automation: { volume: t.volume.map(([b, v]) => ({ time: at(b), value: v })) } } : {}),
    };
  });
  const doc: SessionDoc = {
    ...emptyDocument(RATE),
    media: Object.fromEntries([...refs.values()].map((m) => [m.id, m])),
    tracks,
    markers: demo.markers.map(([t, label, color], i) => ({ id: `${demo.id}-m${i + 1}`, at: at(t), label, color })),
  };
  if (demo.bpm) doc.tempo = { bpm: demo.bpm, beatsPerBar: 4 };
  if (busId && demo.bus) doc.buses = [{ id: busId, name: demo.bus.name, gainDb: 0, fx: demo.bus.fx }];
  if (demo.masterFx) doc.masterFx = demo.masterFx;
  if (demo.masterGainDb !== undefined) doc.masterGainDb = demo.masterGainDb;
  return doc;
}

// ---- templates ---------------------------------------------------------------------------------------------------

interface TemplateTrack {
  name: string;
  color: string;
  channels?: 1 | 2;
  gainDb?: number;
  pan?: number;
  fx?: TrackFx[];
  /** The bus (by name) it plays into, and the bus (by name) it sends to at a level. */
  out?: string;
  send?: [string, number];
}
interface Template {
  id: string;
  title: string;
  blurb: string;
  session: string;
  bpm?: number;
  buses: { name: string; fx: TrackFx[] }[];
  tracks: TemplateTrack[];
  masterFx?: TrackFx[];
}

const VOICE = (): TrackFx[] => [filter("highpass", 80), denoise(10, 3), filter("peak", 3000, 2, 1), comp(-20, 3, 4)];
const TEMPLATES: Template[] = [
  {
    id: "podcast",
    title: "Podcast",
    blurb: "Two voices and a music bed, with voice cleanup and a loudness limiter",
    session: "Podcast",
    buses: [{ name: "Voices", fx: [comp(-16, 2, 2)] }],
    tracks: [
      { name: "Host", color: "green", channels: 1, pan: -0.1, fx: VOICE(), out: "Voices" },
      { name: "Guest", color: "blue", channels: 1, pan: 0.1, fx: VOICE(), out: "Voices" },
      { name: "Music bed", color: "violet", gainDb: -18, fx: [filter("peak", 2500, -4, 0.8)] },
    ],
    masterFx: [limiter(-1)],
  },
  {
    id: "voice-over",
    title: "Voice-over",
    blurb: "One voice, cleaned and compressed, over a quiet music bed",
    session: "Voice-over",
    buses: [],
    tracks: [
      { name: "Voice", color: "green", channels: 1, fx: [...VOICE(), { kind: "gate", thresholdDb: -50, releaseMs: 120, rangeDb: -20 }] },
      { name: "Music bed", color: "violet", gainDb: -20, fx: [filter("lowpass", 9000)] },
    ],
    masterFx: [limiter(-1)],
  },
  {
    id: "music",
    title: "Music",
    blurb: "Drums, bass, keys and vocal with a reverb and a delay bus",
    session: "Song",
    bpm: 120,
    buses: [{ name: "Reverb", fx: [reverb(0.7, 0.45, 1)] }, { name: "Delay", fx: [{ kind: "echo", delayMs: 375, feedback: 0.35, mix: 1 }] }],
    tracks: [
      { name: "Drums", color: "red", fx: [comp(-18, 4, 3, 5)], send: ["Reverb", -18] },
      { name: "Bass", color: "amber", channels: 1, fx: [filter("highpass", 35), comp(-20, 4, 2)] },
      { name: "Keys", color: "blue", fx: [filter("highpass", 120)], send: ["Reverb", -12] },
      { name: "Vocal", color: "green", channels: 1, fx: [filter("highpass", 90), comp(-18, 3, 3)], send: ["Delay", -16] },
    ],
    masterFx: [limiter(-0.5)],
  },
  {
    id: "repair",
    title: "Audio repair",
    blurb: "One recording through de-click, de-hum, noise reduction and EQ",
    session: "Repair",
    buses: [],
    tracks: [{ name: "Recording", color: "amber", fx: [declick(), dehum(), denoise(12, 3), filter("highpass", 60), filter("peak", 3000, 2, 1), limiter(-1)] }],
  },
  {
    id: "dub",
    title: "Dub and ADR",
    blurb: "Production dialogue, ADR, a guide track and a room bus",
    session: "Dub and ADR",
    buses: [{ name: "Room", fx: [reverb(0.35, 0.6, 1)] }],
    tracks: [
      { name: "Guide", color: "slate", channels: 1, gainDb: -12 },
      { name: "Production dialogue", color: "green", channels: 1, fx: [filter("highpass", 80), denoise(10, 3), { kind: "dereverb", t60: 0.8, reductionDb: 6 }] },
      { name: "ADR", color: "blue", channels: 1, fx: [filter("highpass", 80), filter("peak", 4000, -2, 1), comp(-20, 2.5, 2)], send: ["Room", -14] },
      { name: "Walla", color: "cyan", gainDb: -10, send: ["Room", -10] },
    ],
  },
  {
    id: "sound-design",
    title: "Sound design and foley",
    blurb: "Foley, hard effects, ambience and a low end bus",
    session: "Sound design",
    buses: [{ name: "Low end", fx: [filter("lowpass", 120), comp(-18, 4, 2)] }, { name: "Space", fx: [reverb(0.8, 0.4, 1)] }],
    tracks: [
      { name: "Foley", color: "green", fx: [filter("highpass", 60)], send: ["Space", -16] },
      { name: "Hard effects", color: "red", fx: [comp(-16, 4, 2, 3)], send: ["Low end", -8] },
      { name: "Ambience", color: "cyan", gainDb: -8, send: ["Space", -12] },
      { name: "Whooshes", color: "violet", fx: [{ kind: "flanger", rateHz: 0.25, depthMs: 3, feedback: 0.4 }], send: ["Space", -10] },
    ],
    masterFx: [limiter(-1)],
  },
  { id: "blank", title: "Blank stereo", blurb: "One empty stereo track", session: "Untitled session", buses: [], tracks: [{ name: "Audio 1", color: "green" }] },
];

/** The template's session, made by the reducer's commands: tracks, colours, gains, pans, effects, buses and sends. */
function applyTemplate(engine: Engine, t: Template): void {
  const busId = new Map<string, string>();
  for (const b of t.buses) {
    engine.dispatch({ type: "add-bus", name: b.name });
    const made = engine.get("document").buses?.at(-1);
    if (!made) continue;
    busId.set(b.name, made.id);
    if (b.fx.length) engine.dispatch({ type: "set-bus-fx", busId: made.id, fx: b.fx });
  }
  for (const tr of t.tracks) {
    engine.dispatch({ type: "add-track", name: tr.name, channels: tr.channels ?? 2 });
    const id = engine.get("document").tracks.at(-1)?.id;
    if (!id) continue;
    engine.dispatch({ type: "set-track-color", trackId: id, color: tr.color });
    if (tr.gainDb) engine.dispatch({ type: "set-track-gain", trackId: id, gainDb: tr.gainDb });
    if (tr.pan) engine.dispatch({ type: "set-track-pan", trackId: id, pan: tr.pan });
    if (tr.fx?.length) engine.dispatch({ type: "set-track-fx", trackId: id, fx: tr.fx });
    const out = tr.out ? busId.get(tr.out) : undefined;
    if (out) engine.dispatch({ type: "route-track", trackId: id, busId: out });
    const send = tr.send ? busId.get(tr.send[0]) : undefined;
    if (send && tr.send) engine.dispatch({ type: "set-track-send", trackId: id, busId: send, gainDb: tr.send[1] });
  }
  if (t.masterFx?.length) engine.dispatch({ type: "set-master-fx", fx: t.masterFx });
  if (t.bpm) engine.dispatch({ type: "set-tempo", bpm: t.bpm, beatsPerBar: 4 });
}

// ---- thumbnails --------------------------------------------------------------------------------------------------

const W = 160;
const H = 120;
/** A demo's tracks as lanes with its clips' real peaks (peaks.json), in the tracks' colours. */
function demoThumb(demo: Demo, peaks: Peaks): string {
  const spans = demo.tracks.flatMap((t) => t.clips.map((c) => c.at + (c.length ?? (peaks[c.file] ? Infinity : 0))));
  const lens: Record<string, number> = { mix: 66, repair: 27, produce: 128 };
  const total = Math.max(1, Math.min(lens[demo.id], Math.max(...spans.filter(Number.isFinite), lens[demo.id])));
  const rows = demo.tracks.length;
  const lane = (H - 12) / rows;
  const parts: string[] = [];
  demo.tracks.forEach((t, r) => {
    const y = 6 + r * lane;
    const mid = y + lane / 2;
    for (const c of t.clips) {
      const p = peaks[c.file]?.peaks ?? [];
      const x0 = 6 + (c.at / total) * (W - 12);
      const len = c.length ?? (demo.id === "mix" ? ({ "launch-radio": 15.7, narration: 44.1, "narration-take2": 22.1, piano: 64, saturn: 13.2 } as Record<string, number>)[c.file] ?? 10 : demo.id === "repair" ? 26 : 8);
      const w = Math.max(2, (len / total) * (W - 12));
      parts.push(`<rect x="${x0.toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${w.toFixed(1)}" height="${(lane - 2).toFixed(1)}" rx="2" style="fill:var(--fw-color-${t.color});opacity:${t.mute ? 0.12 : 0.2}"/>`);
      if (p.length) {
        const n = Math.max(2, Math.round(w / 2));
        let d = "";
        for (let i = 0; i < n; i++) {
          const v = p[Math.floor((i / n) * p.length)] * (lane / 2 - 2);
          const x = x0 + (i / n) * w;
          d += `M${x.toFixed(1)} ${(mid - v).toFixed(1)}V${(mid + v).toFixed(1)}`;
        }
        parts.push(`<path d="${d}" style="stroke:var(--fw-color-${t.color});opacity:${t.mute ? 0.4 : 0.9}" stroke-width="1"/>`);
      }
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">${parts.join("")}</svg>`;
}
/** A template's tracks as empty lanes with their colours and bus count. */
function templateThumb(t: Template): string {
  const rows = t.tracks.length + t.buses.length;
  const lane = Math.min(22, (H - 16) / Math.max(rows, 1));
  const top = (H - lane * rows) / 2;
  const parts: string[] = [];
  t.tracks.forEach((tr, r) => {
    const y = top + r * lane;
    parts.push(`<rect x="10" y="${(y + 2).toFixed(1)}" width="6" height="${(lane - 4).toFixed(1)}" rx="1.5" style="fill:var(--fw-color-${tr.color})"/>`);
    parts.push(`<rect x="22" y="${(y + 2).toFixed(1)}" width="${W - 32}" height="${(lane - 4).toFixed(1)}" rx="2" style="fill:var(--fw-color-${tr.color});opacity:0.16"/>`);
    (tr.fx ?? []).slice(0, 5).forEach((_, k) => parts.push(`<rect x="${26 + k * 10}" y="${(y + lane / 2 - 2).toFixed(1)}" width="7" height="4" rx="1" style="fill:var(--fw-color-${tr.color});opacity:0.7"/>`));
  });
  t.buses.forEach((_, k) => {
    const y = top + (t.tracks.length + k) * lane;
    parts.push(`<rect x="22" y="${(y + 2).toFixed(1)}" width="${W - 32}" height="${(lane - 4).toFixed(1)}" rx="2" fill="none" stroke="currentColor" stroke-dasharray="3 2" opacity="0.5"/>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">${parts.join("")}</svg>`;
}

// ---- markup and mounting -----------------------------------------------------------------------------------------

const card = (attr: string, id: string, title: string, blurb: string, thumb: string) =>
  `<button type="button" class="fw-home-card fw-start-card" ${attr}="${id}"><span class="fw-home-thumb fw-start-thumb">${thumb}</span><span class="fw-home-card-name">${title}</span><span class="fw-home-card-meta fw-start-blurb">${blurb}</span></button>`;

/** Home > Start's two sections, in its markup from the start (home.ts places it), filled in place: thumbnails of the
 *  demos get their peaks when peaks.json arrives, inside a box whose size is fixed, so nothing moves. */
export const START_CONTENT_HTML = `<div class="fw-start-content">
      <div class="fw-home-section-head" data-start-section="demos"><h2 class="fw-home-section-title">Demos</h2><span class="fw-start-note">Open one as a new, unsaved session with its recordings</span></div>
      <div class="fw-home-grid fw-start-grid" role="list" aria-label="Demos">${DEMOS.map((d) => card("data-start-demo", d.id, d.title, d.blurb, demoThumb(d, {}))).join("")}</div>
      <div class="fw-home-section-head" data-start-section="templates"><h2 class="fw-home-section-title">Templates</h2><span class="fw-start-note">Start a session with tracks, buses and effects set up</span></div>
      <div class="fw-home-grid fw-start-grid" role="list" aria-label="Templates">${TEMPLATES.map((t) => card("data-start-template", t.id, t.title, t.blurb, templateThumb(t))).join("")}</div>
    </div>`;

export const DEMO_IDS = DEMOS.map((d) => d.id);
export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export function mountStartContent(host: HTMLElement, engine: Engine): void {
  const root = host.querySelector<HTMLElement>(".fw-start-content");
  for (const d of DEMOS) {
    void peaksOf(d.id).then((p) => {
      const thumb = root?.querySelector<HTMLElement>(`[data-start-demo="${d.id}"] .fw-start-thumb`);
      if (thumb && Object.keys(p).length) thumb.innerHTML = demoThumb(d, p);
    });
  }
  const load = (detail: { name: string; build: () => Promise<SessionDoc>; then?: () => void; pending: string; done: string; failed: string }) => {
    host.querySelector<HTMLElement>(".fw-home")?.setAttribute("hidden", "");
    delete document.documentElement.dataset.home;
    host.dispatchEvent(new CustomEvent("fw-load-session", { detail }));
  };
  const openDemo = (id: string): boolean => {
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return false;
    load({ name: demo.session, build: () => buildDemo(demo), pending: "Opening the demo", done: "Opened the demo: save it to keep your changes", failed: "Could not open the demo" });
    return true;
  };
  const newFromTemplate = (id: string): boolean => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return false;
    const rate = engine.get("document").sampleRate || 48000;
    load({ name: t.session, build: async () => emptyDocument(rate), then: () => applyTemplate(engine, t), pending: "Starting from the template", done: "Started a new session from the template", failed: "Could not start from the template" });
    return true;
  };
  root?.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-start-demo], [data-start-template]");
    if (!el) return;
    e.stopPropagation();
    if (el.dataset.startDemo) openDemo(el.dataset.startDemo);
    else if (el.dataset.startTemplate) newFromTemplate(el.dataset.startTemplate);
  });
  // File > New from template and Help > Demos show Home at that section; Help's demo items open the demo
  const showAt = (section: string) => {
    host.dispatchEvent(new CustomEvent("fw-home"));
    host.querySelector<HTMLElement>('.fw-home-nav [data-home-page="start"]')?.click();
    root?.querySelector<HTMLElement>(`[data-start-section="${section}"]`)?.scrollIntoView({ block: "start" });
  };
  host.querySelector('.fw-topbar [data-action="new-from-template"]')?.addEventListener("click", () => showAt("templates"));
  host.querySelector('.fw-topbar [data-action="show-demos"]')?.addEventListener("click", () => showAt("demos"));
  for (const item of host.querySelectorAll<HTMLElement>(".fw-topbar [data-open-demo]")) item.addEventListener("click", () => openDemo(item.dataset.openDemo ?? ""));
  // agents: one command for each, with the id as a parameter
  commands.add({
    id: "demo.open",
    label: "Open a demo",
    group: "Help",
    description: "Open one of the three demos (mix, repair, produce) as a new, unsaved session with its recordings; asks before replacing unsaved changes.",
    params: { id: { type: "string", required: true, enum: DEMO_IDS, description: "mix: a five-track field report; repair: a noisy 1917 record and three more sources with repair chains; produce: 32 bars at 130 BPM" } },
    risky: true,
    run: (p) => (openDemo(String(p.id)) ? { opening: p.id } : { error: `no demo ${String(p.id)}` }),
  });
  commands.add({
    id: "template.new",
    label: "New session from a template",
    group: "File",
    description: "Start a new session from a template: tracks, colours, buses, sends and effects set up by the session's own commands; asks before replacing unsaved changes.",
    params: { id: { type: "string", required: true, enum: TEMPLATE_IDS, description: "podcast, voice-over, music, repair, dub, sound-design or blank" } },
    risky: true,
    run: (p) => (newFromTemplate(String(p.id)) ? { started: p.id } : { error: `no template ${String(p.id)}` }),
  });
}
