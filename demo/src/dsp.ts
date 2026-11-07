export type Chans = Float32Array[];

export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export function monoOf(chans: Chans, s = 0, e = chans[0].length): Float32Array {
  const n = Math.max(0, e - s);
  const out = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) out[i] += c[s + i];
  const k = 1 / chans.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

export interface Spectro { frames: number; rows: number; data: Uint8Array }

const SPEC_SIZE = 1024;
const SPEC_ROWS = 256;

export function spectrogram(chans: Chans, rate: number): Spectro {
  const x = monoOf(chans);
  const n = x.length;
  const frames = Math.max(1, Math.min(3000, Math.floor(n / (SPEC_SIZE / 2))));
  const hop = n / frames;
  const win = new Float32Array(SPEC_SIZE);
  for (let i = 0; i < SPEC_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SPEC_SIZE - 1));
  const re = new Float32Array(SPEC_SIZE), im = new Float32Array(SPEC_SIZE);
  const bins = SPEC_SIZE / 2;
  const data = new Uint8Array(frames * SPEC_ROWS);
  const rowBin = new Float32Array(SPEC_ROWS);
  for (let r = 0; r < SPEC_ROWS; r++) {
    const t = 1 - r / (SPEC_ROWS - 1);
    rowBin[r] = t * t * (bins - 1);
  }
  const mag = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(f * hop + hop / 2 - SPEC_SIZE / 2);
    for (let i = 0; i < SPEC_SIZE; i++) {
      const idx = start + i;
      re[i] = idx >= 0 && idx < n ? x[idx] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) mag[b] = Math.hypot(re[b], im[b]) / (SPEC_SIZE / 4);
    for (let r = 0; r < SPEC_ROWS; r++) {
      const fb = rowBin[r];
      const b0 = Math.floor(fb), b1 = Math.min(bins - 1, b0 + 1);
      const m = mag[b0] + (mag[b1] - mag[b0]) * (fb - b0);
      const db = 20 * Math.log10(m + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 100) / 90));
      data[r * frames + f] = Math.round(v * 255);
    }
  }
  void rate;
  return { frames, rows: SPEC_ROWS, data };
}

export function averageSpectrum(chans: Chans, s: number, e: number, bins = 512): Float32Array {
  const size = bins * 2;
  const x = monoOf(chans, s, e);
  const out = new Float32Array(bins);
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float32Array(size), im = new Float32Array(size);
  const hop = size / 2;
  let count = 0;
  const frames = Math.max(1, Math.floor((x.length - size) / hop) + 1);
  const stride = Math.max(1, Math.floor(frames / 200));
  for (let f = 0; f < frames; f += stride) {
    const o = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = o + i < x.length ? x[o + i] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) out[b] += Math.hypot(re[b], im[b]) / (size / 4);
    count++;
  }
  for (let b = 0; b < bins; b++) out[b] /= count;
  return out;
}

export function peakOf(chans: Chans, s = 0, e = chans[0].length): number {
  let p = 0;
  for (const c of chans) for (let i = s; i < e; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}

export function rmsOf(chans: Chans, s = 0, e = chans[0].length): number {
  let sum = 0, n = 0;
  for (const c of chans) for (let i = s; i < e; i++) { sum += c[i] * c[i]; n++; }
  return n ? Math.sqrt(sum / n) : 0;
}

export function toDb(v: number): number {
  return v > 1e-9 ? 20 * Math.log10(v) : -Infinity;
}

export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

export function lowpass(f: number, q: number, rate: number): Biquad {
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}

export function highpass(f: number, q: number, rate: number): Biquad {
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}

export function peaking(f: number, q: number, gainDb: number, rate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const a0 = 1 + al / A;
  return { b0: (1 + al * A) / a0, b1: (-2 * c) / a0, b2: (1 - al * A) / a0, a1: (-2 * c) / a0, a2: (1 - al / A) / a0 };
}

export function notch(f: number, q: number, rate: number): Biquad {
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  return { b0: 1 / a0, b1: (-2 * c) / a0, b2: 1 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}

export function runBiquads(x: Float32Array, stages: Biquad[]): Float32Array {
  let cur = x;
  for (const q of stages) {
    const out = new Float32Array(cur.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < cur.length; i++) {
      const xi = cur[i];
      const y = q.b0 * xi + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y;
      out[i] = y;
    }
    cur = out;
  }
  return cur;
}

function kWeighted(x: Float32Array, rate: number): Float32Array {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  const f1 = 38.13547087602444, Q2 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / rate);
  a0 = 1 + K / Q2 + K * K;
  const s2: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q2 + K * K) / a0 };
  return runBiquads(x, [s1, s2]);
}

export function loudness(chans: Chans, rate: number, s = 0, e = chans[0].length): number {
  const block = Math.round(0.4 * rate), step = Math.round(0.1 * rate);
  const weighted = chans.map((c) => kWeighted(c.subarray(s, e), rate));
  const n = e - s;
  const z: number[] = [];
  if (n < block) {
    let sum = 0;
    for (const w of weighted) { let m = 0; for (let i = 0; i < n; i++) m += w[i] * w[i]; sum += n ? m / n : 0; }
    z.push(sum);
  } else {
    for (let o = 0; o + block <= n; o += step) {
      let sum = 0;
      for (const w of weighted) { let m = 0; for (let i = o; i < o + block; i++) m += w[i] * w[i]; sum += m / block; }
      z.push(sum);
    }
  }
  const lk = (v: number) => -0.691 + 10 * Math.log10(v + 1e-20);
  const abs = z.filter((v) => lk(v) > -70);
  if (!abs.length) return -Infinity;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = lk(mean) - 10;
  const gated = abs.filter((v) => lk(v) > rel);
  if (!gated.length) return -Infinity;
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function fadeShape(t: number, shape: number): number {
  if (shape === 1) return t * t * (3 - 2 * t);
  if (shape === 2) return t * t;
  return t;
}

export function compress(
  x: Chans, rate: number, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number, makeupDb: number,
): Chans {
  const n = x[0].length;
  const att = Math.exp(-1 / (rate * Math.max(0.1, attackMs) * 0.001));
  const rel = Math.exp(-1 / (rate * Math.max(1, releaseMs) * 0.001));
  const out = x.map(() => new Float32Array(n));
  const makeup = fromDb(makeupDb);
  let env = 0;
  for (let i = 0; i < n; i++) {
    let lvl = 0;
    for (const c of x) { const v = Math.abs(c[i]); if (v > lvl) lvl = v; }
    env = lvl > env ? att * env + (1 - att) * lvl : rel * env + (1 - rel) * lvl;
    const db = toDb(env);
    const over = db - thresholdDb;
    const gr = over > 0 ? -over * (1 - 1 / ratio) : 0;
    const g = fromDb(gr) * makeup;
    for (let c = 0; c < x.length; c++) out[c][i] = x[c][i] * g;
  }
  return out;
}

export function resampleLinear(x: Float32Array, factor: number): Float32Array {
  const n = Math.max(1, Math.floor(x.length / factor));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * factor, i0 = Math.floor(p), i1 = Math.min(x.length - 1, i0 + 1), f = p - i0;
    out[i] = x[i0] + (x[i1] - x[i0]) * f;
  }
  return out;
}

export function denoise(x: Float32Array, reductionDb: number, over: number): Float32Array {
  const N = 2048, H = 1024, bins = N / 2 + 1;
  const len = x.length;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const pad = new Float32Array(len + 2 * N);
  pad.set(x, N);
  const frames = Math.floor((len + N) / H) + 1;
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const o = f * H;
    for (let i = 0; i < N; i++) { const v = pad[o + i] * win[i]; sum += v * v; }
    energy[f] = sum;
  }
  const order = Array.from(energy.keys()).filter((f) => f * H >= N / 2 && f * H + N <= len + N + N / 2).sort((a, b) => energy[a] - energy[b]);
  const quiet = order.slice(0, Math.max(8, Math.round(order.length * 0.1)));
  const noise = new Float32Array(bins);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (const f of quiet) {
    for (let i = 0; i < N; i++) { re[i] = pad[f * H + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) noise[k] += (re[k] * re[k] + im[k] * im[k]) / quiet.length;
  }
  const floor = fromDb(-reductionDb);
  const out = new Float32Array(len + 2 * N);
  const gain = new Float32Array(bins), prev = new Float32Array(bins).fill(1), smooth = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    const o = f * H;
    for (let i = 0; i < N; i++) { re[i] = pad[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
      gain[k] = Math.max(floor, Math.sqrt(Math.max(0, 1 - (over * noise[k]) / p)));
    }
    for (let k = 0; k < bins; k++) {
      const g = (gain[Math.max(0, k - 1)] + 2 * gain[k] + gain[Math.min(bins - 1, k + 1)]) / 4;
      smooth[k] = g > prev[k] ? 0.5 * prev[k] + 0.5 * g : 0.7 * prev[k] + 0.3 * g;
      prev[k] = smooth[k];
    }
    for (let k = 0; k < bins; k++) {
      re[k] *= smooth[k]; im[k] = -im[k] * smooth[k];
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im);
    for (let i = 0; i < N; i++) out[o + i] += (re[i] / N) * win[i];
  }
  return out.slice(N, N + len);
}

export interface PeakPyramid { block: number; min: Float32Array[]; max: Float32Array[] }

export const PEAK_BLOCK = 128;

export function buildPeaks(chans: Chans): PeakPyramid {
  const n = chans[0].length;
  const blocks = Math.ceil(n / PEAK_BLOCK);
  const min: Float32Array[] = [], max: Float32Array[] = [];
  for (const c of chans) {
    const mn = new Float32Array(blocks), mx = new Float32Array(blocks);
    for (let b = 0; b < blocks; b++) {
      let lo = Infinity, hi = -Infinity;
      const end = Math.min(n, (b + 1) * PEAK_BLOCK);
      for (let i = b * PEAK_BLOCK; i < end; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      mn[b] = lo; mx[b] = hi;
    }
    min.push(mn); max.push(mx);
  }
  return { block: PEAK_BLOCK, min, max };
}
