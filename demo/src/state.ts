import { type Chans } from "./dsp";
import { OP_BY_ID } from "./ops";

export interface Track {
  id: number;
  name: string;
  color: string;
  chans: Chans;
  mute: boolean;
  solo: boolean;
  gain: number;
  spec: boolean;
}

interface Snapshot { label: string; tracks: Track[]; selected: number | null }

export type StoreEvent = "tracks" | "selection" | "history" | "notice";

export const COLORS = ["--fw-color-cyan", "--fw-color-violet", "--fw-color-green", "--fw-color-amber", "--fw-color-blue", "--fw-color-pink", "--fw-color-red", "--fw-color-slate"];

export class Store {
  readonly rate = 44100;
  tracks: Track[] = [];
  selected: number | null = null;
  sel: [number, number] | null = null;
  notice = "";
  history: Snapshot[] = [];
  index = -1;
  private nextId = 1;
  private listeners: Record<StoreEvent, Array<() => void>> = { tracks: [], selection: [], history: [], notice: [] };

  on(ev: StoreEvent, fn: () => void): void {
    this.listeners[ev].push(fn);
  }

  emit(ev: StoreEvent): void {
    for (const fn of this.listeners[ev]) fn();
  }

  say(text: string): void {
    this.notice = text;
    this.emit("notice");
  }

  get track(): Track | null {
    return this.tracks.find((t) => t.id === this.selected) ?? null;
  }

  duration(): number {
    let m = 0;
    for (const t of this.tracks) m = Math.max(m, t.chans[0].length);
    return m / this.rate;
  }

  newTrack(name: string, chans: Chans): Track {
    const id = this.nextId++;
    return { id, name, color: COLORS[(id - 1) % COLORS.length], chans, mute: false, solo: false, gain: 0, spec: false };
  }

  reset(): void {
    this.tracks = [];
    this.selected = null;
    this.sel = null;
    this.history = [];
    this.index = -1;
  }

  addTrack(name: string, chans: Chans, label: string): Track {
    const t = this.newTrack(name, chans);
    this.tracks.push(t);
    this.selected = t.id;
    this.sel = null;
    this.commit(label);
    return t;
  }

  removeTrack(id: number): void {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    this.tracks = this.tracks.filter((x) => x.id !== id);
    if (this.selected === id) this.selected = this.tracks.length ? this.tracks[this.tracks.length - 1].id : null;
    this.sel = null;
    this.commit(`Remove ${t.name}`);
  }

  selectTrack(id: number | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.emit("selection");
  }

  setSel(range: [number, number] | null): void {
    this.sel = range;
    this.emit("selection");
  }

  commit(label: string): void {
    this.history = this.history.slice(0, this.index + 1);
    this.history.push({ label, tracks: this.tracks.map((t) => ({ ...t })), selected: this.selected });
    if (this.history.length > 80) this.history.shift();
    this.index = this.history.length - 1;
    this.emit("tracks");
    this.emit("selection");
    this.emit("history");
  }

  jump(i: number): void {
    if (i < 0 || i >= this.history.length) return;
    this.index = i;
    const snap = this.history[i];
    this.tracks = snap.tracks.map((t) => ({ ...t }));
    this.selected = snap.selected;
    this.sel = null;
    this.emit("tracks");
    this.emit("selection");
    this.emit("history");
    this.say(`Went to: ${snap.label}`);
  }

  undo(): void {
    if (this.index > 0) this.jump(this.index - 1);
  }

  redo(): void {
    if (this.index < this.history.length - 1) this.jump(this.index + 1);
  }

  edited(): void {
    this.emit("tracks");
  }

  apply(opId: string, p: Record<string, number>): boolean {
    const op = OP_BY_ID[opId];
    const t = this.track;
    if (!op || !t) { this.say("Select a track first"); return false; }
    const n = t.chans[0].length;
    let s = 0, e = n;
    if (this.sel) {
      s = Math.max(0, Math.min(n, Math.round(this.sel[0] * this.rate)));
      e = Math.max(0, Math.min(n, Math.round(this.sel[1] * this.rate)));
    }
    if (op.needsSel && (!this.sel || e - s < 2)) { this.say(`${op.title} needs a selection: drag across the track first`); return false; }
    if (e - s < 2) { this.say("The range is empty"); return false; }
    const t0 = performance.now();
    const res = op.run({ chans: t.chans, rate: this.rate, s, e, p });
    const ms = Math.round(performance.now() - t0);
    t.chans = res.chans;
    if (res.sel === null) this.sel = null;
    else if (res.sel) this.sel = [res.sel[0] / this.rate, res.sel[1] / this.rate];
    this.commit(`${op.title} on ${t.name}`);
    this.say(`${op.title} on ${t.name}: ${res.note ? res.note + " · " : ""}${ms} ms`);
    return true;
  }
}
