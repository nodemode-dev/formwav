import type { SessionDoc } from "./document";

export const PPQ = 960;

export interface TempoChange {
  tick: number;
  bpm: number;
}

export interface MeterChange {
  bar: number;
  num: number;
  den: number;
}

export interface KeyChange {
  tick: number;
  key: string;
}

export type CurveShape = "linear" | "parabolic" | "s-curve";

interface Segment {
  tick: number;
  bpm: number;
  at: number;
}

interface MeterSpan {
  bar: number;
  tick: number;
  num: number;
  den: number;
}

export interface TempoMap {
  rate: number;
  segments: readonly Segment[];
  meters: readonly MeterSpan[];
}

export const ticksPerBeat = (den: number) => (PPQ * 4) / den;
export const ticksPerBar = (num: number, den: number) => num * ticksPerBeat(den);

/** True when the session has more than one tempo or meter, or a meter not counted in quarters. */
export function hasMap(doc: SessionDoc): boolean {
  return !!doc.tempoChanges?.length || !!doc.meterChanges?.length || (doc.tempo?.beatUnit ?? 4) !== 4;
}

export function tempoMap(doc: SessionDoc): TempoMap {
  const rate = doc.sampleRate;
  const base = doc.tempo?.bpm ?? 120;
  const segments: Segment[] = [{ tick: 0, bpm: base, at: 0 }];
  for (const c of [...(doc.tempoChanges ?? [])].sort((a, b) => a.tick - b.tick)) {
    if (c.tick <= 0) continue;
    const last = segments[segments.length - 1];
    segments.push({ tick: c.tick, bpm: c.bpm, at: last.at + ((c.tick - last.tick) / PPQ) * ((60 * rate) / last.bpm) });
  }
  const meters: MeterSpan[] = [{ bar: 0, tick: 0, num: doc.tempo?.beatsPerBar ?? 4, den: doc.tempo?.beatUnit ?? 4 }];
  for (const m of [...(doc.meterChanges ?? [])].sort((a, b) => a.bar - b.bar)) {
    if (m.bar <= 0) continue;
    const last = meters[meters.length - 1];
    if (m.bar === last.bar) continue;
    meters.push({ bar: m.bar, tick: last.tick + (m.bar - last.bar) * ticksPerBar(last.num, last.den), num: m.num, den: m.den });
  }
  return { rate, segments, meters };
}

function segmentAtTick(map: TempoMap, tick: number): Segment {
  let s = map.segments[0];
  for (const x of map.segments) if (x.tick <= tick) s = x;
  return s;
}

export function tickToSample(map: TempoMap, tick: number): number {
  const s = segmentAtTick(map, tick);
  return s.at + ((tick - s.tick) / PPQ) * ((60 * map.rate) / s.bpm);
}

export function sampleToTick(map: TempoMap, sample: number): number {
  let s = map.segments[0];
  for (const x of map.segments) if (x.at <= sample) s = x;
  return s.tick + ((sample - s.at) * s.bpm * PPQ) / (60 * map.rate);
}

export function bpmAt(map: TempoMap, tick: number): number {
  return segmentAtTick(map, tick).bpm;
}

function meterAtBar(map: TempoMap, bar: number): MeterSpan {
  let m = map.meters[0];
  for (const x of map.meters) if (x.bar <= bar) m = x;
  return m;
}

export function meterAtTick(map: TempoMap, tick: number): MeterSpan {
  let m = map.meters[0];
  for (const x of map.meters) if (x.tick <= tick) m = x;
  return m;
}

/** The tick a bar (counted from 0) starts on. */
export function barStartTick(map: TempoMap, bar: number): number {
  const m = meterAtBar(map, bar);
  return m.tick + (bar - m.bar) * ticksPerBar(m.num, m.den);
}

/** Where a tick falls: its bar and beat (both from 0), the ticks into that beat, and the meter there. */
export function barBeatAt(map: TempoMap, tick: number): { bar: number; beat: number; ticks: number; num: number; den: number } {
  const m = meterAtTick(map, tick);
  const perBar = ticksPerBar(m.num, m.den);
  const perBeat = ticksPerBeat(m.den);
  const bar = m.bar + Math.floor((tick - m.tick) / perBar + 1e-9);
  const into = tick - (m.tick + (bar - m.bar) * perBar);
  const beat = Math.min(m.num - 1, Math.floor(into / perBeat + 1e-9));
  return { bar, beat, ticks: into - beat * perBeat, num: m.num, den: m.den };
}

/** Every bar line from `from` to `to` samples: its bar (from 0), sample and meter. */
export function barsBetween(map: TempoMap, from: number, to: number, max = 4096): { bar: number; at: number; num: number; den: number }[] {
  const out: { bar: number; at: number; num: number; den: number }[] = [];
  for (let bar = Math.max(0, barBeatAt(map, sampleToTick(map, Math.max(0, from))).bar); out.length < max; bar++) {
    const m = meterAtBar(map, bar);
    const at = tickToSample(map, barStartTick(map, bar));
    if (at > to) break;
    out.push({ bar, at, num: m.num, den: m.den });
  }
  return out;
}

/** S11: a tempo ramp written as steps every `resolution` ticks from `from` to `to`, starting at `start` and reaching
 *  `end` on the last step, with the tempo that played at `to` written back there so what follows keeps its tempo. */
export function tempoCurve(doc: SessionDoc, from: number, to: number, start: number, end: number, shape: CurveShape, resolution: number): TempoChange[] {
  const map = tempoMap(doc);
  const after = bpmAt(map, to);
  const steps = Math.max(1, Math.ceil((to - from) / Math.max(1, resolution)));
  const ease = (t: number) => (shape === "parabolic" ? t * t : shape === "s-curve" ? t * t * (3 - 2 * t) : t);
  const kept = all(doc).filter((c) => c.tick < from || c.tick > to);
  const ramp = Array.from({ length: steps }, (_, i) => ({ tick: Math.round(from + i * resolution), bpm: round3(start + (end - start) * ease(steps === 1 ? 1 : i / (steps - 1))) }));
  return [...kept, ...ramp, { tick: to, bpm: after }].sort((a, b) => a.tick - b.tick);
}

/** S11: every tempo from `from` to `to` (ticks) times `factor`, the tempo at `to` kept for what follows. */
export function scaleTempo(doc: SessionDoc, from: number, to: number, factor: number): TempoChange[] {
  const map = tempoMap(doc);
  const after = bpmAt(map, to);
  const inside = all(doc).filter((c) => c.tick > from && c.tick < to).map((c) => ({ tick: c.tick, bpm: round3(c.bpm * factor) }));
  const kept = all(doc).filter((c) => c.tick < from || c.tick > to);
  return [...kept, { tick: from, bpm: round3(bpmAt(map, from) * factor) }, ...inside, { tick: to, bpm: after }].sort((a, b) => a.tick - b.tick);
}

/** The session's tempos as one list, the first at tick 0. */
function all(doc: SessionDoc): TempoChange[] {
  return [{ tick: 0, bpm: doc.tempo?.bpm ?? 120 }, ...(doc.tempoChanges ?? []).filter((c) => c.tick > 0)];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function keyAt(doc: SessionDoc, tick: number): string | null {
  let key = doc.key?.name ?? null;
  for (const k of [...(doc.keyChanges ?? [])].sort((a, b) => a.tick - b.tick)) if (k.tick <= tick) key = k.key;
  return key;
}
