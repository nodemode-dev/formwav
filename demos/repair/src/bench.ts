import { loudness, peakOf, rmsOf, toDb } from "../../../demo/src/dsp";
import { detectClicks, type HealBox, humLevel, mainsOf, noiseFloor } from "./fx";
import { type Chain, cloneChain, makeChain, STAGE_BY_ID, STAGE_ORDER, type StageExtra, type StageId } from "./stages";

export type BenchEvent = "source" | "chain" | "rendered" | "history" | "notice" | "rendering";

export interface BenchSource { id: string; name: string; sub: string; tags: string[]; x: Float32Array | null; custom: boolean }

export interface RenderResult {
  out: Float32Array;
  notes: Record<StageId, string>;
  extras: Partial<Record<StageId, StageExtra>>;
  ms: number;
  ver: number;
}

export interface Measures { lufs: number; peak: number; rms: number; floor: number; hum: number; clicks: number }

interface Snapshot { label: string; chains: Record<string, Chain>; current: string }
interface CacheEntry { key: string; out: Float32Array; note: string; extra?: StageExtra }

export const PRESETS: Record<string, Chain> = {
  onestep: makeChain(
    { declick: true, denoise: true, eq: true, comp: true, master: true, heal: true },
    { declick: { sens: 5, maxMs: 1 }, denoise: { red: 12, sens: 2 }, eq: { hp: 90, pkf: 2800, pkg: 1.5, pkq: 0.9, hsf: 5000, hsg: -2, lp: 7000 }, comp: { thr: -26, ratio: 2, att: 15, rel: 200, mk: 1.5 } },
  ),
  shellac: makeChain(
    { declick: true, denoise: true, eq: true, comp: true, master: true, heal: true },
    { declick: { sens: 5, maxMs: 1 }, denoise: { red: 18, sens: 3 }, eq: { hp: 100, pkf: 3200, pkg: 2.5, pkq: 0.8, hsf: 6500, hsg: -2, lp: 8500 }, comp: { thr: -26, ratio: 2.5, att: 12, rel: 180, mk: 2 } },
  ),
  hum: makeChain(
    { dehum: true, denoise: true, eq: true, comp: true, master: true, heal: true },
    { dehum: { mains: 60, harm: 5, q: 30 }, denoise: { red: 10, sens: 2 }, eq: { hp: 70, pkf: 2600, pkg: 2, pkq: 0.9, hsf: 8000, hsg: 1.5, lp: 20000 }, comp: { thr: -24, ratio: 3, att: 10, rel: 180, mk: 3 } },
  ),
  radio: makeChain(
    { denoise: true, eq: true, comp: true, master: true, heal: true },
    { denoise: { red: 20, sens: 4 }, eq: { hp: 140, pkf: 1800, pkg: 3, pkq: 0.8, hsf: 5000, hsg: -3, lp: 6000 }, comp: { thr: -22, ratio: 3, att: 6, rel: 140, mk: 2 } },
  ),
  custom: makeChain(
    { declick: true, denoise: true, eq: true, comp: true, master: true, heal: true },
    { denoise: { red: 12, sens: 2 }, eq: { hp: 60, pkf: 3000, pkg: 1.5, pkq: 1, hsf: 8000, hsg: 0, lp: 20000 } },
  ),
};

let nextArrayId = 1;
const arrayIds = new WeakMap<Float32Array, number>();
function idOf(a: Float32Array): number {
  let v = arrayIds.get(a);
  if (!v) { v = nextArrayId++; arrayIds.set(a, v); }
  return v;
}

export class Bench {
  readonly rate = 44100;
  sources: BenchSource[] = [];
  currentId = "";
  chains: Record<string, Chain> = {};
  result: RenderResult | null = null;
  notice = "";
  rendering = false;
  history: Snapshot[] = [];
  index = -1;
  private ver = 0;
  private timer = 0;
  private cache = new Map<string, CacheEntry[]>();
  private measures = new WeakMap<Float32Array, Map<string, Measures>>();
  private listeners: Record<BenchEvent, Array<() => void>> = { source: [], chain: [], rendered: [], history: [], notice: [], rendering: [] };

  on(ev: BenchEvent, fn: () => void): void { this.listeners[ev].push(fn); }
  emit(ev: BenchEvent): void { for (const fn of this.listeners[ev]) fn(); }
  say(text: string): void { this.notice = text; this.emit("notice"); }

  get source(): BenchSource { return this.sources.find((s) => s.id === this.currentId)!; }
  get orig(): Float32Array { return this.source.x!; }
  get chain(): Chain { return this.chains[this.currentId]; }
  get duration(): number { return this.orig.length / this.rate; }

  addSource(src: BenchSource, chain: Chain): void {
    this.sources.push(src);
    this.chains[src.id] = chain;
  }

  select(id: string): void {
    this.currentId = id;
    this.emit("source");
    this.schedule(0);
  }

  setParam(stage: StageId, param: string, v: number): void {
    this.chain[stage].p[param] = v;
    this.emit("chain");
    this.schedule(110);
  }

  toggle(stage: StageId): void {
    this.chain[stage].on = !this.chain[stage].on;
    this.emit("chain");
    this.commit(`${this.chain[stage].on ? "Turn on" : "Bypass"} ${STAGE_BY_ID[stage].title}`);
    this.schedule(0);
  }

  setAll(on: boolean): void {
    for (const id of STAGE_ORDER) if (id !== "heal" || this.chain.heal.boxes.length) this.chain[id].on = on;
    this.emit("chain");
    this.commit(on ? "Turn on the whole chain" : "Bypass the whole chain");
    this.schedule(0);
  }

  reset(): void {
    const base = PRESETS[this.currentId] ?? PRESETS.custom;
    this.chains[this.currentId] = cloneChain(base);
    this.emit("chain");
    this.commit("Reset the chain");
    this.schedule(0);
  }

  addHeal(box: HealBox): void {
    this.chain.heal.boxes.push(box);
    this.chain.heal.on = true;
    this.emit("chain");
    this.commit("Heal selection");
    this.schedule(0);
  }

  clearHeal(): void {
    this.chain.heal.boxes = [];
    this.emit("chain");
    this.commit("Clear healed boxes");
    this.schedule(0);
  }

  commit(label: string): void {
    this.history = this.history.slice(0, this.index + 1);
    const chains: Record<string, Chain> = {};
    for (const k of Object.keys(this.chains)) chains[k] = cloneChain(this.chains[k]);
    this.history.push({ label, chains, current: this.currentId });
    if (this.history.length > 60) this.history.shift();
    this.index = this.history.length - 1;
    this.emit("history");
  }

  jump(i: number): void {
    if (i < 0 || i >= this.history.length) return;
    this.index = i;
    const snap = this.history[i];
    for (const k of Object.keys(snap.chains)) this.chains[k] = cloneChain(snap.chains[k]);
    this.emit("chain");
    this.emit("history");
    this.say(`Went to: ${snap.label}`);
    this.schedule(0);
  }

  undo(): void { if (this.index > 0) this.jump(this.index - 1); }
  redo(): void { if (this.index < this.history.length - 1) this.jump(this.index + 1); }

  schedule(delay: number): void {
    window.clearTimeout(this.timer);
    if (!this.rendering) { this.rendering = true; this.emit("rendering"); }
    this.timer = window.setTimeout(() => this.render(), delay);
  }

  render(): void {
    const t0 = performance.now();
    const chain = this.chain;
    let entries = this.cache.get(this.currentId);
    if (!entries) { entries = []; this.cache.set(this.currentId, entries); }
    let cur = this.orig;
    const notes = {} as Record<StageId, string>;
    const extras: Partial<Record<StageId, StageExtra>> = {};
    STAGE_ORDER.forEach((id, i) => {
      const st = chain[id];
      if (!st.on) { notes[id] = "Bypassed"; return; }
      const key = `${idOf(cur)}|${JSON.stringify(st.p)}|${JSON.stringify(st.boxes)}`;
      let hit = entries![i];
      if (!hit || hit.key !== key) {
        const res = STAGE_BY_ID[id].run(cur, this.rate, st);
        hit = { key, out: res.out, note: res.note, extra: res.extra };
        entries![i] = hit;
      }
      cur = hit.out;
      notes[id] = hit.note;
      if (hit.extra) extras[id] = hit.extra;
    });
    this.ver++;
    this.result = { out: cur, notes, extras, ms: Math.round(performance.now() - t0), ver: this.ver };
    this.rendering = false;
    this.emit("rendering");
    this.emit("rendered");
  }

  private mainsOfOrig = new WeakMap<Float32Array, number>();

  private mains(): number {
    let m = this.mainsOfOrig.get(this.orig);
    if (!m) { m = mainsOf(this.orig, this.rate); this.mainsOfOrig.set(this.orig, m); }
    return m;
  }

  private clicksIn(x: Float32Array, seg: Float32Array, s: number, e: number): number {
    const left = this.result && this.result.out === x ? this.result.extras.declick?.left : undefined;
    if (!left) return detectClicks(seg, this.rate, 5, 1).length;
    return left.filter((c) => c.a >= s && c.b <= e).length;
  }

  measure(x: Float32Array, range: [number, number] | null): Measures {
    const n = x.length;
    const s = range ? Math.max(0, Math.round(range[0] * this.rate)) : 0;
    const e = range ? Math.min(n, Math.round(range[1] * this.rate)) : n;
    const key = `${s}:${e}`;
    let per = this.measures.get(x);
    if (!per) { per = new Map(); this.measures.set(x, per); }
    const hit = per.get(key);
    if (hit) return hit;
    const seg = x.subarray(s, e);
    const m: Measures = {
      lufs: loudness([x], this.rate, s, e),
      peak: toDb(peakOf([x], s, e)),
      rms: toDb(rmsOf([x], s, e)),
      floor: noiseFloor(x, this.rate, s, e),
      hum: humLevel(x, this.rate, this.mains(), s, e),
      clicks: this.clicksIn(x, seg, s, e),
    };
    per.set(key, m);
    return m;
  }
}
