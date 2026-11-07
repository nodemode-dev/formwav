import { averageSpectrum } from "../../../demo/src/dsp";
import type { Bench, Measures } from "./bench";
import { responseDb, shortTermDb } from "./fx";
import { eqStages } from "./stages";
import { fmtHz } from "./views";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setText(el: HTMLElement, v: string): void {
  if (el.textContent !== v) el.textContent = v;
}

const f1 = (v: number, unit = ""): string => (isFinite(v) ? `${v.toFixed(1)}${unit}` : "-");
const sign = (v: number): string => (v > 0.04 ? `+${v.toFixed(1)}` : v < -0.04 ? v.toFixed(1) : "0.0");

interface Canvas { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number }

export class Panels {
  tab = "measure";
  range: (() => [number, number] | null) = () => null;
  private spec: Canvas;
  private dyn: Canvas;
  private avg = new WeakMap<Float32Array, Float32Array>();
  private levels = new WeakMap<Float32Array, Float32Array>();
  private measureDirty = true;
  private measureTimer = 0;
  private drawDirty = true;
  private histKey = "";

  constructor(private bench: Bench) {
    const mk = (id: string): Canvas => {
      const canvas = $<HTMLCanvasElement>(id);
      return { canvas, g: canvas.getContext("2d")!, w: 0, h: 0 };
    };
    this.spec = mk("rp-spec-canvas");
    this.dyn = mk("rp-dyn-canvas");
    const ro = new ResizeObserver(() => this.size());
    ro.observe(this.spec.canvas.parentElement!);
    ro.observe(this.dyn.canvas.parentElement!);
    for (const b of document.querySelectorAll<HTMLElement>("[data-btab]")) b.addEventListener("click", () => this.setTab(b.dataset.btab!));
    $("dm-history").addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (li) this.bench.jump(Number(li.dataset.i));
    });
    new MutationObserver(() => { this.drawDirty = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  }

  setTab(name: string): void {
    this.tab = name;
    for (const b of document.querySelectorAll<HTMLElement>("[data-btab]")) {
      const on = b.dataset.btab === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const p of document.querySelectorAll<HTMLElement>("[data-bpanel]")) p.hidden = p.dataset.bpanel !== name;
    this.size();
    this.drawDirty = true;
  }

  invalidate(): void {
    this.drawDirty = true;
    this.measureDirty = true;
  }

  rangeChanged(): void {
    window.clearTimeout(this.measureTimer);
    this.measureTimer = window.setTimeout(() => { this.measureDirty = true; }, 140);
  }

  private size(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.spec, this.dyn]) {
      const p = c.canvas.parentElement!;
      const w = p.clientWidth, h = p.clientHeight;
      if (!w || !h) continue;
      if (w !== c.w || h !== c.h) {
        c.w = w; c.h = h;
        c.canvas.width = Math.round(w * dpr);
        c.canvas.height = Math.round(h * dpr);
        this.drawDirty = true;
      }
    }
  }

  private colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return { text: v("--text-primary"), sec: v("--text-secondary"), muted: v("--text-muted"), line: v("--line-1"), accent: v("--accent-color"), cyan: v("--fw-color-cyan"), red: v("--fw-color-red"), amber: v("--fw-color-amber") };
  }

  private setup(c: Canvas): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    c.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.g.clearRect(0, 0, c.w, c.h);
    return c.g;
  }

  frame(): void {
    if (!this.bench.currentId || !this.bench.source.x || !this.bench.result) return;
    if (this.tab === "measure" && this.measureDirty) { this.measureDirty = false; this.drawMeasure(); }
    if (this.drawDirty) {
      if (this.tab === "spectrum") { this.drawDirty = false; this.drawSpectrum(); }
      else if (this.tab === "dynamics") { this.drawDirty = false; this.drawDynamics(); }
    }
    if (this.tab === "history") this.drawHistory();
  }

  measures(): { o: Measures; r: Measures } {
    const rng = this.range();
    return { o: this.bench.measure(this.bench.orig, rng), r: this.bench.measure(this.bench.result!.out, rng) };
  }

  private drawMeasure(): void {
    const { o, r } = this.measures();
    const rng = this.range();
    setText($("rp-scope"), rng ? `Range ${rng[0].toFixed(2)} to ${rng[1].toFixed(2)} s` : "Whole recording");
    const row = (k: string, a: string, b: string, d: string, good: boolean) => {
      setText($(`m-${k}-o`), a);
      setText($(`m-${k}-r`), b);
      const cell = $(`m-${k}-d`);
      setText(cell, d);
      cell.classList.toggle("is-good", good);
    };
    row("lufs", f1(o.lufs, " LUFS"), f1(r.lufs, " LUFS"), `${sign(r.lufs - o.lufs)} dB`, false);
    row("peak", f1(o.peak, " dBFS"), f1(r.peak, " dBFS"), `${sign(r.peak - o.peak)} dB`, false);
    row("rms", f1(o.rms, " dBFS"), f1(r.rms, " dBFS"), `${sign(r.rms - o.rms)} dB`, false);
    const fo = o.lufs - o.floor, fr = r.lufs - r.floor;
    row("floor", f1(fo, " dB"), f1(fr, " dB"), `${sign(fr - fo)} dB`, fr - fo > 1);
    const ho = o.lufs - o.hum, hr = r.lufs - r.hum;
    row("hum", f1(ho, " dB"), f1(hr, " dB"), `${sign(hr - ho)} dB`, hr - ho > 3);
    const dc = this.bench.chain.declick.on;
    row("clicks", String(o.clicks), dc ? String(r.clicks) : "De-click off", dc ? `${r.clicks - o.clicks > 0 ? "+" : ""}${r.clicks - o.clicks}` : "-", dc && r.clicks < o.clicks);
    const plo = o.peak - o.lufs, plr = r.peak - r.lufs;
    row("plr", f1(plo, " dB"), f1(plr, " dB"), `${sign(plr - plo)} dB`, false);
  }

  private avgOf(x: Float32Array): Float32Array {
    let a = this.avg.get(x);
    if (!a) { a = averageSpectrum([x], 0, x.length, 2048); this.avg.set(x, a); }
    return a;
  }

  private drawSpectrum(): void {
    const c = this.spec;
    if (!c.w) return;
    const g = this.setup(c), col = this.colors(), rate = this.bench.rate;
    const L = 52, R = 14, T = 26, B = 22, W = c.w - L - R, H = c.h - T - B;
    const fMin = 30, fMax = 20000, dbMin = -120, dbMax = -30;
    const xOf = (f: number) => L + (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;
    const yOf = (db: number) => T + (1 - (db - dbMin) / (dbMax - dbMin)) * H;
    g.font = '11px "JetBrains Mono", monospace';
    g.textBaseline = "middle";
    g.fillStyle = col.muted;
    g.strokeStyle = col.line;
    g.lineWidth = 1;
    g.textAlign = "right";
    for (let db = dbMin; db <= dbMax; db += 15) { const y = Math.round(yOf(db)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke(); g.fillText(String(db), L - 6, y); }
    g.textAlign = "center";
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { const x = Math.round(xOf(f)) + 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + H); g.stroke(); g.fillText(f >= 1000 ? `${fmtHz(f)}` : String(f), x, c.h - B / 2 + 2); }
    const curve = (x: Float32Array, color: string, width: number, fill: boolean) => {
      const a = this.avgOf(x), binHz = rate / 4096;
      g.beginPath();
      const cols = Math.floor(W);
      for (let i = 0; i <= cols; i++) {
        const f = fMin * Math.pow(fMax / fMin, i / cols);
        const lo = Math.max(1, Math.floor((f / 1.04) / binHz)), hi = Math.min(a.length - 1, Math.max(lo, Math.ceil((f * 1.04) / binHz)));
        let s = 0;
        for (let k = lo; k <= hi; k++) s += a[k];
        const db = 20 * Math.log10(s / (hi - lo + 1) + 1e-9);
        const y = Math.max(T, Math.min(T + H, yOf(db)));
        if (i === 0) g.moveTo(L, y); else g.lineTo(L + i, y);
      }
      if (fill) { g.lineTo(L + cols, T + H); g.lineTo(L, T + H); g.closePath(); g.globalAlpha = 0.14; g.fillStyle = color; g.fill(); g.globalAlpha = 1; g.beginPath(); }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    };
    const orig = this.bench.orig, rep = this.bench.result!.out;
    curve(orig, col.muted, 1.5, false);
    curve(rep, col.accent, 2, true);
    if (this.bench.chain.eq.on) {
      const st = eqStages(this.bench.chain.eq.p, rate);
      g.beginPath();
      const cols = Math.floor(W);
      for (let i = 0; i <= cols; i++) {
        const f = fMin * Math.pow(fMax / fMin, i / cols);
        const d = Math.max(-24, Math.min(24, responseDb(st, f, rate)));
        const y = T + H * 0.5 - (d / 24) * H * 0.22;
        if (i === 0) g.moveTo(L, y); else g.lineTo(L + i, y);
      }
      g.setLineDash([5, 4]);
      g.strokeStyle = col.cyan;
      g.lineWidth = 1.5;
      g.stroke();
      g.setLineDash([]);
    }
    g.textAlign = "left";
    g.font = '12px Inter, system-ui, sans-serif';
    let x = L;
    for (const [txt, color] of [["Original", col.muted], ["Repaired", col.accent], ["EQ curve, 24 dB across the dashed band", col.cyan]] as const) {
      if (txt.startsWith("EQ") && !this.bench.chain.eq.on) continue;
      g.fillStyle = color;
      g.fillRect(x, 8, 14, 3);
      g.fillStyle = col.sec;
      g.fillText(txt, x + 20, 10);
      x += 20 + g.measureText(txt).width + 22;
    }
  }

  private levelsOf(x: Float32Array): Float32Array {
    let a = this.levels.get(x);
    if (!a) { a = shortTermDb(x, this.bench.rate); this.levels.set(x, a); }
    return a;
  }

  private drawDynamics(): void {
    const c = this.dyn;
    if (!c.w) return;
    const g = this.setup(c), col = this.colors();
    const L = 52, R = 14, T = 26, B = 8, W = c.w - L - R;
    const topH = Math.round((c.h - T - B) * 0.64), gap = 22, botH = c.h - T - B - topH - gap;
    const dur = this.bench.duration;
    const dbMin = -60, dbMax = 0;
    const yOf = (db: number) => T + (1 - (Math.max(dbMin, Math.min(dbMax, db)) - dbMin) / (dbMax - dbMin)) * topH;
    g.font = '11px "JetBrains Mono", monospace';
    g.textBaseline = "middle";
    g.textAlign = "right";
    g.strokeStyle = col.line;
    g.fillStyle = col.muted;
    g.lineWidth = 1;
    for (let db = dbMin; db <= dbMax; db += 15) { const y = Math.round(yOf(db)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke(); g.fillText(String(db), L - 6, y); }
    const line = (x: Float32Array, color: string, width: number) => {
      const a = this.levelsOf(x);
      g.beginPath();
      for (let i = 0; i < a.length; i++) {
        const px = L + ((i * 0.1 + 0.2) / dur) * W, py = yOf(a[i]);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    };
    line(this.bench.orig, col.muted, 1.5);
    line(this.bench.result!.out, col.accent, 2);
    const master = this.bench.chain.master;
    if (master.on) {
      const y = Math.round(yOf(master.p.target)) + 0.5;
      g.setLineDash([5, 4]);
      g.strokeStyle = col.amber;
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke();
      g.setLineDash([]);
    }
    g.font = '12px Inter, system-ui, sans-serif';
    g.textAlign = "left";
    let x = L;
    const items: Array<[string, string]> = [["Original, RMS over 400 ms", col.muted], ["Repaired", col.accent]];
    if (master.on) items.push([`${master.p.target} LUFS target`, col.amber]);
    for (const [txt, color] of items) {
      g.fillStyle = color; g.fillRect(x, 8, 14, 3);
      g.fillStyle = col.sec; g.fillText(txt, x + 20, 10);
      x += 20 + g.measureText(txt).width + 22;
    }
    const y0 = T + topH + gap;
    g.fillStyle = col.sec;
    g.textAlign = "right";
    g.font = '11px "JetBrains Mono", monospace';
    g.fillText("0", L - 6, y0 + 4);
    g.fillText("12 dB", L - 6, y0 + botH - 4);
    g.strokeStyle = col.line;
    g.strokeRect(L + 0.5, y0 + 0.5, W - 1, botH - 1);
    const gr = this.bench.result!.extras.comp?.gr;
    if (gr && this.bench.chain.comp.on) {
      g.fillStyle = col.cyan;
      g.globalAlpha = 0.85;
      const bw = Math.max(1, W / gr.length);
      for (let i = 0; i < gr.length; i++) {
        const h = Math.min(botH, (gr[i] / 12) * botH);
        if (h > 0.5) g.fillRect(L + (i / gr.length) * W, y0, bw + 0.5, h);
      }
      g.globalAlpha = 1;
    }
    g.textAlign = "left";
    g.font = '12px Inter, system-ui, sans-serif';
    g.fillStyle = col.sec;
    g.fillText(gr && this.bench.chain.comp.on ? "Compressor gain reduction" : "Compressor bypassed", L + 8, y0 + botH - 12);
  }

  private drawHistory(): void {
    const key = `${this.bench.index}|${this.bench.history.length}`;
    if (key === this.histKey) return;
    this.histKey = key;
    const host = $("dm-history");
    const items = this.bench.history;
    while (host.children.length > items.length) host.lastElementChild!.remove();
    items.forEach((h, i) => {
      let li = host.children[i] as HTMLElement | undefined;
      if (!li) {
        li = document.createElement("li");
        li.dataset.i = String(i);
        const b = document.createElement("button");
        b.type = "button";
        li.append(b);
        host.append(li);
      }
      li.className = `dm-hist${i === this.bench.index ? " is-current" : i > this.bench.index ? " is-future" : ""}`;
      const b = li.firstElementChild as HTMLElement;
      if (b.textContent !== h.label) b.textContent = h.label;
    });
  }
}
