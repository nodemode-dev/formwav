import { type Biquad, denoise, highpass, lowpass, notch, peaking, runBiquads } from "../../../demo/src/dsp";
import { compressSoft, declick, detectClicks, type HealBox, heal, highShelf, lowShelf, masterTo, type Span } from "./fx";

export type StageId = "heal" | "declick" | "dehum" | "denoise" | "eq" | "comp" | "master";

export interface ParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  options?: Array<[number, string]>;
}

export interface StageState {
  on: boolean;
  p: Record<string, number>;
  boxes: HealBox[];
}

export type Chain = Record<StageId, StageState>;

export interface StageExtra { spans?: Span[]; left?: Span[]; gr?: Float32Array; maxGr?: number; lufs?: number; gainDb?: number }
export interface StageResult { out: Float32Array; note: string; extra?: StageExtra }

export interface StageDef {
  id: StageId;
  title: string;
  blurb: string;
  params: ParamDef[];
  run(x: Float32Array, rate: number, s: StageState): StageResult;
}

export const STAGE_ORDER: StageId[] = ["heal", "declick", "dehum", "denoise", "eq", "comp", "master"];

const r = (id: string, label: string, min: number, max: number, step: number, unit: string): ParamDef => ({ id, label, min, max, step, unit });

export function eqStages(p: Record<string, number>, rate: number): Biquad[] {
  const out: Biquad[] = [];
  const nyq = rate * 0.45;
  if (p.hp > 21) out.push(highpass(p.hp, 0.5412, rate), highpass(p.hp, 1.3066, rate));
  if (Math.abs(p.lsg) > 0.05) out.push(lowShelf(Math.min(p.lsf, nyq), p.lsg, rate));
  if (Math.abs(p.pkg) > 0.05) out.push(peaking(Math.min(p.pkf, nyq), p.pkq, p.pkg, rate));
  if (Math.abs(p.hsg) > 0.05) out.push(highShelf(Math.min(p.hsf, nyq), p.hsg, rate));
  if (p.lp < 19000) out.push(lowpass(Math.min(p.lp, nyq), 0.5412, rate), lowpass(Math.min(p.lp, nyq), 1.3066, rate));
  return out;
}

function eqNote(p: Record<string, number>): string {
  const bits: string[] = [];
  if (p.hp > 21) bits.push(`high-pass ${Math.round(p.hp)} Hz`);
  if (Math.abs(p.pkg) > 0.05) bits.push(`${p.pkg > 0 ? "+" : ""}${p.pkg.toFixed(1)} dB at ${p.pkf >= 1000 ? (p.pkf / 1000).toFixed(1) + " kHz" : Math.round(p.pkf) + " Hz"}`);
  if (p.lp < 19000) bits.push(`low-pass ${p.lp >= 1000 ? (p.lp / 1000).toFixed(1) + " kHz" : Math.round(p.lp) + " Hz"}`);
  return bits.length ? bits.join(", ") : "Flat";
}

export const STAGES: StageDef[] = [
  {
    id: "heal", title: "Heal selection", blurb: "Rebuilds boxes you selected on the spectrogram from the sound around them",
    params: [],
    run: (x, rate, s) => (s.boxes.length ? { out: heal(x, rate, s.boxes), note: `${s.boxes.length} box${s.boxes.length === 1 ? "" : "es"} healed` } : { out: x, note: "No boxes yet" }),
  },
  {
    id: "declick", title: "De-click", blurb: "Finds short clicks and pops and rebuilds the samples across them",
    params: [r("sens", "Sensitivity", 3, 30, 0.5, "x"), r("maxMs", "Longest click", 0.1, 2, 0.1, "ms")],
    run: (x, rate, s) => {
      const { out, spans } = declick(x, rate, s.p.sens, s.p.maxMs);
      const left = detectClicks(out, rate, s.p.sens, s.p.maxMs);
      return { out, note: spans.length ? `${spans.length} click${spans.length === 1 ? "" : "s"} repaired` : "No clicks found", extra: { spans, left } };
    },
  },
  {
    id: "dehum", title: "De-hum", blurb: "Notches mains hum and its harmonics",
    params: [
      { id: "mains", label: "Mains", min: 50, max: 60, step: 10, unit: "", options: [[50, "50 Hz"], [60, "60 Hz"]] },
      r("harm", "Harmonics", 1, 8, 1, ""), r("q", "Notch width (Q)", 5, 80, 1, ""),
    ],
    run: (x, rate, s) => {
      const st: Biquad[] = [];
      for (let h = 1; h <= s.p.harm; h++) if (s.p.mains * h < rate * 0.45) st.push(notch(s.p.mains * h, s.p.q, rate));
      return { out: runBiquads(x, st), note: `Notches at ${s.p.mains}${s.p.harm > 1 ? ` to ${s.p.mains * s.p.harm}` : ""} Hz` };
    },
  },
  {
    id: "denoise", title: "Reduce noise", blurb: "Learns the steady noise from the quietest parts and turns it down",
    params: [r("red", "Reduction", 3, 36, 1, "dB"), r("sens", "Sensitivity", -3, 9, 0.5, "dB")],
    run: (x, _rate, s) => ({ out: denoise(x, s.p.red, Math.pow(10, s.p.sens / 10)), note: `Up to ${s.p.red} dB off the noise` }),
  },
  {
    id: "eq", title: "EQ", blurb: "High-pass, a bell, a high shelf and a low-pass to shape the tone",
    params: [
      r("hp", "High-pass", 20, 400, 1, "Hz"), r("pkf", "Bell frequency", 200, 8000, 10, "Hz"), r("pkg", "Bell gain", -12, 12, 0.1, "dB"), r("pkq", "Bell width (Q)", 0.3, 6, 0.1, ""),
      r("hsf", "Shelf frequency", 2000, 12000, 50, "Hz"), r("hsg", "Shelf gain", -12, 12, 0.1, "dB"), r("lp", "Low-pass", 2000, 20000, 50, "Hz"),
    ],
    run: (x, rate, s) => ({ out: runBiquads(x, eqStages(s.p, rate)), note: eqNote(s.p) }),
  },
  {
    id: "comp", title: "Compressor", blurb: "Evens out level by turning down what passes a threshold",
    params: [r("thr", "Threshold", -60, 0, 0.5, "dB"), r("ratio", "Ratio", 1, 20, 0.1, ":1"), r("att", "Attack", 1, 100, 1, "ms"), r("rel", "Release", 20, 1000, 10, "ms"), r("mk", "Makeup", 0, 18, 0.5, "dB")],
    run: (x, rate, s) => {
      const c = compressSoft(x, rate, s.p.thr, s.p.ratio, s.p.att, s.p.rel, s.p.mk);
      return { out: c.out, note: `Up to ${c.maxGr.toFixed(1)} dB reduction`, extra: { gr: c.gr, maxGr: c.maxGr } };
    },
  },
  {
    id: "master", title: "Loudness and limiter", blurb: "Raises the whole recording to a loudness target and holds the peaks under a ceiling",
    params: [r("target", "Loudness target", -30, -8, 0.5, "LUFS"), r("ceil", "Peak ceiling", -6, 0, 0.1, "dBFS")],
    run: (x, rate, s) => {
      const m = masterTo(x, rate, s.p.target, s.p.ceil);
      const g = `${m.gainDb >= 0 ? "+" : ""}${m.gainDb.toFixed(1)} dB`;
      return { out: m.out, note: `${g}, ${m.lufs.toFixed(1)} LUFS${m.maxGr > 0.05 ? `, limiter ${m.maxGr.toFixed(1)} dB` : ""}`, extra: { lufs: m.lufs, gainDb: m.gainDb } };
    },
  },
];

export const STAGE_BY_ID: Record<StageId, StageDef> = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, StageDef>;

export const DEFAULTS: Record<StageId, Record<string, number>> = {
  heal: {},
  declick: { sens: 5, maxMs: 1 },
  dehum: { mains: 60, harm: 4, q: 35 },
  denoise: { red: 14, sens: 3 },
  eq: { hp: 80, pkf: 3000, pkg: 2, pkq: 1, hsf: 6000, hsg: 0, lp: 20000 },
  comp: { thr: -24, ratio: 2.5, att: 12, rel: 160, mk: 2 },
  master: { target: -16, ceil: -1 },
};

export function makeChain(on: Partial<Record<StageId, boolean>>, over: Partial<Record<StageId, Record<string, number>>>): Chain {
  const c = {} as Chain;
  for (const id of STAGE_ORDER) c[id] = { on: on[id] ?? false, p: { ...DEFAULTS[id], ...(over[id] ?? {}) }, boxes: [] };
  return c;
}

export function cloneChain(c: Chain): Chain {
  const out = {} as Chain;
  for (const id of STAGE_ORDER) out[id] = { on: c[id].on, p: { ...c[id].p }, boxes: c[id].boxes.map((b) => ({ ...b })) };
  return out;
}
