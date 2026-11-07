import { buf } from "./lib";
import { type Pattern, RATE, SPB } from "./model";

export const STEPS = 16;

export const ROWS: Array<{ id: string; label: string; gain: number }> = [
  { id: "shot-kick", label: "Kick", gain: 1 },
  { id: "shot-subkick", label: "Sub kick", gain: 0.85 },
  { id: "shot-snare", label: "Snare", gain: 0.9 },
  { id: "shot-clap", label: "Noise snare", gain: 0.7 },
  { id: "shot-rim", label: "Rim", gain: 0.7 },
  { id: "shot-hat", label: "Closed hat", gain: 0.6 },
  { id: "shot-openhat", label: "Open hat", gain: 0.55 },
  { id: "shot-tom", label: "Tom", gain: 0.8 },
];

export const LEVELS = [127, 100, 60];

export function blank(): number[][] {
  return ROWS.map(() => Array(STEPS).fill(0));
}

function row(hits: Array<number | [number, number]>): number[] {
  const r = Array(STEPS).fill(0);
  for (const h of hits) { if (typeof h === "number") r[h] = 100; else r[h[0]] = h[1]; }
  return r;
}

export function initialPatterns(): Pattern[] {
  const a = blank();
  a[3] = row([[4, 127], [12, 127]]);
  a[4] = row([[7, 60], [10, 60], [15, 60]]);
  a[5] = row([[3, 60], [11, 60]]);
  a[6] = row([[2, 100], [6, 100], [10, 100], [14, 100]]);
  const b = blank();
  b[2] = row([[8, 100], [10, 100], [12, 127], [13, 100], [14, 127], [15, 127]]);
  b[7] = row([[4, 100], [6, 100], [7, 60]]);
  b[3] = row([[0, 127]]);
  return [
    { id: "pat-groove-a", name: "Groove A", rows: ROWS.map((r) => r.id), steps: a, bars: 2, swing: 56 },
    { id: "pat-fill-b", name: "Fill B", rows: ROWS.map((r) => r.id), steps: b, bars: 1, swing: 50 },
  ];
}

export function renderPattern(p: Pattern): AudioBuffer {
  const step = (SPB / 4) * RATE;
  const late = Math.round((Math.min(75, Math.max(50, p.swing)) / 100 - 0.5) * 2 * step);
  const len = Math.round(p.bars * 4 * SPB * RATE);
  const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: RATE });
  const L = out.getChannelData(0), R = out.getChannelData(1);
  for (let bar = 0; bar < p.bars; bar++) {
    for (let s = 0; s < STEPS; s++) {
      p.steps.forEach((r, ri) => {
        const v = r[s] ?? 0;
        if (v <= 0) return;
        const shot = buf(ROWS[ri].id);
        const g = (v / 127) * ROWS[ri].gain;
        const at = Math.round((bar * STEPS + s) * step) + (s % 2 ? late : 0);
        const a = shot.getChannelData(0), b = shot.numberOfChannels > 1 ? shot.getChannelData(1) : a;
        const n = Math.min(shot.length, len - at);
        for (let i = 0; i < n; i++) { L[at + i] += a[i] * g; R[at + i] += b[i] * g; }
      });
    }
  }
  return out;
}
