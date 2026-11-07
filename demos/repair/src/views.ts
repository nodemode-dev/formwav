import { spectrogram, type Spectro } from "../../../demo/src/dsp";
import type { Bench } from "./bench";
import type { HealBox } from "./fx";
import type { AbPlayer } from "./player";

export type ViewMode = "compare" | "orig" | "rep";
export type Tool = "range" | "box";

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const AXIS_HZ = [100, 500, 1000, 2000, 4000, 8000, 16000];
const MONO = '11px "JetBrains Mono", monospace';
const UI = '11px Inter, system-ui, sans-serif';

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export function fmtClock(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000);
  const p = (v: number, n = 2) => String(v).padStart(n, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

interface Surface { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number }
interface SpecEntry { sp: Spectro; img: HTMLCanvasElement | null; pal: number }
interface Palette { lut: Uint8ClampedArray; text: string; muted: string; line: string; accent: string; ghost: string; red: string; rep: string; ruler: string }

function parseColor(g: CanvasRenderingContext2D, css: string): [number, number, number] {
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = "#000";
  g.fillStyle = css;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function fmtHz(f: number): string {
  return f >= 1000 ? `${f / 1000}k` : String(f);
}

export class Views {
  view: ViewMode = "compare";
  tool: Tool = "range";
  sel: [number, number] | null = null;
  box: HealBox | null = null;
  onSeek: (t: number) => void = () => {};
  onSel: () => void = () => {};
  onBox: () => void = () => {};
  private surf = new Map<HTMLCanvasElement, Surface>();
  private scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  private pal: Palette | null = null;
  private palId = 0;
  private specs = new WeakMap<Float32Array, SpecEntry>();
  private dirty = true;
  private boxKey = "";
  private ruler: Surface | null = null;
  private wave: Surface | null = null;
  private panes: Record<"orig" | "rep", { el: HTMLElement; axis: HTMLCanvasElement; plot: HTMLCanvasElement; boxes: HTMLElement; chip: HTMLElement }>;
  private overlay: HTMLElement;
  private selEl: HTMLElement;
  private headEl: HTMLElement;
  private overlayW = 0;
  private chipWave: HTMLElement;
  private loading: HTMLElement;
  private drag: { kind: "seek" | "range" | "box"; pane: "orig" | "rep" | "wave" | "ruler"; x0: number; y0: number; moved: boolean; rect: DOMRect } | null = null;

  constructor(private stage: HTMLElement, private bench: Bench, private player: AbPlayer) {
    const q = <T extends HTMLElement>(s: string) => stage.querySelector(s) as T;
    const mk = (id: "orig" | "rep") => {
      const el = q<HTMLElement>(`#rp-pane-${id}`);
      return { el, axis: el.querySelector("[data-axis]") as HTMLCanvasElement, plot: el.querySelector("[data-plot]") as HTMLCanvasElement, boxes: el.querySelector("[data-boxes]") as HTMLElement, chip: el.querySelector("[data-chip-val]") as HTMLElement };
    };
    this.panes = { orig: mk("orig"), rep: mk("rep") };
    this.overlay = q("#rp-overlay");
    this.selEl = q("#rp-sel");
    this.headEl = q("#rp-playhead");
    this.chipWave = q("#rp-wave-chip");
    this.loading = q("#rp-loading");
    const watch = (c: HTMLCanvasElement): Surface => {
      const s: Surface = { canvas: c, g: c.getContext("2d")!, w: 0, h: 0 };
      this.surf.set(c, s);
      return s;
    };
    this.ruler = watch(q<HTMLCanvasElement>("#rp-ruler-canvas"));
    this.wave = watch(q<HTMLCanvasElement>("#rp-wave-canvas"));
    for (const k of ["orig", "rep"] as const) { watch(this.panes[k].axis); watch(this.panes[k].plot); }
    const ro = new ResizeObserver(() => this.measure());
    for (const s of this.surf.values()) ro.observe(s.canvas.parentElement!);
    ro.observe(this.overlay);
    const reset = () => { this.pal = null; this.specs = new WeakMap(); this.dirty = true; };
    new MutationObserver(reset).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    new MutationObserver(reset).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.bindPointer();
  }

  setView(v: ViewMode): void {
    this.view = v;
    this.stage.dataset.view = v;
    this.dirty = true;
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.stage.dataset.tool = t;
  }

  setLoading(on: boolean): void {
    this.loading.hidden = !on;
  }

  setChip(which: "orig" | "rep", text: string): void {
    if (this.panes[which].chip.textContent !== text) this.panes[which].chip.textContent = text;
  }

  invalidate(): void {
    this.dirty = true;
  }

  clearSel(): void {
    this.sel = null;
    this.onSel();
  }

  clearBox(): void {
    this.box = null;
    this.onBox();
  }

  measure(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const s of this.surf.values()) {
      const p = s.canvas.parentElement!;
      const w = p.clientWidth, h = p.clientHeight;
      if (!w || !h) continue;
      if (w !== s.w || h !== s.h) {
        s.w = w; s.h = h;
        s.canvas.width = Math.round(w * dpr);
        s.canvas.height = Math.round(h * dpr);
        this.dirty = true;
      }
    }
    this.overlayW = this.overlay.clientWidth;
  }

  private palette(): Palette {
    if (this.pal) return this.pal;
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    const accent = parseColor(this.scratch, v("--accent-color"));
    const bg = parseColor(this.scratch, v("--bg-primary"));
    const hi = parseColor(this.scratch, v("--text-primary"));
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const [a, b, k] = t < 0.6 ? [bg, accent, t / 0.6] : [accent, hi, (t - 0.6) / 0.4];
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c] + (b[c] - a[c]) * k;
    }
    this.palId++;
    this.pal = { lut, text: v("--text-primary"), muted: v("--text-muted"), line: v("--line-1"), accent: v("--accent-color"), ghost: v("--text-muted"), red: v("--fw-color-red"), rep: v("--fw-color-cyan"), ruler: v("--text-secondary") };
    return this.pal;
  }

  private spec(x: Float32Array, p: Palette): SpecEntry {
    let e = this.specs.get(x);
    if (!e) { e = { sp: spectrogram([x], this.bench.rate), img: null, pal: 0 }; this.specs.set(x, e); }
    if (!e.img || e.pal !== this.palId) {
      const { frames, rows, data } = e.sp;
      const c = e.img ?? document.createElement("canvas");
      c.width = frames; c.height = rows;
      const cg = c.getContext("2d")!;
      const im = cg.createImageData(frames, rows);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        im.data[i * 4] = p.lut[v * 3]; im.data[i * 4 + 1] = p.lut[v * 3 + 1]; im.data[i * 4 + 2] = p.lut[v * 3 + 2]; im.data[i * 4 + 3] = 255;
      }
      cg.putImageData(im, 0, 0);
      e.img = c; e.pal = this.palId;
    }
    return e;
  }

  private fMax(): number { return (511 * this.bench.rate) / 1024; }
  private yOf(f: number, h: number): number { return h * (1 - Math.sqrt(Math.max(0, f) / this.fMax())); }
  private fOf(yf: number): number { const t = 1 - Math.max(0, Math.min(1, yf)); return this.fMax() * t * t; }

  private setup(s: Surface): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    s.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.g.clearRect(0, 0, s.w, s.h);
    return s.g;
  }

  private drawPane(which: "orig" | "rep", x: Float32Array, p: Palette): void {
    const pane = this.panes[which];
    if (pane.el.offsetParent === null) return;
    const plot = this.surf.get(pane.plot)!, axis = this.surf.get(pane.axis)!;
    if (!plot.w || !axis.w) return;
    const g = this.setup(plot);
    const e = this.spec(x, p);
    g.imageSmoothingEnabled = true;
    g.drawImage(e.img!, 0, 0, e.sp.frames, e.sp.rows, 0, 0, plot.w, plot.h);
    g.fillStyle = "rgba(255,255,255,0.07)";
    for (const f of AXIS_HZ) g.fillRect(0, Math.round(this.yOf(f, plot.h)), plot.w, 1);
    const a = this.setup(axis);
    a.font = MONO;
    a.fillStyle = p.muted;
    a.textAlign = "right";
    a.textBaseline = "middle";
    for (const f of AXIS_HZ) a.fillText(fmtHz(f), axis.w - 6, Math.max(7, Math.min(axis.h - 7, this.yOf(f, axis.h))));
  }

  private drawRuler(p: Palette): void {
    const s = this.ruler!;
    if (!s.w) return;
    const g = this.setup(s);
    const dur = this.bench.duration;
    const pps = s.w / dur;
    let step = STEPS[STEPS.length - 1];
    for (const st of STEPS) if (st * pps >= 64) { step = st; break; }
    g.font = MONO;
    g.textBaseline = "middle";
    g.textAlign = "left";
    for (let t = 0; t <= dur + 1e-6; t += step) {
      const x = Math.round(t * pps) + 0.5;
      g.fillStyle = p.line;
      g.fillRect(x, s.h - 8, 1, 8);
      g.fillStyle = p.ruler;
      const lab = t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : `${+t.toFixed(1)}s`;
      g.fillText(lab, x + 4, s.h / 2 - 2);
    }
  }

  private drawWave(p: Palette): void {
    const s = this.wave!;
    if (!s.w) return;
    const g = this.setup(s);
    const o = this.bench.orig, r = this.bench.result?.out ?? o;
    const mid = s.h / 2, amp = s.h / 2 - 5;
    g.fillStyle = p.line;
    g.fillRect(0, Math.round(mid), s.w, 1);
    const cols = Math.floor(s.w), per = o.length / cols;
    const paint = (x: Float32Array, color: string, alpha: number) => {
      g.fillStyle = color;
      g.globalAlpha = alpha;
      for (let c = 0; c < cols; c++) {
        const a = Math.floor(c * per), b = Math.max(a + 1, Math.floor((c + 1) * per));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < b && i < x.length; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (lo > hi) continue;
        const yt = mid - Math.min(1, hi) * amp, yb = mid - Math.max(-1, lo) * amp;
        g.fillRect(c, yt, 1, Math.max(1, yb - yt));
      }
      g.globalAlpha = 1;
    };
    paint(o, p.ghost, 0.55);
    paint(r, p.accent, 0.9);
    const spans = this.bench.result?.extras.declick?.spans;
    if (spans && this.bench.chain.declick.on) {
      g.fillStyle = p.red;
      let last = -2;
      for (const sp of spans) {
        const x = Math.floor((sp.a / o.length) * s.w);
        if (x === last) continue;
        last = x;
        g.fillRect(x, 0, 1, 7);
      }
    }
  }

  private syncBoxes(): void {
    const key = JSON.stringify([this.bench.chain.heal.boxes, this.box, this.bench.currentId]);
    if (key === this.boxKey) return;
    this.boxKey = key;
    const dur = this.bench.duration;
    const place = (el: HTMLElement, b: HealBox, cls: string) => {
      const d = document.createElement("div");
      d.className = `rp-box ${cls}`;
      d.style.insetInlineStart = `${(b.t0 / dur) * 100}%`;
      d.style.inlineSize = `${((b.t1 - b.t0) / dur) * 100}%`;
      d.style.insetBlockStart = `${this.yOf(b.f1, 1) * 100}%`;
      d.style.blockSize = `${(this.yOf(b.f0, 1) - this.yOf(b.f1, 1)) * 100}%`;
      el.append(d);
    };
    for (const k of ["orig", "rep"] as const) {
      const host = this.panes[k].boxes;
      host.replaceChildren();
      for (const b of this.bench.chain.heal.boxes) place(host, b, "is-applied");
      if (this.box) place(host, this.box, "is-pending");
    }
  }

  frame(): void {
    const p = this.palette();
    if (this.overlayW === 0) this.measure();
    if (this.dirty && this.bench.currentId && this.bench.source.x) {
      this.dirty = false;
      this.drawRuler(p);
      this.drawPane("orig", this.bench.orig, p);
      this.drawPane("rep", this.bench.result?.out ?? this.bench.orig, p);
      this.drawWave(p);
    }
    if (this.bench.currentId && this.bench.source.x) {
      this.syncBoxes();
      const dur = this.bench.duration, w = this.overlayW;
      this.headEl.style.transform = `translateX(${Math.round((this.player.position / dur) * w)}px)`;
      const sel = this.sel;
      if (sel && sel[1] > sel[0]) {
        this.selEl.style.display = "block";
        this.selEl.style.transform = `translateX(${(sel[0] / dur) * w}px)`;
        this.selEl.style.inlineSize = `${((sel[1] - sel[0]) / dur) * w}px`;
      } else this.selEl.style.display = "none";
      const spans = this.bench.result?.extras.declick?.spans;
      const txt = spans && this.bench.chain.declick.on ? `${spans.length} clicks repaired (marked in red)` : "";
      if (this.chipWave.textContent !== txt) this.chipWave.textContent = txt;
    }
  }

  private bindPointer(): void {
    const stage = this.stage;
    const target = (e: PointerEvent): { pane: "orig" | "rep" | "wave" | "ruler"; rect: DOMRect } | null => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".rp-plot");
      if (!el) return null;
      const pane = el.closest<HTMLElement>("[data-pane]")?.dataset.pane as "orig" | "rep" | undefined;
      const kind = pane ?? (el.id === "rp-wave" ? "wave" : el.id === "rp-ruler" ? "ruler" : null);
      return kind ? { pane: kind, rect: el.getBoundingClientRect() } : null;
    };
    const timeAt = (x: number, rect: DOMRect) => Math.max(0, Math.min(this.bench.duration, ((x - rect.left) / rect.width) * this.bench.duration));
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.bench.currentId || !this.bench.source.x) return;
      const t = target(e);
      if (!t) return;
      stage.setPointerCapture(e.pointerId);
      const kind = t.pane === "ruler" ? "seek" : this.tool === "box" && (t.pane === "orig" || t.pane === "rep") ? "box" : "range";
      this.drag = { kind, pane: t.pane, x0: e.clientX, y0: e.clientY, moved: false, rect: t.rect };
      if (t.pane === "ruler") this.onSeek(timeAt(e.clientX, t.rect));
    });
    stage.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
      d.moved = true;
      const a = timeAt(d.x0, d.rect), b = timeAt(e.clientX, d.rect);
      if (d.kind === "seek") { this.onSeek(b); return; }
      if (d.kind === "range") { this.sel = [Math.min(a, b), Math.max(a, b)]; this.onSel(); return; }
      const ya = Math.max(0, Math.min(1, (d.y0 - d.rect.top) / d.rect.height)), yb = Math.max(0, Math.min(1, (e.clientY - d.rect.top) / d.rect.height));
      const fa = this.fOf(ya), fb = this.fOf(yb);
      this.box = { t0: Math.min(a, b), t1: Math.max(a, b), f0: Math.min(fa, fb), f1: Math.max(fa, fb) };
      this.onBox();
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      if (!d.moved && d.kind !== "seek") {
        this.onSeek(timeAt(e.clientX, d.rect));
        if (d.kind === "range" && this.sel) this.clearSel();
      }
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("dblclick", (e) => {
      if (!(e.target as HTMLElement).closest(".rp-plot") || this.tool !== "range") return;
      this.sel = [0, this.bench.duration];
      this.onSel();
    });
  }
}
