import {
  type Chans, compress, fadeShape, fromDb, highpass, loudness, lowpass, notch, peaking, peakOf, resampleLinear, runBiquads, toDb,
} from "./dsp";

export interface RangeParam { kind: "range"; id: string; label: string; min: number; max: number; step: number; value: number; unit: string }
export interface SelectParam { kind: "select"; id: string; label: string; options: Array<[number, string]>; value: number }
export type Param = RangeParam | SelectParam;

export interface OpContext { chans: Chans; rate: number; s: number; e: number; p: Record<string, number> }
export interface OpResult { chans: Chans; sel?: [number, number] | null; note?: string }

export interface Op {
  id: string;
  title: string;
  group: string;
  blurb: string;
  needsSel?: boolean;
  params: Param[];
  run(c: OpContext): OpResult;
}

const range = (id: string, label: string, min: number, max: number, step: number, value: number, unit: string): RangeParam => ({ kind: "range", id, label, min, max, step, value, unit });
const select = (id: string, label: string, options: Array<[number, string]>, value: number): SelectParam => ({ kind: "select", id, label, options, value });

function mapRegion(c: OpContext, fn: (slice: Float32Array, ch: number) => Float32Array): Chans {
  return c.chans.map((x, ch) => {
    const out = Float32Array.from(x);
    out.set(fn(x.subarray(c.s, c.e), ch), c.s);
    return out;
  });
}

function filterRegion(c: OpContext, stages: Parameters<typeof runBiquads>[1]): Chans {
  const warm = Math.min(c.s, Math.round(c.rate * 0.5));
  return c.chans.map((x) => {
    const out = Float32Array.from(x);
    const y = runBiquads(x.subarray(c.s - warm, c.e), stages);
    out.set(y.subarray(warm), c.s);
    return out;
  });
}

function slopeStages(kind: "hp" | "lp", f: number, slope: number, rate: number) {
  const qs = slope === 24 ? [0.5412, 1.3066] : [0.7071];
  return qs.map((q) => (kind === "hp" ? highpass(f, q, rate) : lowpass(f, q, rate)));
}

function spliceOut(chans: Chans, cuts: Array<[number, number]>): Chans {
  const n = chans[0].length;
  let removed = 0;
  for (const [a, b] of cuts) removed += b - a;
  return chans.map((x) => {
    const out = new Float32Array(n - removed);
    let o = 0, pos = 0;
    for (const [a, b] of cuts) {
      out.set(x.subarray(pos, a), o);
      o += a - pos;
      pos = b;
    }
    out.set(x.subarray(pos), o);
    return out;
  });
}

const SHAPES: Array<[number, string]> = [[0, "Linear"], [1, "Smooth"], [2, "Slow start"]];

export const OPS: Op[] = [
  {
    id: "trim", title: "Trim to selection", group: "Edit", blurb: "Keeps only the selected range of the track", needsSel: true, params: [],
    run: (c) => ({ chans: c.chans.map((x) => Float32Array.from(x.subarray(c.s, c.e))), sel: null }),
  },
  {
    id: "delete", title: "Delete selection", group: "Edit", blurb: "Removes the range and closes the gap", needsSel: true, params: [],
    run: (c) => ({ chans: spliceOut(c.chans, [[c.s, c.e]]), sel: null }),
  },
  {
    id: "silence", title: "Silence", group: "Edit", blurb: "Mutes the range and keeps its length", needsSel: true, params: [],
    run: (c) => ({ chans: mapRegion(c, (x) => new Float32Array(x.length)) }),
  },
  {
    id: "reverse", title: "Reverse", group: "Edit", blurb: "Plays the range backwards", params: [],
    run: (c) => ({ chans: mapRegion(c, (x) => Float32Array.from(x).reverse()) }),
  },
  {
    id: "invert", title: "Invert polarity", group: "Edit", blurb: "Flips the sign of every sample in the range", params: [],
    run: (c) => ({ chans: mapRegion(c, (x) => x.map((v) => -v)) }),
  },
  {
    id: "gain", title: "Gain", group: "Level", blurb: "Raises or lowers the range by a number of decibels",
    params: [range("db", "Gain", -48, 24, 0.1, 6, "dB")],
    run: (c) => {
      const g = fromDb(c.p.db);
      return { chans: mapRegion(c, (x) => x.map((v) => v * g)) };
    },
  },
  {
    id: "normalize", title: "Normalize peak", group: "Level", blurb: "Scales the range so its loudest sample hits the target",
    params: [range("target", "Peak target", -30, 0, 0.1, -1, "dBFS")],
    run: (c) => {
      const pk = peakOf(c.chans, c.s, c.e);
      if (pk < 1e-6) return { chans: c.chans, note: "The range is silent, nothing to normalize" };
      const g = fromDb(c.p.target) / pk;
      return { chans: mapRegion(c, (x) => x.map((v) => v * g)), note: `Peak ${toDb(pk).toFixed(1)} dBFS to ${c.p.target.toFixed(1)} dBFS (${toDb(g) >= 0 ? "+" : ""}${toDb(g).toFixed(1)} dB)` };
    },
  },
  {
    id: "loudness", title: "Normalize loudness", group: "Level", blurb: "Sets the integrated loudness (BS.1770 K-weighted) to a target",
    params: [range("target", "Loudness target", -40, -5, 0.5, -16, "LUFS"), range("ceiling", "Peak ceiling", -12, 0, 0.1, -1, "dBFS")],
    run: (c) => {
      const l = loudness(c.chans, c.rate, c.s, c.e);
      if (!isFinite(l)) return { chans: c.chans, note: "Too quiet to measure, nothing changed" };
      let g = fromDb(c.p.target - l);
      const pk = peakOf(c.chans, c.s, c.e) * g;
      const cap = fromDb(c.p.ceiling);
      let limited = false;
      if (pk > cap) { g *= cap / pk; limited = true; }
      const after = l + toDb(g);
      return { chans: mapRegion(c, (x) => x.map((v) => v * g)), note: `${l.toFixed(1)} LUFS to ${after.toFixed(1)} LUFS${limited ? ", held by the peak ceiling" : ""}` };
    },
  },
  {
    id: "fadein", title: "Fade in", group: "Level", blurb: "Ramps the start of the range up from silence",
    params: [range("len", "Length", 0.01, 10, 0.01, 1, "s"), select("shape", "Curve", SHAPES, 1)],
    run: (c) => {
      const len = Math.min(c.e - c.s, Math.round(c.p.len * c.rate));
      return { chans: mapRegion(c, (x) => { const o = Float32Array.from(x); for (let i = 0; i < len; i++) o[i] *= fadeShape(i / len, c.p.shape); return o; }) };
    },
  },
  {
    id: "fadeout", title: "Fade out", group: "Level", blurb: "Ramps the end of the range down to silence",
    params: [range("len", "Length", 0.01, 10, 0.01, 1, "s"), select("shape", "Curve", SHAPES, 1)],
    run: (c) => {
      const len = Math.min(c.e - c.s, Math.round(c.p.len * c.rate));
      return { chans: mapRegion(c, (x) => { const o = Float32Array.from(x); const n = o.length; for (let i = 0; i < len; i++) o[n - 1 - i] *= fadeShape(i / len, c.p.shape); return o; }) };
    },
  },
  {
    id: "highpass", title: "High-pass filter", group: "Filter", blurb: "Removes rumble and low energy below a frequency",
    params: [range("freq", "Cutoff", 20, 2000, 1, 120, "Hz"), select("slope", "Slope", [[12, "12 dB per octave"], [24, "24 dB per octave"]], 24)],
    run: (c) => ({ chans: filterRegion(c, slopeStages("hp", c.p.freq, c.p.slope, c.rate)) }),
  },
  {
    id: "lowpass", title: "Low-pass filter", group: "Filter", blurb: "Removes hiss and highs above a frequency",
    params: [range("freq", "Cutoff", 200, 20000, 10, 4000, "Hz"), select("slope", "Slope", [[12, "12 dB per octave"], [24, "24 dB per octave"]], 24)],
    run: (c) => ({ chans: filterRegion(c, slopeStages("lp", Math.min(c.p.freq, c.rate * 0.45), c.p.slope, c.rate)) }),
  },
  {
    id: "eq", title: "Band EQ", group: "Filter", blurb: "Boosts or cuts one band with a bell curve",
    params: [range("freq", "Frequency", 40, 16000, 1, 3000, "Hz"), range("gain", "Gain", -18, 18, 0.1, 4, "dB"), range("q", "Width (Q)", 0.2, 10, 0.1, 1, "")],
    run: (c) => ({ chans: filterRegion(c, [peaking(Math.min(c.p.freq, c.rate * 0.45), c.p.q, c.p.gain, c.rate)]) }),
  },
  {
    id: "dehum", title: "De-hum", group: "Filter", blurb: "Notches mains hum and its harmonics",
    params: [select("mains", "Mains", [[50, "50 Hz"], [60, "60 Hz"]], 50), range("harm", "Harmonics", 1, 6, 1, 3, ""), range("q", "Notch width (Q)", 10, 80, 1, 35, "")],
    run: (c) => {
      const stages = [];
      for (let h = 1; h <= c.p.harm; h++) if (c.p.mains * h < c.rate * 0.45) stages.push(notch(c.p.mains * h, c.p.q, c.rate));
      return { chans: filterRegion(c, stages) };
    },
  },
  {
    id: "compressor", title: "Compressor", group: "Dynamics", blurb: "Evens out level by turning down what exceeds a threshold",
    params: [
      range("thr", "Threshold", -60, 0, 0.5, -20, "dB"), range("ratio", "Ratio", 1, 20, 0.1, 3, ":1"),
      range("att", "Attack", 1, 100, 1, 10, "ms"), range("rel", "Release", 20, 1000, 10, 200, "ms"), range("mk", "Makeup", 0, 24, 0.5, 3, "dB"),
    ],
    run: (c) => {
      const slice = c.chans.map((x) => x.subarray(c.s, c.e));
      const y = compress(slice, c.rate, c.p.thr, c.p.ratio, c.p.att, c.p.rel, c.p.mk);
      return { chans: mapRegion(c, (_x, ch) => y[ch]) };
    },
  },
  {
    id: "strip", title: "Strip silence", group: "Dynamics", blurb: "Deletes pauses quieter than a threshold and closes the gaps",
    params: [range("thr", "Silence below", -80, -20, 1, -45, "dB"), range("min", "Pause at least", 50, 2000, 10, 300, "ms"), range("pad", "Keep around", 0, 200, 5, 40, "ms")],
    run: (c) => {
      const win = Math.max(1, Math.round(c.rate * 0.005));
      const thr = fromDb(c.p.thr);
      const minWin = Math.round((c.p.min / 1000) * c.rate / win);
      const pad = Math.round((c.p.pad / 1000) * c.rate);
      const cuts: Array<[number, number]> = [];
      let runStart = -1;
      const flush = (endIdx: number) => {
        if (runStart < 0) return;
        if ((endIdx - runStart) / win >= minWin) {
          const a = c.s + runStart + pad, b = c.s + endIdx - pad;
          if (b > a) cuts.push([a, b]);
        }
        runStart = -1;
      };
      const n = c.e - c.s;
      for (let o = 0; o < n; o += win) {
        const end = Math.min(n, o + win);
        let m = 0;
        for (const x of c.chans) for (let i = o; i < end; i++) { const v = Math.abs(x[c.s + i]); if (v > m) m = v; }
        if (m < thr) { if (runStart < 0) runStart = o; } else flush(o);
      }
      flush(n);
      if (!cuts.length) return { chans: c.chans, note: "No pause matched, nothing removed" };
      let removed = 0;
      for (const [a, b] of cuts) removed += b - a;
      return { chans: spliceOut(c.chans, cuts), sel: null, note: `Removed ${cuts.length} pause${cuts.length === 1 ? "" : "s"}, ${(removed / c.rate).toFixed(2)} s` };
    },
  },
  {
    id: "speed", title: "Change speed", group: "Time", blurb: "Plays the range faster or slower; pitch follows the speed",
    params: [range("factor", "Speed", 0.25, 4, 0.01, 1.25, "x")],
    run: (c) => {
      const out = c.chans.map((x) => {
        const head = x.subarray(0, c.s), mid = resampleLinear(x.subarray(c.s, c.e), c.p.factor), tail = x.subarray(c.e);
        const o = new Float32Array(head.length + mid.length + tail.length);
        o.set(head, 0); o.set(mid, head.length); o.set(tail, head.length + mid.length);
        return o;
      });
      return { chans: out, sel: [c.s, c.s + out[0].length - (c.chans[0].length - (c.e - c.s))] };
    },
  },
  {
    id: "mono", title: "Mono mixdown", group: "Time", blurb: "Folds the track's channels into one",
    params: [],
    run: (c) => {
      if (c.chans.length < 2) return { chans: c.chans, note: "The track is already mono" };
      const n = c.chans[0].length;
      const m = new Float32Array(n);
      for (const x of c.chans) for (let i = 0; i < n; i++) m[i] += x[i] / c.chans.length;
      return { chans: [m] };
    },
  },
];

export const OP_BY_ID: Record<string, Op> = Object.fromEntries(OPS.map((o) => [o.id, o]));
