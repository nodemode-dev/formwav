import { autoDefs } from "./audio";
import { ENV_BLOCK, items } from "./lib";
import { BAR, type Clip, laneAt, MARKER_COLORS, type Pt, RATE, SPB, type Store, type Track } from "./model";
import type { Player } from "./player";

const TRACK_H = 48;
const RULER_TOP = 22;
const EDGE = 6;

type Rgb = [number, number, number];
interface Row { el: HTMLElement; canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; w: number; h: number; num: HTMLElement; name: HTMLElement; mute: HTMLButtonElement; solo: HTMLButtonElement; fx: HTMLButtonElement; vol: HTMLInputElement; dot: HTMLElement }
interface Pal { track: Record<string, Rgb>; marker: Record<string, Rgb>; accent: Rgb; text: string; muted: string; line: string; ruler: string }

type Drag =
  | { kind: "clip"; mode: "move" | "l" | "r"; track: Track; clip: Clip; x0: number; start: number; offset: number; length: number; moved: boolean }
  | { kind: "ruler"; anchor: number; x0: number; moved: boolean }
  | { kind: "marker"; id: number; x0: number; beat: number; moved: boolean }
  | { kind: "auto"; pts: Pt[]; pt: Pt; moved: boolean };

export function fmtBars(beat: number): string {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / BAR) + 1;
  const beatIn = Math.floor(b % BAR) + 1;
  const sixteenth = Math.floor((b % 1) * 4) + 1;
  return `${bar}.${beatIn}.${sixteenth}`;
}

export function fmtClock(beat: number): string {
  const t = Math.max(0, beat) * SPB;
  const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export class Arrange {
  pps = 8;
  t0 = 0;
  follow = true;
  onSeek: (beat: number) => void = () => {};
  onDrop: (item: string, track: number, beat: number) => void = () => {};
  onFx: (track: number) => void = () => {};
  onMarkers: () => void = () => {};
  private rows = new Map<number, Row>();
  private tracksEl: HTMLElement;
  private rulerEl: HTMLElement;
  private rc: HTMLCanvasElement;
  private rg: CanvasRenderingContext2D;
  private rw = 0;
  private rh = 0;
  private laneW = 0;
  private ac: HTMLCanvasElement;
  private ag: CanvasRenderingContext2D;
  private aw = 0;
  private ah = 0;
  private autoEl: HTMLElement;
  private autoSel: HTMLSelectElement;
  private autoSig = "";
  private autoKeys = new Map<number, string>();
  private overlay: HTMLElement;
  private headEl: HTMLElement;
  private regionEl: HTMLElement;
  private empty: HTMLElement;
  private dirty = true;
  private pal: Pal | null = null;
  private scratch: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private flags: Array<{ id: number; x0: number; x1: number }> = [];

  constructor(private root: HTMLElement, private store: Store, private player: Player) {
    this.tracksEl = root.querySelector("#dm-tracks")!;
    this.rulerEl = root.querySelector("#pr-ruler")!;
    this.rc = this.rulerEl.querySelector("canvas")!;
    this.rg = this.rc.getContext("2d")!;
    this.autoEl = root.querySelector("#pr-auto")!;
    this.ac = this.autoEl.querySelector("canvas")!;
    this.ag = this.ac.getContext("2d")!;
    this.autoSel = root.querySelector("#pr-auto-param")!;
    this.overlay = root.querySelector("#dm-overlay")!;
    this.headEl = root.querySelector("#dm-playhead")!;
    this.regionEl = root.querySelector("#pr-region")!;
    this.empty = root.querySelector("#dm-empty")!;
    const sc = document.createElement("canvas");
    sc.width = sc.height = 1;
    this.scratch = sc.getContext("2d", { willReadFrequently: true })!;

    new ResizeObserver(() => this.measure()).observe(root);
    const reset = (): void => { this.pal = null; this.dirty = true; };
    new MutationObserver(reset).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    new MutationObserver(reset).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    this.tracksEl.addEventListener("pointerdown", (e) => this.laneDown(e));
    this.tracksEl.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("text/x-fw-item")) e.preventDefault(); });
    this.tracksEl.addEventListener("drop", (e) => this.laneDrop(e));
    this.rulerEl.addEventListener("pointerdown", (e) => this.rulerDown(e));
    this.ac.addEventListener("pointerdown", (e) => this.autoDown(e));
    this.ac.addEventListener("dblclick", (e) => this.autoDbl(e));
    root.addEventListener("pointermove", (e) => this.move(e));
    root.addEventListener("pointerup", (e) => this.up(e));
    root.addEventListener("pointercancel", (e) => this.up(e));
    root.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    this.autoSel.addEventListener("change", () => {
      if (this.store.selTrack != null) this.autoKeys.set(this.store.selTrack, this.autoSel.value);
      this.dirty = true;
    });

    store.on("doc", () => { this.sync(); this.dirty = true; });
    store.on("live", () => { this.dirty = true; });
    store.on("sel", () => { this.markSelected(); this.syncAuto(); this.dirty = true; });
    this.measure();
  }

  private color(v: string): string { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  private parse(css: string): Rgb {
    const g = this.scratch;
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#000";
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  private palette(): Pal {
    if (this.pal) return this.pal;
    const track: Record<string, Rgb> = {};
    for (const v of ["cyan", "violet", "amber", "pink", "green", "blue", "red", "slate"]) track[`--fw-color-${v}`] = this.parse(this.color(`--fw-color-${v}`));
    const marker: Record<string, Rgb> = {};
    for (const m of MARKER_COLORS) marker[m] = track[`--fw-color-${m}`];
    this.pal = { track, marker, accent: this.parse(this.color("--accent-color")), text: this.color("--text-primary"), muted: this.color("--text-muted"), line: this.color("--line-1"), ruler: this.color("--text-secondary") };
    return this.pal;
  }

  private rgba(c: Rgb, a: number): string { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  measure(): void {
    const dpr = window.devicePixelRatio || 1;
    const rr = this.rulerEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(rr.width)), h = Math.max(1, Math.round(rr.height));
    this.laneW = w;
    if (w !== this.rw || h !== this.rh) { this.rw = w; this.rh = h; this.rc.width = Math.round(w * dpr); this.rc.height = Math.round(h * dpr); }
    const ar = this.ac.parentElement!.getBoundingClientRect();
    const aw = Math.max(1, Math.round(ar.width)), ah = Math.max(1, Math.round(ar.height));
    if (aw !== this.aw || ah !== this.ah) { this.aw = aw; this.ah = ah; this.ac.width = Math.round(aw * dpr); this.ac.height = Math.round(ah * dpr); }
    for (const r of this.rows.values()) this.sizeRow(r);
    this.dirty = true;
  }

  private sizeRow(r: Row): void {
    const dpr = window.devicePixelRatio || 1;
    const lane = r.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.round(lane.width)), h = Math.max(1, Math.round(lane.height));
    if (w !== r.w || h !== r.h) { r.w = w; r.h = h; r.canvas.width = Math.round(w * dpr); r.canvas.height = Math.round(h * dpr); }
  }

  private makeRow(t: Track): Row {
    const el = document.createElement("div");
    el.className = "dm-track";
    el.dataset.id = String(t.id);
    el.style.blockSize = `${TRACK_H}px`;
    el.innerHTML = `<div class="dm-th"><div class="dm-th-top"><span class="dm-th-num"></span><span class="dm-th-chip"></span><span class="dm-th-name" translate="no"></span><span class="pr-dot" title="This track has automation"></span></div><div class="dm-th-ctl"><button class="dm-ms" type="button" data-act="mute" title="Mute" aria-pressed="false">M</button><button class="dm-ms" type="button" data-act="solo" title="Solo" aria-pressed="false">S</button><button class="dm-ms dm-ms-wide" type="button" data-act="fx" title="Open this track's effects">FX</button><input class="dm-th-gain" type="range" min="-48" max="6" step="0.5" value="0" data-act="vol" aria-label="Track volume" title="Track volume"></div></div><div class="dm-lane"><canvas></canvas></div>`;
    const canvas = el.querySelector("canvas")!;
    const row: Row = {
      el, canvas, g: canvas.getContext("2d")!, w: 0, h: 0,
      num: el.querySelector(".dm-th-num")!, name: el.querySelector(".dm-th-name")!, dot: el.querySelector(".pr-dot")!,
      mute: el.querySelector('[data-act="mute"]')!, solo: el.querySelector('[data-act="solo"]')!, fx: el.querySelector('[data-act="fx"]')!, vol: el.querySelector('[data-act="vol"]')!,
    };
    el.querySelector(".dm-th")!.addEventListener("click", (e) => {
      const tr = this.store.doc.tracks.find((x) => x.id === t.id);
      if (!tr) return;
      this.store.select(t.id, null);
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!b) return;
      if (b.dataset.act === "mute") { tr.mute = !tr.mute; this.store.commit(`${tr.mute ? "Mute" : "Unmute"} ${tr.name}`); }
      if (b.dataset.act === "solo") { tr.solo = !tr.solo; this.store.commit(`${tr.solo ? "Solo" : "Unsolo"} ${tr.name}`); }
      if (b.dataset.act === "fx") this.onFx(t.id);
    });
    row.vol.addEventListener("input", () => { const tr = this.store.doc.tracks.find((x) => x.id === t.id); if (tr) { tr.vol = Number(row.vol.value); this.store.emit("live"); } });
    row.vol.addEventListener("change", () => { const tr = this.store.doc.tracks.find((x) => x.id === t.id); if (tr) this.store.commit(`Volume of ${tr.name}`); });
    this.tracksEl.append(el);
    return row;
  }

  sync(): void {
    const doc = this.store.doc;
    const ids = new Set(doc.tracks.map((t) => t.id));
    for (const [id, r] of this.rows) if (!ids.has(id)) { r.el.remove(); this.rows.delete(id); }
    let i = 0;
    for (const t of doc.tracks) {
      let r = this.rows.get(t.id);
      if (!r) { r = this.makeRow(t); this.rows.set(t.id, r); }
      this.tracksEl.append(r.el);
      i++;
      const css = `var(${t.color})`;
      if (r.el.style.getPropertyValue("--dm-track") !== css) r.el.style.setProperty("--dm-track", css);
      const num = String(i).padStart(2, "0");
      if (r.num.textContent !== num) r.num.textContent = num;
      if (r.name.textContent !== t.name) r.name.textContent = t.name;
      r.mute.setAttribute("aria-pressed", String(t.mute));
      r.solo.setAttribute("aria-pressed", String(t.solo));
      const fxText = t.fx.length ? `FX ${t.fx.length}` : "FX";
      if (r.fx.textContent !== fxText) r.fx.textContent = fxText;
      if (Number(r.vol.value) !== t.vol) r.vol.value = String(t.vol);
      r.vol.disabled = !!t.auto.vol?.length;
      const has = Object.values(t.auto).some((p) => p.length);
      if (r.dot.dataset.on !== String(has)) r.dot.dataset.on = String(has);
      this.sizeRow(r);
    }
    this.empty.hidden = doc.tracks.length > 0;
    this.markSelected();
    this.syncAuto();
  }

  private markSelected(): void {
    for (const [id, r] of this.rows) r.el.classList.toggle("is-selected", id === this.store.selTrack);
  }

  private syncAuto(): void {
    const t = this.store.track;
    const defs = t ? autoDefs(t) : [];
    const s = `${t?.id ?? ""}|${defs.map((d) => d.key + d.label).join(",")}`;
    if (s !== this.autoSig) {
      this.autoSig = s;
      this.autoSel.replaceChildren(...defs.map((d) => new Option(d.label, d.key)));
      this.autoSel.disabled = !t;
    }
    if (t) {
      let key = this.autoKeys.get(t.id);
      if (!key || !defs.some((d) => d.key === key)) {
        key = defs.find((d) => t.auto[d.key]?.length)?.key ?? "vol";
        this.autoKeys.set(t.id, key);
      }
      if (this.autoSel.value !== key) this.autoSel.value = key;
    }
  }

  autoKey(): string | null {
    return this.store.selTrack != null ? this.autoKeys.get(this.store.selTrack) ?? null : null;
  }

  setAutoKey(key: string): void {
    if (this.store.selTrack == null) return;
    this.autoKeys.set(this.store.selTrack, key);
    this.syncAuto();
    this.dirty = true;
  }

  fit(): void {
    const total = Math.max(32, Math.ceil(this.store.endBeat() / BAR) * BAR);
    this.pps = Math.max(1, (this.laneW - 16) / total);
    this.t0 = 0;
    this.dirty = true;
  }

  zoom(f: number, ax = this.laneW / 2): void {
    const at = this.t0 + ax / this.pps;
    this.pps = Math.max(2, Math.min(200, this.pps * f));
    this.t0 = Math.max(0, at - ax / this.pps);
    this.dirty = true;
  }

  invalidate(): void { this.dirty = true; }

  private laneX(e: { clientX: number }): number { return e.clientX - this.overlay.getBoundingClientRect().left; }
  private beatAt(x: number): number { return Math.max(0, this.t0 + x / this.pps); }

  private rowAt(clientY: number): { track: Track; el: HTMLElement } | null {
    for (const [id, r] of this.rows) {
      const b = r.el.getBoundingClientRect();
      if (clientY >= b.top && clientY < b.bottom) { const track = this.store.doc.tracks.find((t) => t.id === id); if (track) return { track, el: r.el }; }
    }
    return null;
  }

  private clipHit(t: Track, beat: number): Clip | null {
    let hit: Clip | null = null;
    for (const c of t.clips) if (beat >= c.start && beat < c.start + c.length) hit = c;
    return hit;
  }

  private laneDown(e: PointerEvent): void {
    const tgt = e.target as HTMLElement;
    if (e.button !== 0 || tgt.closest(".dm-th")) return;
    const lane = tgt.closest<HTMLElement>(".dm-track");
    if (!lane) return;
    const track = this.store.doc.tracks.find((t) => t.id === Number(lane.dataset.id));
    if (!track) return;
    const x = this.laneX(e);
    const beat = this.beatAt(x);
    const clip = this.clipHit(track, beat);
    if (!clip) {
      this.store.select(track.id, null);
      this.onSeek(beat);
      return;
    }
    this.store.select(track.id, clip.id);
    const left = (clip.start - this.t0) * this.pps, right = (clip.start + clip.length - this.t0) * this.pps;
    const mode = x - left <= EDGE ? "l" : right - x <= EDGE ? "r" : "move";
    this.drag = { kind: "clip", mode, track, clip, x0: e.clientX, start: clip.start, offset: clip.offset, length: clip.length, moved: false };
    this.root.setPointerCapture(e.pointerId);
  }

  private laneDrop(e: DragEvent): void {
    const id = e.dataTransfer?.getData("text/x-fw-item");
    if (!id) return;
    e.preventDefault();
    const lane = (e.target as HTMLElement).closest<HTMLElement>(".dm-track");
    if (!lane) return;
    this.onDrop(id, Number(lane.dataset.id), this.store.snapBeat(this.beatAt(this.laneX(e))));
  }

  private rulerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const rr = this.rulerEl.getBoundingClientRect();
    const x = e.clientX - rr.left, y = e.clientY - rr.top;
    if (y >= RULER_TOP) {
      const f = this.flags.find((q) => x >= q.x0 && x <= q.x1);
      if (f) {
        const m = this.store.doc.markers.find((q) => q.id === f.id)!;
        this.drag = { kind: "marker", id: m.id, x0: e.clientX, beat: m.beat, moved: false };
        this.root.setPointerCapture(e.pointerId);
        return;
      }
    }
    this.drag = { kind: "ruler", anchor: this.beatAt(x), x0: e.clientX, moved: false };
    this.root.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === "auto") return this.autoMove(e, d);
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    d.moved = true;
    const st = this.store;
    if (d.kind === "ruler") {
      const b = st.snapBeat(this.beatAt(this.laneX(e)));
      const a = st.snapBeat(d.anchor);
      st.doc.region = [Math.min(a, b), Math.max(a, b)];
      st.emit("live");
      return;
    }
    if (d.kind === "marker") {
      const m = st.doc.markers.find((q) => q.id === d.id);
      if (m) { m.beat = st.snapBeat(d.beat + (e.clientX - d.x0) / this.pps); st.emit("live"); }
      return;
    }
    const it = items.get(d.clip.item);
    const max = it ? it.beats : d.length;
    const delta = (e.clientX - d.x0) / this.pps;
    if (d.mode === "move") {
      d.clip.start = st.snapBeat(d.start + delta);
      const under = this.rowAt(e.clientY);
      if (under && under.track.id !== d.track.id) {
        d.track.clips = d.track.clips.filter((c) => c.id !== d.clip.id);
        under.track.clips.push(d.clip);
        d.track = under.track;
        st.selTrack = under.track.id;
        st.emit("sel");
      }
    } else if (d.mode === "r") {
      d.clip.length = Math.min(max - d.offset, Math.max(0.25, st.snapBeat(d.start + d.length + delta, true) - d.start));
    } else {
      const end = d.start + d.length;
      const ns = Math.min(end - 0.25, Math.max(d.start - d.offset, st.snapBeat(d.start + delta, true)));
      d.clip.start = ns;
      d.clip.offset = d.offset + (ns - d.start);
      d.clip.length = end - ns;
    }
    st.emit("live");
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    const st = this.store;
    if (d.kind === "auto") { if (d.moved) { d.pts.sort((a, b) => a.beat - b.beat); st.commit("Edit automation"); } return; }
    if (d.kind === "ruler") {
      if (d.moved) st.commit("Set the region");
      else this.onSeek(d.anchor);
      return;
    }
    if (d.kind === "marker") {
      if (d.moved) { st.doc.markers.sort((a, b) => a.beat - b.beat); st.commit("Move a marker"); }
      else { const m = st.doc.markers.find((q) => q.id === d.id); if (m) this.onSeek(m.beat); }
      return;
    }
    if (d.moved) st.commit(d.mode === "move" ? "Move a clip" : "Trim a clip");
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
    if (dx) { e.preventDefault(); this.t0 = Math.max(0, this.t0 + dx / this.pps); this.dirty = true; }
  }

  private autoDef(): ReturnType<typeof autoDefs>[number] | null {
    const t = this.store.track;
    const key = this.autoKey();
    if (!t || !key) return null;
    return autoDefs(t).find((d) => d.key === key) ?? null;
  }

  private autoY(v: number, d: NonNullable<ReturnType<Arrange["autoDef"]>>): number {
    const t = d.log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min);
    return (1 - Math.min(1, Math.max(0, t))) * (this.ah - 12) + 6;
  }

  private autoVal(y: number, d: NonNullable<ReturnType<Arrange["autoDef"]>>): number {
    const t = 1 - Math.min(1, Math.max(0, (y - 6) / (this.ah - 12)));
    const v = d.log ? d.min * Math.pow(d.max / d.min, t) : d.min + t * (d.max - d.min);
    return d.log ? Number(v.toPrecision(4)) : Math.round(v * 100) / 100;
  }

  private autoDown(e: PointerEvent): void {
    const t = this.store.track, d = this.autoDef();
    if (!t || !d || e.button !== 0) return;
    const r = this.ac.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const pts = (t.auto[d.key] ??= []);
    let near: Pt | null = null;
    for (const p of pts) if (Math.hypot((p.beat - this.t0) * this.pps - x, this.autoY(p.value, d) - y) <= 8) near = p;
    if (near && e.altKey) {
      t.auto[d.key] = pts.filter((p) => p !== near);
      this.store.commit("Remove an automation point");
      return;
    }
    if (!near) {
      near = { beat: this.store.snapBeat(this.beatAt(x), true), value: this.autoVal(y, d) };
      pts.push(near);
      pts.sort((a, b) => a.beat - b.beat);
    }
    this.drag = { kind: "auto", pts, pt: near, moved: !!near };
    this.root.setPointerCapture(e.pointerId);
    this.store.emit("live");
  }

  private autoMove(e: PointerEvent, d: Extract<Drag, { kind: "auto" }>): void {
    const def = this.autoDef();
    if (!def) return;
    const r = this.ac.getBoundingClientRect();
    d.pt.beat = this.store.snapBeat(this.beatAt(e.clientX - r.left), true);
    d.pt.value = this.autoVal(e.clientY - r.top, def);
    d.moved = true;
    this.store.emit("live");
  }

  private autoDbl(e: MouseEvent): void {
    const t = this.store.track, d = this.autoDef();
    if (!t || !d) return;
    const r = this.ac.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const pts = t.auto[d.key] ?? [];
    const hit = pts.find((p) => Math.hypot((p.beat - this.t0) * this.pps - x, this.autoY(p.value, d) - y) <= 8);
    if (hit) { t.auto[d.key] = pts.filter((p) => p !== hit); this.store.commit("Remove an automation point"); }
  }

  span(): [number, number] {
    const st = this.store;
    if (st.doc.region) return st.doc.region;
    const c = st.clip;
    if (c) return [c.clip.start, c.clip.start + c.clip.length];
    return [0, Math.max(4, st.endBeat())];
  }

  frame(): void {
    const pos = this.player.tick();
    if (this.player.playing && this.follow) {
      const x = (pos - this.t0) * this.pps;
      if (x > this.laneW - 24 || x < 0) { this.t0 = Math.max(0, pos - 2); this.dirty = true; }
    }
    if (this.dirty) { this.dirty = false; this.draw(); this.updateOverlay(); }
    this.headEl.style.transform = `translateX(${(pos - this.t0) * this.pps}px)`;
  }

  private updateOverlay(): void {
    const r = this.store.doc.region;
    if (!r) { this.regionEl.style.display = "none"; return; }
    this.regionEl.style.display = "block";
    this.regionEl.style.transform = `translateX(${(r[0] - this.t0) * this.pps}px)`;
    this.regionEl.style.inlineSize = `${Math.max(1, (r[1] - r[0]) * this.pps)}px`;
  }

  private draw(): void {
    const p = this.palette();
    this.drawRuler(p);
    for (const t of this.store.doc.tracks) {
      const r = this.rows.get(t.id);
      if (!r) continue;
      this.sizeRow(r);
      this.drawRow(r, t, p);
    }
    this.drawAuto(p);
  }

  private grid(g: CanvasRenderingContext2D, w: number, h: number, p: Pal, top = 0): void {
    const end = this.t0 + w / this.pps;
    const barPx = this.pps * BAR;
    for (let b = Math.floor(this.t0 / BAR) * BAR; b <= end; b += 1) {
      const isBar = b % BAR === 0;
      if (!isBar && this.pps < 14) continue;
      const x = Math.round((b - this.t0) * this.pps);
      g.fillStyle = isBar ? this.rgba([128, 128, 128], 0.22) : this.rgba([128, 128, 128], 0.08);
      g.fillRect(x, top, 1, h - top);
    }
    if (barPx > 0) {
      for (let bar = Math.floor(this.t0 / BAR); bar * BAR <= end; bar++) {
        if (bar % 2) continue;
        const x = Math.round((bar * BAR - this.t0) * this.pps);
        g.fillStyle = this.rgba([128, 128, 128], 0.035);
        g.fillRect(x, top, Math.round(barPx), h - top);
      }
    }
    void p;
  }

  private drawRuler(p: Pal): void {
    const dpr = window.devicePixelRatio || 1;
    const g = this.rg;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.rw, this.rh);
    const end = this.t0 + this.rw / this.pps;
    let every = 16;
    for (const n of [1, 2, 4, 8, 16]) if (n * BAR * this.pps >= 44) { every = n; break; }
    g.font = `11px ${getComputedStyle(document.body).fontFamily}`;
    g.textBaseline = "top";
    for (let b = Math.floor(this.t0); b <= end; b++) {
      const x = Math.round((b - this.t0) * this.pps);
      if (b % BAR === 0) {
        const bar = b / BAR;
        g.fillStyle = p.muted;
        g.fillRect(x, 10, 1, RULER_TOP - 10);
        if (bar % every === 0) { g.fillStyle = p.ruler; g.fillText(String(bar + 1), x + 4, 4); }
      } else if (this.pps >= 12) { g.fillStyle = p.muted; g.fillRect(x, 16, 1, RULER_TOP - 16); }
    }
    g.fillStyle = p.line;
    g.fillRect(0, RULER_TOP, this.rw, 1);
    this.flags = [];
    g.font = `600 10px ${getComputedStyle(document.body).fontFamily}`;
    const ms = [...this.store.doc.markers].sort((a, b) => a.beat - b.beat);
    ms.forEach((m, i) => {
      const x = Math.round((m.beat - this.t0) * this.pps);
      const next = ms[i + 1] ? Math.round((ms[i + 1].beat - this.t0) * this.pps) : this.rw + 200;
      const col = p.marker[m.color] ?? p.accent;
      const w = Math.min(Math.ceil(g.measureText(m.name).width) + 12, Math.max(14, next - x - 2));
      if (x + w < 0 || x > this.rw) return;
      g.fillStyle = this.rgba(col, 0.9);
      g.fillRect(x, RULER_TOP + 3, 2, this.rh - RULER_TOP - 5);
      g.fillStyle = this.rgba(col, 0.28);
      g.fillRect(x + 2, RULER_TOP + 3, w - 2, this.rh - RULER_TOP - 6);
      g.save();
      g.beginPath();
      g.rect(x + 2, RULER_TOP + 3, w - 2, this.rh - RULER_TOP - 6);
      g.clip();
      g.fillStyle = p.text;
      g.fillText(m.name, x + 7, RULER_TOP + 7);
      g.restore();
      this.flags.push({ id: m.id, x0: x, x1: x + w });
    });
  }

  private drawRow(r: Row, t: Track, p: Pal): void {
    const dpr = window.devicePixelRatio || 1;
    const g = r.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.w, r.h);
    this.grid(g, r.w, r.h, p);
    const col = p.track[t.color] ?? [128, 128, 128];
    const dim = t.mute ? 0.4 : 1;
    const y0 = 4, hh = r.h - 8, mid = y0 + hh / 2;
    g.font = `600 11px ${getComputedStyle(document.body).fontFamily}`;
    g.textBaseline = "top";
    for (const c of t.clips) {
      const it = items.get(c.item);
      const x0 = (c.start - this.t0) * this.pps, x1 = (c.start + c.length - this.t0) * this.pps;
      if (x1 < 0 || x0 > r.w) continue;
      const sel = this.store.selClip === c.id;
      g.fillStyle = this.rgba(col, 0.22 * dim);
      g.fillRect(x0, y0, x1 - x0, hh);
      if (it?.env) {
        g.fillStyle = this.rgba(col, 0.9 * dim);
        const from = Math.max(0, Math.floor(x0)), to = Math.min(r.w, Math.ceil(x1));
        for (let x = from; x < to; x++) {
          const b0 = c.start + (x - x0) / this.pps - c.start + c.offset;
          const b1 = b0 + 1 / this.pps;
          const s0 = Math.floor((b0 * SPB * RATE) / ENV_BLOCK), s1 = Math.max(s0 + 1, Math.ceil((b1 * SPB * RATE) / ENV_BLOCK));
          let m = 0;
          for (let k = s0; k < s1 && k < it.env.length; k++) if (it.env[k] > m) m = it.env[k];
          const a = Math.min(1, m) * (hh / 2 - 2);
          g.fillRect(x, mid - a, 1, Math.max(1, a * 2));
        }
      }
      g.strokeStyle = sel ? this.rgba(p.accent, 1) : this.rgba(col, 0.7 * dim);
      g.lineWidth = sel ? 2 : 1;
      g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, hh - 1);
      if (x1 - x0 > 30 && it) {
        g.save();
        g.beginPath();
        g.rect(x0 + 1, y0, x1 - x0 - 2, hh);
        g.clip();
        const label = it.name;
        const tw = Math.ceil(g.measureText(label).width) + 8;
        g.fillStyle = "rgba(0,0,0,0.38)";
        g.fillRect(x0 + 3, y0 + 3, tw, 15);
        g.fillStyle = "#fff";
        g.fillText(label, x0 + 7, y0 + 5);
        g.restore();
      }
    }
  }

  private drawAuto(p: Pal): void {
    const dpr = window.devicePixelRatio || 1;
    const g = this.ag;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.aw, this.ah);
    this.grid(g, this.aw, this.ah, p);
    const t = this.store.track, d = this.autoDef();
    if (!t || !d) return;
    const pts = t.auto[d.key] ?? [];
    const col = p.accent;
    const ticks = d.log ? [100, 1000, 10000].filter((v) => v > d.min && v < d.max) : [d.min + (d.max - d.min) * 0.25, d.min + (d.max - d.min) * 0.5, d.min + (d.max - d.min) * 0.75];
    g.font = `10px ${getComputedStyle(document.body).fontFamily}`;
    g.textBaseline = "middle";
    for (const v of ticks) {
      const y = Math.round(this.autoY(v, d)) + 0.5;
      g.fillStyle = this.rgba([128, 128, 128], 0.18);
      g.fillRect(0, y, this.aw, 1);
      g.fillStyle = p.muted;
      g.fillText(d.unit === "Hz" ? (v >= 1000 ? `${v / 1000}k` : String(Math.round(v))) : d.unit === "dB" ? String(Math.round(v)) : v.toFixed(1), 4, y - 6);
    }
    const x = (b: number): number => (b - this.t0) * this.pps;
    g.beginPath();
    if (!pts.length) {
      const y = this.autoY(d.def, d);
      g.setLineDash([4, 4]);
      g.moveTo(0, y);
      g.lineTo(this.aw, y);
      g.strokeStyle = this.rgba(col, 0.55);
      g.lineWidth = 1.25;
      g.stroke();
      g.setLineDash([]);
      return;
    }
    const steps = Math.max(2, Math.floor(this.aw / 3));
    for (let i = 0; i <= steps; i++) {
      const b = this.t0 + (i / steps) * (this.aw / this.pps);
      const px = x(b), py = this.autoY(laneAt(pts, b, d.def), d);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.lineTo(this.aw, this.ah);
    g.lineTo(0, this.ah);
    g.closePath();
    g.fillStyle = this.rgba(col, 0.1);
    g.fill();
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const b = this.t0 + (i / steps) * (this.aw / this.pps);
      const px = x(b), py = this.autoY(laneAt(pts, b, d.def), d);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokeStyle = this.rgba(col, 0.95);
    g.lineWidth = 1.75;
    g.stroke();
    for (const q of pts) {
      const px = x(q.beat), py = this.autoY(q.value, d);
      if (px < -6 || px > this.aw + 6) continue;
      g.beginPath();
      g.arc(px, py, 4, 0, Math.PI * 2);
      g.fillStyle = this.rgba(col, 1);
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = 1;
      g.stroke();
    }
  }
}
