import { items } from "./lib";
import { dbToGain, type Doc, type Fx, laneAt, type Pt, RATE, SPB, type Track } from "./model";
import { KINDS } from "./kinds";

export interface FxNode {
  input: AudioNode;
  output: AudioNode;
  params: Record<string, AudioParam>;
  set(v: Record<string, number>, final: boolean): void;
  bypass(on: boolean): void;
}

export interface TrackNodes {
  input: GainNode;
  fx: Array<{ id: number; node: FxNode }>;
  vol: GainNode;
  pan: StereoPannerNode;
  mute: GainNode;
  meter: AnalyserNode | null;
}

export interface Chain {
  ctx: BaseAudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  tracks: Map<number, TrackNodes>;
  sources: AudioScheduledSourceNode[];
  stoppers: Array<() => void>;
  analyser: AnalyserNode | null;
  splitter: ChannelSplitterNode | null;
  meters: AnalyserNode[];
}

const irCache = new Map<string, AudioBuffer>();

function impulse(ctx: BaseAudioContext, room: number, damping: number): AudioBuffer {
  const key = `${ctx.sampleRate}|${room.toFixed(2)}|${damping.toFixed(2)}`;
  const hit = irCache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (0.35 + room * 2.8));
  const pre = Math.floor(sr * 0.012);
  const b = ctx.createBuffer(2, len, sr);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const a = 1 - damping * 0.92;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let y = 0;
    for (let i = pre; i < len; i++) {
      y += (rnd() - y) * a;
      d[i] = y * Math.exp((-6.9 * (i - pre)) / (len - pre));
    }
  }
  irCache.set(key, b);
  return b;
}

function lfo(ctx: BaseAudioContext, ch: Chain, hz: number, type: OscillatorType = "sine"): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  o.start();
  ch.stoppers.push(() => { try { o.stop(); } catch {} });
  return o;
}

function drywet(ctx: BaseAudioContext): { input: GainNode; output: GainNode; dry: GainNode; wet: GainNode } {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry).connect(output);
  wet.connect(output);
  return { input, output, dry, wet };
}

function makeKind(ctx: BaseAudioContext, ch: Chain, kind: string, v: Record<string, number>): FxNode {
  const none = (): void => {};
  if (kind === "highpass" || kind === "lowpass" || kind === "peak" || kind === "lowshelf" || kind === "highshelf") {
    const f = ctx.createBiquadFilter();
    f.type = kind === "peak" ? "peaking" : kind;
    const set = (x: Record<string, number>): void => { f.frequency.value = x.freq; f.Q.value = x.q; f.gain.value = x.gainDb; };
    set(v);
    return { input: f, output: f, params: { freq: f.frequency, gainDb: f.gain }, set, bypass: none };
  }
  if (kind === "compressor") {
    const c = ctx.createDynamicsCompressor(), mk = ctx.createGain();
    c.knee.value = 6;
    c.connect(mk);
    const set = (x: Record<string, number>): void => {
      c.threshold.value = x.thresholdDb; c.ratio.value = x.ratio; c.attack.value = x.attackMs / 1000; c.release.value = x.releaseMs / 1000; mk.gain.value = dbToGain(x.makeupDb);
    };
    set(v);
    return { input: c, output: mk, params: {}, set, bypass: none };
  }
  if (kind === "limiter") {
    const c = ctx.createDynamicsCompressor();
    c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001;
    const set = (x: Record<string, number>): void => { c.threshold.value = x.ceilingDb; c.release.value = Math.min(1, x.releaseMs / 1000); };
    set(v);
    return { input: c, output: c, params: {}, set, bypass: none };
  }
  if (kind === "reverb") {
    const d = drywet(ctx), conv = ctx.createConvolver();
    d.dry.gain.value = 1;
    d.input.connect(conv).connect(d.wet);
    let shape = "";
    const set = (x: Record<string, number>, final: boolean): void => {
      d.wet.gain.value = x.mix;
      const s = `${x.room.toFixed(2)}|${x.damping.toFixed(2)}`;
      if (s !== shape && (final || !shape)) { shape = s; conv.buffer = impulse(ctx, x.room, x.damping); }
    };
    set(v, true);
    return { input: d.input, output: d.output, params: { mix: d.wet.gain }, set, bypass: none };
  }
  if (kind === "echo") {
    const d = drywet(ctx), dl = ctx.createDelay(2), fb = ctx.createGain();
    d.input.connect(dl);
    dl.connect(d.wet);
    dl.connect(fb).connect(dl);
    const set = (x: Record<string, number>): void => { dl.delayTime.value = x.delayMs / 1000; fb.gain.value = x.feedback; d.wet.gain.value = x.mix; };
    set(v);
    return { input: d.input, output: d.output, params: { mix: d.wet.gain }, set, bypass: none };
  }
  if (kind === "chorus" || kind === "flanger") {
    const d = drywet(ctx);
    const base = kind === "chorus" ? 0.02 : 0.004;
    const lines = (kind === "chorus" ? [1, 1.31] : [1]).map((r, i) => {
      const dl = ctx.createDelay(0.1), o = lfo(ctx, ch, 1, "sine"), amt = ctx.createGain();
      dl.delayTime.value = base * (1 + i * 0.3);
      o.connect(amt).connect(dl.delayTime);
      d.input.connect(dl).connect(d.wet);
      return { o, amt, r };
    });
    const set = (x: Record<string, number>): void => {
      for (const l of lines) { l.o.frequency.value = x.rateHz * l.r; l.amt.gain.value = (x.depthMs / 1000) * (kind === "chorus" ? 0.5 : 0.9); }
      d.wet.gain.value = x.mix;
    };
    set(v);
    return { input: d.input, output: d.output, params: { mix: d.wet.gain }, set, bypass: none };
  }
  if (kind === "phaser") {
    const d = drywet(ctx), o = lfo(ctx, ch), amt = ctx.createGain();
    let prev: AudioNode = d.input;
    for (const f0 of [500, 900, 1600, 2800]) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass"; ap.frequency.value = f0; ap.Q.value = 0.8;
      o.connect(amt);
      amt.connect(ap.detune);
      prev.connect(ap);
      prev = ap;
    }
    prev.connect(d.wet);
    const set = (x: Record<string, number>): void => { o.frequency.value = x.rateHz; amt.gain.value = x.depth * 1200; d.wet.gain.value = x.mix; };
    set(v);
    return { input: d.input, output: d.output, params: { mix: d.wet.gain }, set, bypass: none };
  }
  const amp = ctx.createGain(), o = lfo(ctx, ch), amt = ctx.createGain();
  o.connect(amt).connect(amp.gain);
  const set = (x: Record<string, number>): void => { o.frequency.value = x.rateHz; amp.gain.value = 1 - x.depth / 2; amt.gain.value = x.depth / 2; };
  set(v);
  return { input: amp, output: amp, params: {}, set, bypass: none };
}

export function makeFx(ctx: BaseAudioContext, ch: Chain, fx: Fx): FxNode {
  const inner = makeKind(ctx, ch, fx.kind, fx.v);
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry).connect(output);
  input.connect(inner.input);
  inner.output.connect(wet).connect(output);
  const bypass = (on: boolean): void => { dry.gain.value = on ? 1 : 0; wet.gain.value = on ? 0 : 1; };
  bypass(fx.bypass);
  return { input, output, params: inner.params, set: inner.set, bypass };
}

export function audible(doc: Doc): Set<number> {
  const solo = doc.tracks.some((t) => t.solo);
  return new Set(doc.tracks.filter((t) => (solo ? t.solo : !t.mute)).map((t) => t.id));
}

export function buildChain(ctx: BaseAudioContext, doc: Doc, opts: { live: boolean; master: boolean; only?: number | null }): Chain {
  const master = ctx.createGain();
  master.gain.value = dbToGain(doc.master.gainDb);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = doc.master.ceilingDb - 0.3;
  limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  const ch: Chain = { ctx, master, limiter, tracks: new Map(), sources: [], stoppers: [], analyser: null, splitter: null, meters: [] };
  if (opts.master) { master.connect(limiter); limiter.connect(ctx.destination); } else master.connect(ctx.destination);
  if (opts.live) {
    const an = ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
    (opts.master ? limiter : master).connect(an);
    ch.analyser = an;
    const sp = ctx.createChannelSplitter(2);
    (opts.master ? limiter : master).connect(sp);
    ch.splitter = sp;
    for (let i = 0; i < 2; i++) { const a = ctx.createAnalyser(); a.fftSize = 1024; sp.connect(a, i); ch.meters.push(a); }
  }
  const on = audible(doc);
  for (const t of doc.tracks) {
    if (opts.only != null ? t.id !== opts.only : false) continue;
    if (!opts.live && !on.has(t.id) && opts.only == null) continue;
    const input = ctx.createGain();
    const vol = ctx.createGain(), pan = ctx.createStereoPanner(), mute = ctx.createGain();
    vol.gain.value = dbToGain(t.vol);
    pan.pan.value = t.pan;
    mute.gain.value = opts.only != null || on.has(t.id) ? 1 : 0;
    const fx: TrackNodes["fx"] = [];
    let prev: AudioNode = input;
    for (const f of t.fx) { const node = makeFx(ctx, ch, f); prev.connect(node.input); prev = node.output; fx.push({ id: f.id, node }); }
    prev.connect(vol).connect(pan).connect(mute).connect(master);
    let meter: AnalyserNode | null = null;
    if (opts.live) { meter = ctx.createAnalyser(); meter.fftSize = 1024; pan.connect(meter); }
    ch.tracks.set(t.id, { input, fx, vol, pan, mute, meter });
  }
  return ch;
}

export function laneParam(tn: TrackNodes, key: string): { p: AudioParam; log: boolean; db: boolean } | null {
  if (key === "vol") return { p: tn.vol.gain, log: false, db: true };
  if (key === "pan") return { p: tn.pan.pan, log: false, db: false };
  const [id, k] = key.split(":");
  const f = tn.fx.find((x) => String(x.id) === id);
  const p = f?.node.params[k];
  return p ? { p, log: k === "freq", db: false } : null;
}

function schedLane(p: AudioParam, pts: Pt[], from: number, to: number, t0: number, log: boolean, db: boolean): void {
  const tEnd = t0 + (to - from) * SPB;
  const conv = (v: number): number => (db ? dbToGain(v) : v);
  p.cancelScheduledValues(t0);
  p.setValueAtTime(conv(laneAt(pts, from, 0)), t0);
  const times: number[] = [];
  for (const q of pts) if (q.beat > from && q.beat < to) times.push(q.beat);
  if (db) for (let b = Math.ceil(from * 4) / 4; b < to; b += 0.25) times.push(b);
  times.sort((a, b) => a - b);
  for (const b of times) {
    const v = conv(laneAt(pts, b, 0));
    const t = t0 + (b - from) * SPB;
    if (t <= t0) continue;
    if (log) p.exponentialRampToValueAtTime(Math.max(1e-3, v), t); else p.linearRampToValueAtTime(v, t);
  }
  const ve = conv(laneAt(pts, to, 0));
  if (log) p.exponentialRampToValueAtTime(Math.max(1e-3, ve), tEnd); else p.linearRampToValueAtTime(ve, tEnd);
}

export function scheduleRange(ch: Chain, doc: Doc, from: number, to: number, t0: number): void {
  const ctx = ch.ctx;
  for (const t of doc.tracks) {
    const tn = ch.tracks.get(t.id);
    if (!tn) continue;
    for (const c of t.clips) {
      const cs = c.start, ce = c.start + c.length;
      if (ce <= from || cs >= to) continue;
      const it = items.get(c.item);
      if (!it?.buffer) continue;
      const a = Math.max(cs, from), b = Math.min(ce, to);
      const when = t0 + (a - from) * SPB;
      const dur = (b - a) * SPB;
      const g = ctx.createGain();
      const gv = dbToGain(c.gainDb);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(gv, when + 0.004);
      g.gain.setValueAtTime(gv, Math.max(when + 0.004, when + dur - 0.006));
      g.gain.linearRampToValueAtTime(0, when + dur);
      const src = ctx.createBufferSource();
      src.buffer = it.buffer;
      src.connect(g).connect(tn.input);
      src.start(when, (c.offset + (a - cs)) * SPB, dur);
      ch.sources.push(src);
    }
    for (const key of Object.keys(t.auto)) {
      const pts = t.auto[key];
      const lp = laneParam(tn, key);
      if (lp && pts.length) schedLane(lp.p, pts, from, to, t0, lp.log, lp.db);
    }
  }
}

export function closeChain(ch: Chain): void {
  for (const s of ch.sources) { try { s.stop(); } catch {} }
  for (const f of ch.stoppers) f();
  try { ch.master.disconnect(); } catch {}
  for (const tn of ch.tracks.values()) { try { tn.mute.disconnect(); } catch {} }
}

export function sig(doc: Doc): string {
  return JSON.stringify([doc.tracks.map((t) => [t.id, t.clips.map((c) => [c.id, c.item, c.start, c.offset, c.length, c.gainDb]), t.fx.map((f) => [f.id, f.kind]), t.auto]), doc.region]);
}

export async function render(doc: Doc, opts: { from: number; to: number; tail: number; master: boolean; only?: number | null }): Promise<Float32Array[]> {
  const frames = Math.max(1, Math.ceil(((opts.to - opts.from) * SPB + opts.tail) * RATE));
  const ctx = new OfflineAudioContext(2, frames, RATE);
  const ch = buildChain(ctx, doc, { live: false, master: opts.master, only: opts.only ?? null });
  scheduleRange(ch, doc, opts.from, opts.to, 0);
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}

export function autoDefs(t: Track): Array<{ key: string; label: string; min: number; max: number; log: boolean; unit: string; rise: [number, number]; def: number }> {
  const defs = [
    { key: "vol", label: "Volume", min: -48, max: 6, log: false, unit: "dB", rise: [-36, 0] as [number, number], def: t.vol },
    { key: "pan", label: "Pan", min: -1, max: 1, log: false, unit: "", rise: [-1, 1] as [number, number], def: t.pan },
  ];
  for (const f of t.fx) {
    const k = KINDS[f.kind];
    if (!k) continue;
    for (const p of k.params) {
      const key = p[0];
      const ok = (key === "freq" && "highpass lowpass peak lowshelf highshelf".includes(f.kind)) || key === "mix" || (key === "gainDb" && "peak lowshelf highshelf".includes(f.kind));
      if (!ok) continue;
      const rise: [number, number] = key === "freq" ? [150, 14000] : key === "mix" ? [0, 0.8] : [-12, 6];
      defs.push({ key: `${f.id}:${key}`, label: `${k.label} ${p[1].toLowerCase()}`, min: p[2], max: p[3], log: !!p[5], unit: p[4], rise, def: f.v[key] ?? k.init[key] });
    }
  }
  return defs;
}
