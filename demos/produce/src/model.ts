export const BPM = 130;
export const SPB = 60 / BPM;
export const BAR = 4;
export const RATE = 44100;

export interface Pt { beat: number; value: number }
export interface Fx { id: number; kind: string; bypass: boolean; v: Record<string, number> }
export interface Clip { id: number; item: string; start: number; offset: number; length: number; gainDb: number }
export interface Track {
  id: number;
  name: string;
  color: string;
  clips: Clip[];
  vol: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  fx: Fx[];
  auto: Record<string, Pt[]>;
}
export interface Marker { id: number; beat: number; name: string; color: string; comment: string }
export interface Pattern { id: string; name: string; rows: string[]; steps: number[][]; bars: number; swing: number }
export interface Doc {
  tracks: Track[];
  markers: Marker[];
  region: [number, number] | null;
  patterns: Pattern[];
  master: { gainDb: number; ceilingDb: number };
  nid: number;
}

export type Ev = "doc" | "live" | "sel" | "notice" | "hist";

export const COLORS = ["--fw-color-cyan", "--fw-color-violet", "--fw-color-amber", "--fw-color-pink", "--fw-color-green", "--fw-color-blue", "--fw-color-red", "--fw-color-slate"];
export const MARKER_COLORS = ["cyan", "violet", "amber", "pink", "green", "blue", "red", "slate"];

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export function emptyDoc(): Doc {
  return { tracks: [], markers: [], region: null, patterns: [], master: { gainDb: 0, ceilingDb: -1 }, nid: 1 };
}

export function laneAt(pts: readonly Pt[], beat: number, fallback: number): number {
  if (!pts.length) return fallback;
  if (beat <= pts[0].beat) return pts[0].value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (beat <= b.beat) return b.beat === a.beat ? b.value : a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
  }
  return pts[pts.length - 1].value;
}

export class Store {
  doc: Doc = emptyDoc();
  selTrack: number | null = null;
  selClip: number | null = null;
  notice = "";
  snap = 4;
  history: Array<{ label: string; json: string }> = [];
  index = -1;
  private listeners: Record<Ev, Array<() => void>> = { doc: [], live: [], sel: [], notice: [], hist: [] };

  on(ev: Ev, fn: () => void): void { this.listeners[ev].push(fn); }
  emit(ev: Ev): void { for (const fn of this.listeners[ev]) fn(); }
  say(text: string): void { this.notice = text; this.emit("notice"); }
  nextId(): number { return this.doc.nid++; }

  get track(): Track | null { return this.doc.tracks.find((t) => t.id === this.selTrack) ?? null; }
  get clip(): { track: Track; clip: Clip } | null {
    for (const t of this.doc.tracks) {
      const c = t.clips.find((x) => x.id === this.selClip);
      if (c) return { track: t, clip: c };
    }
    return null;
  }

  endBeat(): number {
    let m = 0;
    for (const t of this.doc.tracks) for (const c of t.clips) m = Math.max(m, c.start + c.length);
    return m;
  }

  select(track: number | null, clip: number | null): void {
    if (this.selTrack === track && this.selClip === clip) return;
    this.selTrack = track;
    this.selClip = clip;
    this.emit("sel");
  }

  reset(doc: Doc): void {
    this.doc = doc;
    this.history = [];
    this.index = -1;
    this.selTrack = doc.tracks[0]?.id ?? null;
    this.selClip = null;
  }

  commit(label: string): void {
    this.history = this.history.slice(0, this.index + 1);
    this.history.push({ label, json: JSON.stringify(this.doc) });
    if (this.history.length > 120) this.history.shift();
    this.index = this.history.length - 1;
    this.emit("doc");
    this.emit("hist");
  }

  jump(i: number): void {
    if (i < 0 || i >= this.history.length) return;
    this.index = i;
    this.doc = JSON.parse(this.history[i].json) as Doc;
    if (!this.doc.tracks.some((t) => t.id === this.selTrack)) this.selTrack = this.doc.tracks[0]?.id ?? null;
    if (!this.clip) this.selClip = null;
    this.emit("doc");
    this.emit("sel");
    this.emit("hist");
    this.say(`Went to: ${this.history[i].label}`);
  }

  undo(): void { if (this.index > 0) this.jump(this.index - 1); }
  redo(): void { if (this.index < this.history.length - 1) this.jump(this.index + 1); }

  newTrack(name: string): Track {
    const id = this.nextId();
    const t: Track = { id, name, color: COLORS[this.doc.tracks.length % COLORS.length], clips: [], vol: 0, pan: 0, mute: false, solo: false, fx: [], auto: {} };
    this.doc.tracks.push(t);
    return t;
  }

  snapBeat(b: number, fine = false): number {
    const s = fine ? Math.min(this.snap || 0.25, 0.25) || 0.25 : this.snap;
    if (!s) return Math.max(0, b);
    return Math.max(0, Math.round(b / s) * s);
  }
}
