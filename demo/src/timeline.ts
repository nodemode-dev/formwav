import { mountIcons } from "./icons";
import { buildPeaks, type PeakPyramid, spectrogram, type Spectro } from "./dsp";
import type { Player } from "./player";
import type { Store, Track } from "./state";

const TRACK_H = 80;
const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export function fmtClock(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000);
  const p = (v: number, n = 2) => String(v).padStart(n, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

interface Row {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  meta: HTMLElement;
  name: HTMLElement;
  mute: HTMLButtonElement;
  solo: HTMLButtonElement;
  spec: HTMLButtonElement;
  gain: HTMLInputElement;
  num: HTMLElement;
}

interface Palette { track: Record<string, [number, number, number]>; muted: string; line: string; ruler: string; text: string; lut: Uint8ClampedArray }

function parseColor(g: CanvasRenderingContext2D, css: string): [number, number, number] {
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = "#000";
  g.fillStyle = css;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export class Timeline {
  pps = 80;
  t0 = 0;
  follow = true;
  private rows = new Map<number, Row>();
  private tracksEl: HTMLElement;
  private overlay: HTMLElement;
  private selEl: HTMLElement;
  private headEl: HTMLElement;
  private ruler: HTMLCanvasElement;
  private rg: CanvasRenderingContext2D;
  private rw = 0;
  private rh = 0;
  private laneW = 0;
  private dirty = true;
  private peaks = new WeakMap<object, PeakPyramid>();
  private specs = new WeakMap<object, { data: Spectro; img: HTMLCanvasElement | null }>();
  private palette: Palette | null = null;
  private probe: HTMLElement;
  private scratch: CanvasRenderingContext2D;
  private drag: { anchor: number; x0: number; moved: boolean; lane: boolean } | null = null;
  onSeek: (t: number) => void = () => {};
  onTrackAction: (id: number, what: string, value?: number) => void = () => {};

  constructor(private root: HTMLElement, private store: Store, private player: Player) {
    this.tracksEl = root.querySelector("#dm-tracks")!;
    this.overlay = root.querySelector("#dm-overlay")!;
    this.selEl = root.querySelector("#dm-sel")!;
    this.headEl = root.querySelector("#dm-playhead")!;
    this.ruler = root.querySelector("#dm-ruler-canvas")!;
    this.rg = this.ruler.getContext("2d")!;
    this.probe = document.createElement("span");
    this.probe.style.display = "none";
    document.body.append(this.probe);
    const sc = document.createElement("canvas");
    sc.width = sc.height = 1;
    this.scratch = sc.getContext("2d", { willReadFrequently: true })!;

    new ResizeObserver(() => this.measure()).observe(root);
    new MutationObserver(() => { this.palette = null; this.specs = new WeakMap(); this.dirty = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    new MutationObserver(() => { this.palette = null; this.specs = new WeakMap(); this.dirty = true; }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    root.addEventListener("pointerdown", (e) => this.down(e));
    root.addEventListener("pointermove", (e) => this.move(e));
    root.addEventListener("pointerup", (e) => this.up(e));
    root.addEventListener("pointercancel", (e) => this.up(e));
    root.addEventListener("dblclick", (e) => this.dbl(e));
    root.addEventListener("wheel", (e) => this.wheel(e), { passive: false });

    store.on("tracks", () => { this.sync(); this.dirty = true; });
    store.on("selection", () => { this.markSelected(); this.updateSel(); });
    this.measure();
  }

  private color(cssVar: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  }

  private pal(): Palette {
    if (this.palette) return this.palette;
    const track: Record<string, [number, number, number]> = {};
    for (const v of ["--fw-color-cyan", "--fw-color-violet", "--fw-color-green", "--fw-color-amber", "--fw-color-blue", "--fw-color-pink", "--fw-color-red", "--fw-color-slate"]) track[v] = parseColor(this.scratch, this.color(v));
    const accent = parseColor(this.scratch, this.color("--accent-color"));
    const bg = parseColor(this.scratch, this.color("--bg-primary"));
    const hi = parseColor(this.scratch, this.color("--text-primary"));
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const [a, b, k] = t < 0.55 ? [bg, accent, t / 0.55] : [accent, hi, (t - 0.55) / 0.45];
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c] + (b[c] - a[c]) * k;
    }
    this.palette = { track, muted: this.color("--text-muted"), line: this.color("--line-1"), ruler: this.color("--text-secondary"), text: this.color("--text-primary"), lut };
    return this.palette;
  }

  private rgba(c: [number, number, number], a: number): string {
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  measure(): void {
    const rr = this.ruler.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rr.width)), h = Math.max(1, Math.round(rr.height));
    this.laneW = w;
    if (w !== this.rw || h !== this.rh) {
      this.rw = w; this.rh = h;
      this.ruler.width = Math.round(w * dpr);
      this.ruler.height = Math.round(h * dpr);
    }
    for (const r of this.rows.values()) this.sizeRow(r);
    this.dirty = true;
  }

  private sizeRow(r: Row): void {
    const dpr = window.devicePixelRatio || 1;
    const lane = r.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.round(lane.width)), h = Math.max(1, Math.round(lane.height));
    if (w !== r.w || h !== r.h) {
      r.w = w; r.h = h;
      r.canvas.width = Math.round(w * dpr);
      r.canvas.height = Math.round(h * dpr);
    }
  }

  private makeRow(t: Track): Row {
    const el = document.createElement("div");
    el.className = "dm-track";
    el.dataset.id = String(t.id);
    el.style.blockSize = `${TRACK_H}px`;
    el.innerHTML = `<div class="dm-th"><div class="dm-th-top"><span class="dm-th-num"></span><span class="dm-th-chip"></span><span class="dm-th-name" translate="no"></span><button class="dm-th-x" type="button" data-act="remove" title="Remove this track" aria-label="Remove track"><span class="icon" data-icon="close" data-size="12"></span></button></div><div class="dm-th-meta"></div><div class="dm-th-ctl"><button class="dm-ms" type="button" data-act="mute" title="Mute" aria-pressed="false">M</button><button class="dm-ms" type="button" data-act="solo" title="Solo" aria-pressed="false">S</button><button class="dm-ms dm-ms-wide" type="button" data-act="spec" title="Show the spectrogram" aria-pressed="false">Spec</button><input class="dm-th-gain" type="range" min="-24" max="12" step="0.5" value="0" data-act="gain" aria-label="Track gain" title="Track gain"></div></div><div class="dm-lane"><canvas></canvas></div>`;
    const canvas = el.querySelector("canvas")!;
    const row: Row = {
      el, canvas, g: canvas.getContext("2d")!, w: 0, h: 0,
      meta: el.querySelector(".dm-th-meta")!, name: el.querySelector(".dm-th-name")!, num: el.querySelector(".dm-th-num")!,
      mute: el.querySelector('[data-act="mute"]')!, solo: el.querySelector('[data-act="solo"]')!, spec: el.querySelector('[data-act="spec"]')!,
      gain: el.querySelector('[data-act="gain"]')!,
    };
    mountIcons(el);
    el.querySelector(".dm-th")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      this.store.selectTrack(t.id);
      if (b && b.dataset.act !== "gain") this.onTrackAction(t.id, b.dataset.act!);
    });
    row.gain.addEventListener("input", () => this.onTrackAction(t.id, "gain", Number(row.gain.value)));
    this.tracksEl.append(el);
    return row;
  }

  sync(): void {
    const ids = new Set(this.store.tracks.map((t) => t.id));
    for (const [id, r] of this.rows) if (!ids.has(id)) { r.el.remove(); this.rows.delete(id); }
    let i = 0;
    for (const t of this.store.tracks) {
      let r = this.rows.get(t.id);
      if (!r) { r = this.makeRow(t); this.rows.set(t.id, r); }
      i++;
      const css = `var(${t.color})`;
      if (r.el.style.getPropertyValue("--dm-track") !== css) r.el.style.setProperty("--dm-track", css);
      const num = String(i).padStart(2, "0");
      if (r.num.textContent !== num) r.num.textContent = num;
      if (r.name.textContent !== t.name) r.name.textContent = t.name;
      const meta = `${t.chans.length > 1 ? "Stereo" : "Mono"} · ${(t.chans[0].length / this.store.rate).toFixed(2)} s`;
      if (r.meta.textContent !== meta) r.meta.textContent = meta;
      r.mute.setAttribute("aria-pressed", String(t.mute));
      r.solo.setAttribute("aria-pressed", String(t.solo));
      r.spec.setAttribute("aria-pressed", String(t.spec));
      if (Number(r.gain.value) !== t.gain) r.gain.value = String(t.gain);
      this.sizeRow(r);
    }
    (this.root.querySelector("#dm-empty") as HTMLElement).hidden = this.store.tracks.length > 0;
    this.markSelected();
  }

  private markSelected(): void {
    for (const [id, r] of this.rows) r.el.classList.toggle("is-selected", id === this.store.selected);
  }

  fit(): void {
    const d = Math.max(0.5, this.store.duration());
    this.pps = Math.max(1, (this.laneW - 16) / d);
    this.t0 = 0;
    this.dirty = true;
  }

  zoom(f: number, anchorX = this.laneW / 2): void {
    const at = this.t0 + anchorX / this.pps;
    this.pps = Math.max(2, Math.min(40000, this.pps * f));
    this.t0 = Math.max(0, at - anchorX / this.pps);
    this.dirty = true;
  }

  private laneX(e: { clientX: number }): number {
    return e.clientX - this.overlay.getBoundingClientRect().left;
  }

  private timeAt(x: number): number {
    return Math.max(0, this.t0 + x / this.pps);
  }

  private down(e: PointerEvent): void {
    const tgt = e.target as HTMLElement;
    if (tgt.closest(".dm-th") || e.button !== 0) return;
    const lane = tgt.closest<HTMLElement>(".dm-track");
    const inRuler = !!tgt.closest(".dm-ruler");
    if (!lane && !inRuler) return;
    if (lane) this.store.selectTrack(Number(lane.dataset.id));
    const x = this.laneX(e);
    this.drag = { anchor: this.timeAt(x), x0: e.clientX, moved: false, lane: !!lane };
    this.root.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    const dur = this.store.duration();
    const t = Math.min(dur, this.timeAt(this.laneX(e)));
    const a = Math.min(d.anchor, t), b = Math.max(d.anchor, t);
    this.store.setSel([Math.min(a, dur), b]);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    if (!d.moved) {
      this.store.setSel(null);
      this.onSeek(Math.min(this.store.duration(), d.anchor));
    }
  }

  private dbl(e: MouseEvent): void {
    const lane = (e.target as HTMLElement).closest<HTMLElement>(".dm-track");
    if (!lane || (e.target as HTMLElement).closest(".dm-th")) return;
    const t = this.store.tracks.find((x) => x.id === Number(lane.dataset.id));
    if (t) this.store.setSel([0, t.chans[0].length / this.store.rate]);
  }

  private wheel(e: WheelEvent): void {
    if ((e.target as HTMLElement).closest(".dm-th")) return;
    const x = this.laneX(e);
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      this.zoom(Math.exp(-e.deltaY * 0.0025), x);
      return;
    }
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (dx) {
      e.preventDefault();
      this.t0 = Math.max(0, this.t0 + dx / this.pps);
      this.dirty = true;
    }
  }

  invalidate(): void {
    this.dirty = true;
  }

  private updateSel(): void {
    const s = this.store.sel;
    if (!s) { this.selEl.style.display = "none"; return; }
    this.selEl.style.display = "block";
    this.selEl.style.transform = `translateX(${(s[0] - this.t0) * this.pps}px)`;
    this.selEl.style.inlineSize = `${Math.max(1, (s[1] - s[0]) * this.pps)}px`;
  }

  frame(): void {
    const pos = this.player.tick();
    if (this.player.playing && this.follow) {
      const x = (pos - this.t0) * this.pps;
      if (x > this.laneW - 24 || x < 0) { this.t0 = Math.max(0, pos - 40 / this.pps); this.dirty = true; }
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw();
      this.updateSel();
    }
    this.headEl.style.transform = `translateX(${(pos - this.t0) * this.pps}px)`;
  }

  private draw(): void {
    const p = this.pal();
    this.drawRuler(p);
    for (const t of this.store.tracks) {
      const r = this.rows.get(t.id);
      if (!r) continue;
      this.sizeRow(r);
      this.drawRow(r, t, p);
    }
  }

  private drawRuler(p: Palette): void {
    const dpr = window.devicePixelRatio || 1;
    const g = this.rg;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.rw, this.rh);
    let step = STEPS[STEPS.length - 1];
    for (const s of STEPS) if (s * this.pps >= 84) { step = s; break; }
    const minor = step / 5;
    g.font = `11px ${getComputedStyle(document.body).fontFamily}`;
    g.textBaseline = "top";
    const end = this.t0 + this.rw / this.pps;
    g.fillStyle = p.muted;
    if (minor * this.pps >= 8) {
      for (let t = Math.ceil(this.t0 / minor) * minor; t <= end; t += minor) g.fillRect(Math.round((t - this.t0) * this.pps), this.rh - 5, 1, 5);
    }
    for (let t = Math.ceil(this.t0 / step) * step; t <= end; t += step) {
      const x = Math.round((t - this.t0) * this.pps);
      g.fillStyle = p.muted;
      g.fillRect(x, this.rh - 12, 1, 12);
      g.fillStyle = p.ruler;
      const m = Math.floor(t / 60), s = t - m * 60;
      g.fillText(step < 1 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : `${m}:${String(Math.round(s)).padStart(2, "0")}`, x + 4, 5);
    }
  }

  private pyramid(t: Track): PeakPyramid {
    let pk = this.peaks.get(t.chans[0]);
    if (!pk) { pk = buildPeaks(t.chans); this.peaks.set(t.chans[0], pk); }
    return pk;
  }

  private drawRow(r: Row, t: Track, p: Palette): void {
    const dpr = window.devicePixelRatio || 1;
    const g = r.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.w, r.h);
    const rate = this.store.rate;
    const len = t.chans[0].length;
    const x0 = Math.max(0, -this.t0 * this.pps);
    const x1 = Math.min(r.w, (len / rate - this.t0) * this.pps);
    if (x1 <= x0) return;
    const col = p.track[t.color] ?? [128, 128, 128];
    g.fillStyle = this.rgba(col, t.mute ? 0.05 : 0.12);
    g.fillRect(x0, 0, x1 - x0, r.h);
    g.fillStyle = this.rgba(col, 0.55);
    g.fillRect(x0, 0, x1 - x0, 1);
    if (t.spec) { this.drawSpec(r, t, x0, x1, p); return; }
    const ch = t.chans.length;
    const band = r.h / ch;
    const pk = this.pyramid(t);
    const spp = rate / this.pps;
    g.fillStyle = this.rgba(col, t.mute ? 0.35 : 0.95);
    for (let c = 0; c < ch; c++) {
      const mid = band * c + band / 2, amp = band / 2 - 3;
      const data = t.chans[c];
      g.fillStyle = this.rgba(col, 0.25);
      g.fillRect(x0, Math.round(mid), x1 - x0, 1);
      g.fillStyle = this.rgba(col, t.mute ? 0.35 : 0.95);
      if (spp < 2) {
        g.beginPath();
        let first = true;
        const sFrom = Math.max(0, Math.floor(this.t0 * rate) - 1), sTo = Math.min(len, Math.ceil((this.t0 + r.w / this.pps) * rate) + 1);
        for (let i = sFrom; i < sTo; i++) {
          const x = (i / rate - this.t0) * this.pps, y = mid - data[i] * amp;
          if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
        }
        g.strokeStyle = this.rgba(col, t.mute ? 0.4 : 0.95);
        g.lineWidth = 1.25;
        g.stroke();
        continue;
      }
      for (let x = Math.floor(x0); x < x1; x++) {
        const a = Math.floor((this.t0 + x / this.pps) * rate), b = Math.min(len, Math.max(a + 1, Math.floor((this.t0 + (x + 1) / this.pps) * rate)));
        if (a >= len) break;
        let lo = Infinity, hi = -Infinity;
        if (spp >= pk.block * 2) {
          const ba = Math.floor(a / pk.block), bb = Math.min(pk.min[c].length, Math.ceil(b / pk.block));
          for (let k = ba; k < bb; k++) { if (pk.min[c][k] < lo) lo = pk.min[c][k]; if (pk.max[c][k] > hi) hi = pk.max[c][k]; }
        } else {
          for (let i = a; i < b; i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        }
        if (lo > hi) continue;
        const yt = mid - Math.min(1, hi) * amp, yb = mid - Math.max(-1, lo) * amp;
        g.fillRect(x, yt, 1, Math.max(1, yb - yt));
      }
    }
  }

  private drawSpec(r: Row, t: Track, x0: number, x1: number, p: Palette): void {
    let entry = this.specs.get(t.chans[0]);
    if (!entry) { entry = { data: spectrogram(t.chans, this.store.rate), img: null }; this.specs.set(t.chans[0], entry); }
    if (!entry.img) {
      const { frames, rows, data } = entry.data;
      const c = document.createElement("canvas");
      c.width = frames; c.height = rows;
      const cg = c.getContext("2d")!;
      const im = cg.createImageData(frames, rows);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        im.data[i * 4] = p.lut[v * 3]; im.data[i * 4 + 1] = p.lut[v * 3 + 1]; im.data[i * 4 + 2] = p.lut[v * 3 + 2]; im.data[i * 4 + 3] = 255;
      }
      cg.putImageData(im, 0, 0);
      entry.img = c;
    }
    const len = t.chans[0].length / this.store.rate;
    const fx = (tm: number) => Math.max(0, Math.min(entry!.data.frames, (tm / len) * entry!.data.frames));
    const tA = this.t0 + x0 / this.pps, tB = this.t0 + x1 / this.pps;
    const sx = fx(tA), sw = Math.max(0.01, fx(tB) - sx);
    r.g.imageSmoothingEnabled = true;
    r.g.drawImage(entry.img, sx, 0, sw, entry.data.rows, x0, 0, x1 - x0, r.h);
  }
}
