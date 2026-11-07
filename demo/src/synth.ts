import type { Chans } from "./dsp";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAMPLE_SECONDS = 12;

const VOWELS: Record<string, number[]> = {
  a: [800, 1150, 2900],
  e: [400, 2000, 2600],
  i: [300, 2300, 3000],
  o: [500, 1000, 2800],
  u: [350, 600, 2700],
};

class Resonator {
  private y1 = 0;
  private y2 = 0;
  constructor(private rate: number) {}
  step(x: number, f: number, bw: number): number {
    const r = Math.exp((-Math.PI * bw) / this.rate);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / this.rate);
    const y = (1 - r) * x + a1 * this.y1 - r * r * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export function sampleDialogue(rate: number): Chans {
  const n = Math.round(SAMPLE_SECONDS * rate);
  const out = new Float32Array(n);
  const rand = rng(11);
  const phrases: Array<{ at: number; syl: Array<[string, number, number]> }> = [
    { at: 0.5, syl: [["o", 0.22, 150], ["e", 0.2, 165], ["a", 0.3, 180], ["i", 0.26, 160], ["u", 0.34, 140]] },
    { at: 3.7, syl: [["a", 0.24, 170], ["u", 0.22, 150], ["e", 0.2, 190], ["o", 0.26, 175], ["a", 0.4, 140]] },
    { at: 7.6, syl: [["i", 0.2, 185], ["a", 0.24, 170], ["o", 0.22, 155], ["e", 0.3, 175], ["u", 0.5, 130]] },
  ];
  const res = [new Resonator(rate), new Resonator(rate), new Resonator(rate)];
  let phase = 0;
  for (const ph of phrases) {
    let t = ph.at;
    let prev = VOWELS[ph.syl[0][0]];
    for (const [v, dur, f0] of ph.syl) {
      const target = VOWELS[v];
      const s0 = Math.round(t * rate), s1 = Math.min(n, Math.round((t + dur) * rate));
      for (let i = s0; i < s1; i++) {
        const u = (i - s0) / (s1 - s0);
        const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
        const f = f0 * (1 + 0.04 * Math.sin(2 * Math.PI * 5.2 * (i / rate)) + 0.06 * (0.5 - u));
        phase += f / rate;
        if (phase >= 1) phase -= 1;
        const glot = phase < 0.4 ? Math.sin((Math.PI * phase) / 0.4) ** 2 - 0.3 : -0.12;
        const mix = Math.min(1, u * 3);
        let y = 0;
        for (let k = 0; k < 3; k++) {
          const fc = prev[k] + (target[k] - prev[k]) * mix;
          y += res[k].step(glot + (rand() - 0.5) * 0.04, fc, 70 + 40 * k) * (k === 0 ? 1.6 : k === 1 ? 1 : 0.5);
        }
        out[i] += y * env * 0.9;
      }
      prev = target;
      t += dur;
    }
  }
  for (let i = 0; i < n; i++) {
    const hum = 0.012 * Math.sin((2 * Math.PI * 50 * i) / rate) + 0.006 * Math.sin((2 * Math.PI * 100 * i) / rate) + 0.003 * Math.sin((2 * Math.PI * 150 * i) / rate);
    out[i] += hum + (rand() - 0.5) * 0.004;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.45 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return [out, Float32Array.from(out)];
}

export function sampleMusic(rate: number): Chans {
  const n = Math.round(SAMPLE_SECONDS * rate);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / 100;
  const chords = [
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [48, 55, 60, 64],
    [55, 59, 62, 67],
  ];
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  const steps = Math.floor(SAMPLE_SECONDS / (beat / 2));
  for (let s = 0; s < steps; s++) {
    const chord = chords[Math.floor(s / 8) % chords.length];
    const note = chord[[0, 1, 2, 3, 2, 1, 3, 2][s % 8]] + (s % 8 > 4 ? 12 : 0);
    const f = hz(note + 12);
    const start = Math.round(s * (beat / 2) * rate);
    const len = Math.round(0.55 * rate);
    const pan = 0.5 + 0.3 * Math.sin(s * 0.7);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / rate;
      const env = Math.exp(-t * 5.5) * Math.min(1, t * 400);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h * 0.8);
      v *= env * 0.22;
      L[start + i] += v * (1 - pan);
      R[start + i] += v * pan;
    }
  }
  for (let c = 0; c < chords.length; c++) {
    const start = Math.round(c * 8 * (beat / 2) * rate);
    const len = Math.round(8 * (beat / 2) * rate * 1.05);
    for (const m of chords[c].slice(0, 3)) {
      const f = hz(m);
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.8) * Math.min(1, (len - i) / (0.5 * rate));
        const a = Math.sin(2 * Math.PI * f * 1.002 * t), b = Math.sin(2 * Math.PI * f * 0.998 * t);
        L[start + i] += a * env * 0.05;
        R[start + i] += b * env * 0.05;
      }
    }
  }
  const d = Math.round(0.3 * rate);
  for (let i = d; i < n; i++) {
    L[i] += R[i - d] * 0.28;
    R[i] += L[i - d] * 0.28;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.32 / (peak || 1);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return [L, R];
}

export function sampleDrums(rate: number): Chans {
  const n = Math.round(SAMPLE_SECONDS * rate);
  const out = new Float32Array(n);
  const rand = rng(5);
  const beat = 60 / 100;
  const step = beat / 4;
  const total = Math.floor(SAMPLE_SECONDS / step);
  for (let s = 0; s < total; s++) {
    const pos = s % 16;
    const start = Math.round(s * step * rate);
    if (pos === 0 || pos === 6 || pos === 8 || pos === 11) {
      const len = Math.round(0.28 * rate);
      let ph = 0;
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / rate;
        ph += (46 + 110 * Math.exp(-t * 28)) / rate;
        out[start + i] += Math.sin(2 * Math.PI * ph) * Math.exp(-t * 11) * 0.9;
      }
    }
    if (pos === 4 || pos === 12) {
      const len = Math.round(0.2 * rate);
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / rate;
        out[start + i] += ((rand() - 0.5) * Math.exp(-t * 22) * 0.6) + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.4;
      }
    }
    if (pos % 2 === 0) {
      const len = Math.round(0.05 * rate);
      let prev = 0;
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / rate;
        const w = rand() - 0.5;
        out[start + i] += (w - prev) * Math.exp(-t * 90) * 0.35;
        prev = w;
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.4 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return [out, Float32Array.from(out)];
}

export type GenKind = "tone" | "sweep" | "noise" | "clicks";

export function generate(kind: GenKind, rate: number, seconds: number, freq: number, level: number): Chans {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const rand = rng(99);
  if (kind === "tone") for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * level;
  if (kind === "sweep") {
    const f0 = 40, f1 = Math.min(rate / 2 - 200, 18000), k = Math.log(f1 / f0);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += (f0 * Math.exp((k * i) / n)) / rate;
      out[i] = Math.sin(2 * Math.PI * ph) * level;
    }
  }
  if (kind === "noise") {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2 * level;
    }
  }
  if (kind === "clicks") {
    const gap = Math.round(rate * 0.5);
    for (let i = 0; i < n; i += gap) for (let j = 0; j < 80 && i + j < n; j++) out[i + j] = Math.sin((2 * Math.PI * 1000 * j) / rate) * Math.exp(-j / 18) * level;
  }
  return [out, Float32Array.from(out)];
}
