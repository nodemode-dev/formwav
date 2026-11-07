import { type Biquad, fft, fromDb, loudness, toDb } from "../../../demo/src/dsp";

export interface Span { a: number; b: number }
export interface HealBox { t0: number; t1: number; f0: number; f1: number }

export function lowShelf(f: number, gainDb: number, rate: number): Biquad {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f) / rate, c = Math.cos(w), s = Math.sin(w);
  const al = (s / 2) * Math.SQRT2, k = 2 * Math.sqrt(A) * al;
  const a0 = A + 1 + (A - 1) * c + k;
  return {
    b0: (A * (A + 1 - (A - 1) * c + k)) / a0,
    b1: (2 * A * (A - 1 - (A + 1) * c)) / a0,
    b2: (A * (A + 1 - (A - 1) * c - k)) / a0,
    a1: (-2 * (A - 1 + (A + 1) * c)) / a0,
    a2: (A + 1 + (A - 1) * c - k) / a0,
  };
}

export function highShelf(f: number, gainDb: number, rate: number): Biquad {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f) / rate, c = Math.cos(w), s = Math.sin(w);
  const al = (s / 2) * Math.SQRT2, k = 2 * Math.sqrt(A) * al;
  const a0 = A + 1 - (A - 1) * c + k;
  return {
    b0: (A * (A + 1 + (A - 1) * c + k)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * c)) / a0,
    b2: (A * (A + 1 + (A - 1) * c - k)) / a0,
    a1: (2 * (A - 1 - (A + 1) * c)) / a0,
    a2: (A + 1 - (A - 1) * c - k) / a0,
  };
}

export function responseDb(stages: Biquad[], f: number, rate: number): number {
  const w = (2 * Math.PI * f) / rate;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let db = 0;
  for (const q of stages) {
    const nr = q.b0 + q.b1 * c1 + q.b2 * c2, ni = -(q.b1 * s1 + q.b2 * s2);
    const dr = 1 + q.a1 * c1 + q.a2 * c2, di = -(q.a1 * s1 + q.a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni + 1e-30) / (dr * dr + di * di + 1e-30));
  }
  return db;
}

const LPC_ORDER = 12;

function lpcCoefs(x: Float32Array, s: number, e: number): Float64Array {
  const n = e - s, w = new Float64Array(n), a = new Float64Array(LPC_ORDER), tmp = new Float64Array(LPC_ORDER);
  for (let i = 0; i < n; i++) w[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n));
  const r = new Float64Array(LPC_ORDER + 1);
  for (let k = 0; k <= LPC_ORDER; k++) { let sum = 0; for (let i = k; i < n; i++) sum += w[i] * w[i - k]; r[k] = sum; }
  r[0] = r[0] * 1.0001 + 1e-12;
  let err = r[0];
  for (let i = 0; i < LPC_ORDER; i++) {
    let acc = r[i + 1];
    for (let j = 0; j < i; j++) acc -= a[j] * r[i - j];
    const k = acc / err;
    for (let j = 0; j < i; j++) tmp[j] = a[j] - k * a[i - 1 - j];
    for (let j = 0; j < i; j++) a[j] = tmp[j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return a;
}

function medianOf(v: Float32Array, m: number): number {
  let hi = 0;
  for (let i = 0; i < m; i++) if (v[i] > hi) hi = v[i];
  if (hi <= 0) return 0;
  const bins = new Uint16Array(512), k = 511 / hi;
  for (let i = 0; i < m; i++) bins[(v[i] * k) | 0]++;
  let acc = 0;
  for (let b = 0; b < 512; b++) { acc += bins[b]; if (acc >= m / 2) return ((b + 0.5) / k); }
  return hi;
}

export function detectClicks(x: Float32Array, rate: number, sens: number, maxMs: number): Span[] {
  const n = x.length, B = 1024, hit: number[] = [];
  const abs = new Float32Array(B);
  for (let s = LPC_ORDER; s < n; s += B) {
    const e = Math.min(n, s + B), m = e - s;
    const a = lpcCoefs(x, Math.max(0, s - 128), Math.min(n, e + 128));
    for (let i = 0; i < m; i++) {
      let p = 0;
      for (let k = 0; k < LPC_ORDER; k++) p += a[k] * x[s + i - 1 - k];
      abs[i] = Math.abs(x[s + i] - p);
    }
    const sigma = Math.max(1e-6, 1.4826 * medianOf(abs, m));
    for (let i = 0; i < m; i++) if (abs[i] > sens * sigma) hit.push(s + i);
  }
  const maxLen = Math.max(2, Math.round((maxMs / 1000) * rate));
  const spans: Span[] = [];
  let i = 0;
  while (i < hit.length) {
    let j = i;
    while (j + 1 < hit.length && hit[j + 1] - hit[j] <= 16) j++;
    const a = Math.max(2, hit[i] - 10), b = Math.min(n - 3, hit[j] + 14);
    if (b - a + 1 <= maxLen) spans.push({ a, b });
    i = j + 1;
  }
  return spans;
}

export function declick(x: Float32Array, rate: number, sens: number, maxMs: number): { out: Float32Array; spans: Span[] } {
  const first = declickOnce(x, rate, sens, maxMs);
  let out = first.out;
  for (let pass = 1; pass < 3; pass++) out = declickOnce(out, rate, sens, maxMs).out;
  return { out, spans: first.spans };
}

function declickOnce(x: Float32Array, rate: number, sens: number, maxMs: number): { out: Float32Array; spans: Span[] } {
  const spans = detectClicks(x, rate, sens, maxMs);
  const out = Float32Array.from(x);
  const n = x.length;
  for (const { a, b } of spans) {
    const lo = Math.max(0, a - 512), hi = Math.min(n, b + 512);
    if (a - lo < LPC_ORDER + 2 || hi - b < LPC_ORDER + 2) continue;
    const c = lpcCoefs(out, lo, hi);
    const len = b - a + 1;
    const fwd = new Float32Array(len), bwd = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let p = 0;
      for (let k = 0; k < LPC_ORDER; k++) { const j = a + i - 1 - k; p += c[k] * (j >= a ? fwd[j - a] : out[j]); }
      fwd[i] = p;
    }
    for (let i = len - 1; i >= 0; i--) {
      let p = 0;
      for (let k = 0; k < LPC_ORDER; k++) { const j = a + i + 1 + k; p += c[k] * (j <= b ? bwd[j - a] : out[j]); }
      bwd[i] = p;
    }
    for (let i = 0; i < len; i++) { const t = (i + 1) / (len + 1); out[a + i] = fwd[i] * (1 - t) + bwd[i] * t; }
  }
  return { out, spans };
}

const HN = 1024, HH = 256;

function healOne(x: Float32Array, out: Float32Array, rate: number, box: HealBox): void {
  const n = x.length;
  const s0 = Math.max(0, Math.floor(box.t0 * rate) - 3 * HN), s1 = Math.min(n, Math.ceil(box.t1 * rate) + 3 * HN);
  const m = s1 - s0;
  if (m < HN) return;
  const L = m + 2 * HN, K = Math.floor((L - HN) / HH) + 1, bins = HN / 2 + 1;
  const pad = new Float32Array(L);
  pad.set(x.subarray(s0, s1), HN);
  const win = new Float32Array(HN);
  for (let i = 0; i < HN; i++) win[i] = Math.sin((Math.PI * (i + 0.5)) / HN);
  const re = new Float32Array(HN), im = new Float32Array(HN);
  const mag = new Float32Array(K * bins), ph = new Float32Array(K * bins);
  for (let k = 0; k < K; k++) {
    const o = k * HH;
    for (let i = 0; i < HN; i++) { re[i] = pad[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < bins; b++) { mag[k * bins + b] = Math.hypot(re[b], im[b]); ph[k * bins + b] = Math.atan2(im[b], re[b]); }
  }
  const bt0 = box.t0 * rate - s0 + HN, bt1 = box.t1 * rate - s0 + HN;
  const center = (k: number) => k * HH + HN / 2;
  let ka = -1, kb = -1;
  for (let k = 0; k < K; k++) {
    if (center(k) <= bt0 - HN) ka = k;
    if (kb < 0 && center(k) >= bt1 + HN) kb = k;
  }
  const avg = (k: number, b: number) => {
    let s = 0, c = 0;
    for (let q = Math.max(0, k - 1); q <= Math.min(K - 1, k + 1); q++) { s += mag[q * bins + b]; c++; }
    return s / c;
  };
  const binHz = rate / HN;
  const f0 = Math.max(0, Math.floor(box.f0 / binHz)), f1 = Math.min(bins - 1, Math.ceil(box.f1 / binHz));
  const edit: Array<[number, number, number]> = [];
  for (let k = 0; k < K; k++) {
    if (center(k) < bt0 - HH || center(k) > bt1 + HH) continue;
    const u = bt1 > bt0 ? Math.max(0, Math.min(1, (center(k) - bt0) / (bt1 - bt0))) : 0.5;
    for (let b = f0; b <= f1; b++) {
      const ra = ka >= 0 ? avg(ka, b) : kb >= 0 ? avg(kb, b) : mag[k * bins + b];
      const rb = kb >= 0 ? avg(kb, b) : ra;
      const ref = ra + (rb - ra) * u;
      const taper = Math.min(1, (b - f0 + 1) / 3, (f1 - b + 1) / 3);
      const cur = mag[k * bins + b];
      edit.push([k, b, cur + (Math.min(cur, ref) - cur) * taper]);
    }
  }
  for (const [k, b, v] of edit) mag[k * bins + b] = v;
  const rec = new Float32Array(L);
  for (let k = 0; k < K; k++) {
    const o = k * HH;
    for (let b = 0; b < bins; b++) {
      const v = mag[k * bins + b], p = ph[k * bins + b];
      re[b] = v * Math.cos(p); im[b] = -v * Math.sin(p);
      if (b > 0 && b < HN / 2) { re[HN - b] = re[b]; im[HN - b] = -im[b]; }
    }
    fft(re, im);
    for (let i = 0; i < HN; i++) rec[o + i] += (re[i] / HN) * win[i] * 0.5;
  }
  const w0 = Math.max(0, Math.floor(box.t0 * rate) - HN), w1 = Math.min(n, Math.ceil(box.t1 * rate) + HN);
  for (let i = w0; i < w1; i++) out[i] = rec[i - s0 + HN];
}

export function heal(x: Float32Array, rate: number, boxes: HealBox[]): Float32Array {
  const out = Float32Array.from(x);
  for (const b of boxes) healOne(out, out, rate, b);
  return out;
}

export function compressSoft(
  x: Float32Array, rate: number, thr: number, ratio: number, attMs: number, relMs: number, makeupDb: number,
): { out: Float32Array; gr: Float32Array; maxGr: number } {
  const n = x.length, knee = 6;
  const att = Math.exp(-1 / (rate * Math.max(0.1, attMs) * 0.001));
  const rel = Math.exp(-1 / (rate * Math.max(1, relMs) * 0.001));
  const out = new Float32Array(n);
  const GB = 441;
  const gr = new Float32Array(Math.ceil(n / GB));
  const slope = 1 / ratio - 1, mk = fromDb(makeupDb);
  let env = 0, maxGr = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(x[i]);
    env = v > env ? att * env + (1 - att) * v : rel * env + (1 - rel) * v;
    const over = (env > 1e-9 ? 20 * Math.log10(env) : -180) - thr;
    let g = 0;
    if (2 * over > knee) g = slope * over;
    else if (2 * over > -knee) { const q = over + knee / 2; g = (slope * q * q) / (2 * knee); }
    out[i] = x[i] * fromDb(g) * mk;
    const r = -g;
    const bi = (i / GB) | 0;
    if (r > gr[bi]) gr[bi] = r;
    if (r > maxGr) maxGr = r;
  }
  return { out, gr, maxGr };
}

export function limit(x: Float32Array, rate: number, ceilDb: number, relMs: number): { out: Float32Array; maxGr: number } {
  const n = x.length, ceil = fromDb(ceilDb), L = Math.max(2, Math.round(rate * 0.005));
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); g[i] = v > ceil ? ceil / v : 1; }
  const gm = new Float32Array(n), dq = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && g[dq[t - 1]] >= g[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + L) h++;
    gm[i] = g[dq[h]];
  }
  const rel = 1 - Math.exp(-1 / (rate * Math.max(5, relMs) * 0.001));
  const out = new Float32Array(n);
  let acc = 0, prev = 1, minG = 1;
  for (let i = 0; i < n; i++) {
    acc += gm[i];
    if (i >= L) acc -= gm[i - L];
    const avg = acc / Math.min(L, i + 1);
    let cur = Math.min(avg, prev + (1 - prev) * rel);
    if (cur > 1) cur = 1;
    prev = cur;
    if (cur < minG) minG = cur;
    out[i] = x[i] * cur;
  }
  return { out, maxGr: -toDb(minG) };
}

export function masterTo(x: Float32Array, rate: number, target: number, ceilDb: number): { out: Float32Array; lufs: number; gainDb: number; maxGr: number } {
  const l0 = loudness([x], rate);
  if (!isFinite(l0)) return { out: x, lufs: l0, gainDb: 0, maxGr: 0 };
  let g = target - l0, best = { out: x, lufs: l0, gainDb: 0, maxGr: 0 };
  for (let it = 0; it < 4; it++) {
    const k = fromDb(g);
    const y = new Float32Array(x.length);
    for (let i = 0; i < y.length; i++) y[i] = x[i] * k;
    const lim = limit(y, rate, ceilDb, 120);
    const l = loudness([lim.out], rate);
    best = { out: lim.out, lufs: l, gainDb: g, maxGr: lim.maxGr };
    if (Math.abs(l - target) < 0.1) break;
    g += target - l;
  }
  return best;
}

export function noiseFloor(x: Float32Array, rate: number, s = 0, e = x.length): number {
  const B = Math.max(1, Math.round(rate * 0.05)), levels: number[] = [];
  for (let a = s; a + B <= e; a += B) {
    let m = 0;
    for (let i = a; i < a + B; i++) m += x[i] * x[i];
    levels.push(m / B);
  }
  if (!levels.length) return -Infinity;
  levels.sort((p, q) => p - q);
  const v = levels[Math.floor(levels.length * 0.1)];
  return v > 1e-14 ? 10 * Math.log10(v) : -140;
}

let hannCache: Float32Array | null = null;

function hann(n: number): Float32Array {
  if (hannCache && hannCache.length === n) return hannCache;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  hannCache = w;
  return w;
}

function toneAmp(x: Float32Array, rate: number, f: number, s: number, e: number): number {
  const n = e - s, w = (2 * Math.PI * f) / rate, win = hann(n);
  const cr = Math.cos(w), ci = Math.sin(w);
  let pr = 1, pi = 0, sr = 0, si = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    const h = win[i];
    const v = x[s + i] * h;
    sr += v * pr; si -= v * pi; sw += h;
    const t = pr * cr - pi * ci;
    pi = pr * ci + pi * cr;
    pr = t;
  }
  return (2 * Math.hypot(sr, si)) / sw;
}

export function mainsOf(x: Float32Array, rate: number): 50 | 60 {
  const a50 = toneAmp(x, rate, 50, 0, x.length), a60 = toneAmp(x, rate, 60, 0, x.length);
  return a50 > a60 ? 50 : 60;
}

export function humLevel(x: Float32Array, rate: number, mains: number, s = 0, e = x.length): number {
  if (e - s < 4096) return -Infinity;
  let p = 0;
  for (let h = 1; h <= 4; h++) { const a = toneAmp(x, rate, mains * h, s, e); p += (a * a) / 2; }
  return p > 1e-18 ? 10 * Math.log10(p) : -150;
}

export function shortTermDb(x: Float32Array, rate: number): Float32Array {
  const hop = Math.round(rate * 0.1), win = Math.round(rate * 0.4);
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];
  const count = Math.max(1, Math.floor((x.length - win) / hop) + 1);
  const out = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const a = k * hop, e = Math.min(x.length, a + win);
    const v = (pre[e] - pre[a]) / Math.max(1, e - a);
    out[k] = v > 1e-14 ? 10 * Math.log10(v) : -140;
  }
  return out;
}
