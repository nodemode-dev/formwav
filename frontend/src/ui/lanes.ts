import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import { documentLength, sessionLength } from "../engine/document";
import { fetchPeaks, type PeakData } from "../io/media-client";
import { gridEnabled, shuffleEnabled, snapSamples } from "./grid";
import { patchList, setText } from "../vendor/nodemode/dom-stable";

const PEAK_SPP = 256;
const MAX_TIMELINE_PX = 16000;
const BASE_PX_PER_SECOND = 100;

interface PaintInfo {
  clip: Clip;
  media: MediaRef;
  sessionRate: number;
  spp: number;
}

const peakCache = new Map<string, Promise<PeakData>>();
const paintInfo = new WeakMap<HTMLCanvasElement, PaintInfo>();

function peaksFor(id: string): Promise<PeakData> {
  let pending = peakCache.get(id);
  if (!pending) {
    pending = fetchPeaks(id, PEAK_SPP);
    peakCache.set(id, pending);
    pending.catch(() => peakCache.delete(id));
  }
  return pending;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
let zoom = 1;
const selectedClipIds = new Set<string>();
const zoomListeners = new Set<() => void>();

export function getZoom(): number {
  return zoom;
}

export function setZoom(next: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (clamped === zoom) return;
  zoom = clamped;
  for (const listener of zoomListeners) listener();
}

export function onZoom(listener: () => void): void {
  zoomListeners.add(listener);
}

export function samplesPerPixel(doc: SessionDoc): number {
  return Math.max(doc.sampleRate / (BASE_PX_PER_SECOND * zoom), Math.ceil(documentLength(doc) / MAX_TIMELINE_PX));
}

function channelLabel(n: number): string {
  return n === 1 ? "mono" : n === 2 ? "stereo" : `${n} channels`;
}

function paint(canvas: HTMLCanvasElement, peaks: PeakData): void {
  const info = paintInfo.get(canvas);
  if (!info || !canvas.isConnected) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(canvas).color;
  const ch = Math.max(1, peaks.channels);
  const stride = ch * 2;
  const sourceFrames = (info.clip.length * info.media.sampleRate) / info.sessionRate;
  const blocksPerPx = sourceFrames / w / peaks.samplesPerPeak;
  const startBlock = info.clip.sourceIn / peaks.samplesPerPeak;
  const rowH = h / ch;
  const half = (rowH / 2) * 0.9;
  const clipGain = 10 ** (info.clip.gainDb / 20);
  for (let x = 0; x < w; x++) {
    const b0 = Math.floor(startBlock + x * blocksPerPx);
    if (b0 >= peaks.blocks) break;
    const b1 = Math.min(peaks.blocks, Math.max(b0 + 1, Math.floor(startBlock + (x + 1) * blocksPerPx)));
    for (let c = 0; c < ch; c++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let b = b0; b < b1; b++) {
        const i = b * stride + c * 2;
        if (peaks.data[i] < lo) lo = peaks.data[i];
        if (peaks.data[i + 1] > hi) hi = peaks.data[i + 1];
      }
      if (hi < lo) continue;
      const mid = rowH * c + rowH / 2;
      const top = mid - Math.min(1, hi * clipGain) * half;
      const bottom = mid - Math.max(-1, lo * clipGain) * half;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }
  const clip = info.clip;
  const fadeIn = Math.min(clip.fadeIn ?? 0, clip.length);
  const fadeOut = Math.min(clip.fadeOut ?? 0, clip.length - fadeIn);
  if (fadeIn <= 0 && fadeOut <= 0) return;
  const curve = (v: number) => (clip.fadeShape === "equal-power" ? Math.sin((v * Math.PI) / 2) : v);
  const style = getComputedStyle(canvas);
  const pxPerSample = w / clip.length;
  const envelope = (from: number, span: number, rising: boolean) => {
    ctx.beginPath();
    ctx.moveTo(from, 0);
    const steps = Math.max(2, Math.ceil(span));
    for (let i = 0; i <= steps; i++) {
      const v = i / steps;
      ctx.lineTo(from + v * span, h * (1 - curve(rising ? v : 1 - v)));
    }
    ctx.lineTo(from + span, 0);
    ctx.closePath();
  };
  ctx.fillStyle = style.outlineColor;
  ctx.globalAlpha = 0.6;
  if (fadeIn > 0) {
    envelope(0, fadeIn * pxPerSample, true);
    ctx.fill();
  }
  if (fadeOut > 0) {
    envelope(w - fadeOut * pxPerSample, fadeOut * pxPerSample, false);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function schedulePaint(canvas: HTMLCanvasElement, mediaId: string): void {
  peaksFor(mediaId)
    .then((peaks) => requestAnimationFrame(() => paint(canvas, peaks)))
    .catch(() => undefined);
}

const GAIN_TOP_DB = 12;
const GAIN_SPAN_DB = 48;

function gainFraction(db: number): number {
  return Math.min(1, Math.max(0, (GAIN_TOP_DB - db) / GAIN_SPAN_DB));
}

function gainLabel(db: number): string {
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

function dragGain(db: number, dy: number, height: number): number {
  const next = db - (dy / Math.max(1, height)) * GAIN_SPAN_DB;
  return Math.round(Math.min(GAIN_TOP_DB, Math.max(GAIN_TOP_DB - GAIN_SPAN_DB, next)) * 10) / 10;
}

function clipNode(): HTMLElement {
  const node = document.createElement("div");
  node.className = "fw-clip";
  const canvas = document.createElement("canvas");
  canvas.className = "fw-wave";
  const fadeIn = document.createElement("span");
  fadeIn.className = "fw-fade-handle fw-fade-in";
  const fadeOut = document.createElement("span");
  fadeOut.className = "fw-fade-handle fw-fade-out";
  const gain = document.createElement("span");
  gain.className = "fw-gain-line";
  node.append(canvas, fadeIn, fadeOut, gain);
  return node;
}

function updateClip(node: HTMLElement, clip: Clip, doc: SessionDoc, spp: number): void {
  const left = `${(clip.start / spp).toFixed(2)}px`;
  const width = `${Math.max(1, clip.length / spp).toFixed(2)}px`;
  if (node.dataset.left !== left) {
    node.dataset.left = left;
    node.style.left = left;
  }
  if (node.dataset.width !== width) {
    node.dataset.width = width;
    node.style.width = width;
  }
  const selected = String(selectedClipIds.has(clip.id));
  if (node.getAttribute("aria-selected") !== selected) node.setAttribute("aria-selected", selected);
  const handles: [string, string][] = [
    [".fw-fade-in", `translateX(${((clip.fadeIn ?? 0) / spp).toFixed(2)}px)`],
    [".fw-fade-out", `translateX(${(-(clip.fadeOut ?? 0) / spp).toFixed(2)}px)`],
  ];
  const line = node.querySelector<HTMLElement>(".fw-gain-line");
  if (line) {
    const top = `${(gainFraction(clip.gainDb) * 100).toFixed(2)}%`;
    if (line.dataset.top !== top) {
      line.dataset.top = top;
      line.style.top = top;
    }
    const db = gainLabel(clip.gainDb);
    if (line.dataset.db !== db) line.dataset.db = db;
  }
  for (const [selector, transform] of handles) {
    const handle = node.querySelector<HTMLElement>(selector);
    if (handle && handle.dataset.tx !== transform) {
      handle.dataset.tx = transform;
      handle.style.transform = transform;
    }
  }
  const canvas = node.firstElementChild as HTMLCanvasElement | null;
  const media = doc.media[clip.mediaId];
  if (!canvas || !media) return;
  const prev = paintInfo.get(canvas);
  if (prev && prev.clip === clip && prev.media === media && prev.sessionRate === doc.sampleRate && prev.spp === spp) return;
  paintInfo.set(canvas, { clip, media, sessionRate: doc.sampleRate, spp });
  schedulePaint(canvas, media.id);
}

function laneNode(): HTMLElement {
  const lane = document.createElement("div");
  lane.className = "fw-lane";
  lane.innerHTML = `<div class="fw-lane-head"><span class="fw-lane-name"></span><span class="fw-lane-meta"></span></div><div class="fw-lane-body"></div>`;
  return lane;
}

function updateLane(node: HTMLElement, track: Track, doc: SessionDoc, spp: number): void {
  setText(node.querySelector(".fw-lane-name"), track.name);
  const first = track.clips[0];
  const media = first ? doc.media[first.mediaId] : undefined;
  setText(node.querySelector(".fw-lane-meta"), media ? `${channelLabel(track.channels)} · ${media.format} · ${(media.sampleRate / 1000).toFixed(1)} kHz` : channelLabel(track.channels));
  const body = node.querySelector<HTMLElement>(".fw-lane-body");
  if (!body) return;
  patchList(body, [...track.clips], {
    key: (c) => c.id,
    create: (c) => {
      const n = clipNode();
      updateClip(n, c, doc, spp);
      return n;
    },
    update: (n, c) => updateClip(n, c, doc, spp),
  });
}

export function mountLanes(host: HTMLElement, engine: Engine): void {
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!stage || !lanes) return;

  const render = (doc: SessionDoc) => {
    const view = doc.tracks.length ? "session" : "empty";
    if (stage.dataset.view !== view) stage.dataset.view = view;
    const spp = samplesPerPixel(doc);
    lastSpp = spp;
    const timeline = `${Math.ceil(documentLength(doc) / spp)}px`;
    if (lanes.dataset.timeline !== timeline) {
      lanes.dataset.timeline = timeline;
      lanes.style.setProperty("--fw-timeline-w", timeline);
    }
    patchList(lanes, [...doc.tracks], {
      key: (t) => t.id,
      create: (t) => {
        const n = laneNode();
        updateLane(n, t, doc, spp);
        return n;
      },
      update: (n, t) => updateLane(n, t, doc, spp),
    });
  };

  document.addEventListener("nm:ui-settings-changed", () => {
    for (const canvas of lanes.querySelectorAll<HTMLCanvasElement>("canvas.fw-wave")) {
      const info = paintInfo.get(canvas);
      if (info) schedulePaint(canvas, info.media.id);
    }
  });

  engine.subscribe("document", render);
  let lastSpp = 1;
  onZoom(() => {
    const doc = engine.get("document");
    const position = engine.get("transport").positionSamples;
    const offset = position / lastSpp - stage.scrollLeft;
    render(doc);
    stage.scrollLeft = Math.max(0, position / samplesPerPixel(doc) - offset);
  });
  render(engine.get("document"));

  const marquee = document.createElement("div");
  marquee.className = "fw-marquee";
  marquee.hidden = true;
  lanes.append(marquee);
  let box: { x0: number; y0: number; base: Set<string>; moved: boolean } | null = null;
  let swallowClick = false;
  lanes.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    },
    true,
  );

  const updateMarquee = (e: PointerEvent) => {
    if (!box) return;
    const r = lanes.getBoundingClientRect();
    const x1 = e.clientX - r.left;
    const y1 = e.clientY - r.top;
    if (!box.moved && Math.hypot(x1 - box.x0, y1 - box.y0) < 4) return;
    if (!box.moved) lanes.setPointerCapture(e.pointerId);
    box.moved = true;
    const left = Math.min(box.x0, x1);
    const top = Math.min(box.y0, y1);
    const width = Math.abs(x1 - box.x0);
    const height = Math.abs(y1 - box.y0);
    if (marquee.hidden) marquee.hidden = false;
    marquee.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    marquee.style.width = `${width.toFixed(1)}px`;
    marquee.style.height = `${height.toFixed(1)}px`;
    selectedClipIds.clear();
    for (const id of box.base) selectedClipIds.add(id);
    for (const clipNode of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const c = clipNode.getBoundingClientRect();
      const hit = c.right > r.left + left && c.left < r.left + left + width && c.bottom > r.top + top && c.top < r.top + top + height;
      if (hit && clipNode.dataset.key) selectedClipIds.add(clipNode.dataset.key);
    }
    markSelected();
  };

  const endMarquee = () => {
    if (!box) return;
    if (box.moved) {
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      }, 0);
    }
    box = null;
    if (!marquee.hidden) marquee.hidden = true;
  };

  const markSelected = () => {
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const on = String(node.dataset.key !== undefined && selectedClipIds.has(node.dataset.key));
      if (node.getAttribute("aria-selected") !== on) node.setAttribute("aria-selected", on);
    }
  };

  type GestureKind = "move" | "trim-left" | "trim-right" | "fade-in" | "fade-out" | "gain";
  type Member = { trackId: string; clip: Clip; node: HTMLElement };
  type Gesture = { kind: GestureKind; node: HTMLElement; trackId: string; clip: Clip; startX: number; startY: number; dx: number; dy: number; moved: boolean; low: number; high: number; group: Member[]; ripple: boolean; followers: Member[] };
  let drag: Gesture | null = null;
  const EDGE_PX = 6;

  const limits = (kind: GestureKind, clip: Clip, spp: number): [number, number] => {
    const doc = engine.get("document");
    const media = doc.media[clip.mediaId];
    const after = media ? Math.max(0, sessionLength(media, doc.sampleRate) - clip.sourceIn - clip.length) : 0;
    const fadeIn = clip.fadeIn ?? 0;
    const fadeOut = clip.fadeOut ?? 0;
    switch (kind) {
      case "move":
        return [-clip.start / spp, Infinity];
      case "trim-left":
        return [-Math.min(clip.start, clip.sourceIn) / spp, (clip.length - 1) / spp];
      case "trim-right":
        return [-(clip.length - 1) / spp, after / spp];
      case "fade-in":
        return [-fadeIn / spp, (clip.length - fadeOut - fadeIn) / spp];
      case "fade-out":
        return [-(clip.length - fadeIn - fadeOut) / spp, fadeOut / spp];
      case "gain":
        return [-Infinity, Infinity];
    }
  };

  lanes.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    const node = target.closest<HTMLElement>(".fw-clip");
    const trackId = node?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!node || !trackId || !node.dataset.key || e.button !== 0) {
      if (e.button === 0 && target.closest(".fw-lane-body")) {
        const r = lanes.getBoundingClientRect();
        box = { x0: e.clientX - r.left, y0: e.clientY - r.top, base: new Set(e.shiftKey ? selectedClipIds : []), moved: false };
        e.preventDefault();
      }
      if (selectedClipIds.size && !e.shiftKey && !target.closest(".fw-lane-head")) {
        selectedClipIds.clear();
        markSelected();
      }
      return;
    }
    const clip = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === node.dataset.key);
    if (!clip) return;
    const rect = node.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const kind: GestureKind = target.classList.contains("fw-gain-line")
      ? "gain"
      : target.classList.contains("fw-fade-in")
        ? "fade-in"
        : target.classList.contains("fw-fade-out")
          ? "fade-out"
          : x < EDGE_PX
            ? "trim-left"
            : x > rect.width - EDGE_PX
              ? "trim-right"
              : "move";
    if (e.shiftKey && kind === "move") {
      if (selectedClipIds.has(clip.id)) selectedClipIds.delete(clip.id);
      else selectedClipIds.add(clip.id);
      markSelected();
      e.preventDefault();
      return;
    }
    if (!selectedClipIds.has(clip.id)) {
      selectedClipIds.clear();
      selectedClipIds.add(clip.id);
    }
    markSelected();
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    let [low, high] = limits(kind, clip, spp);
    const group: Member[] = [{ trackId, clip, node }];
    if (kind === "move" || kind === "fade-in" || kind === "fade-out" || kind === "gain") {
      for (const track of doc.tracks) {
        for (const other of track.clips) {
          if (other.id === clip.id || !selectedClipIds.has(other.id)) continue;
          const otherNode = lanes.querySelector<HTMLElement>(`.fw-clip[data-key="${other.id}"]`);
          if (!otherNode) continue;
          group.push({ trackId: track.id, clip: other, node: otherNode });
          const [otherLow, otherHigh] = limits(kind, other, spp);
          low = Math.max(low, otherLow);
          high = Math.min(high, otherHigh);
        }
      }
    }
    const ripple = shuffleEnabled() && (kind === "trim-left" || kind === "trim-right");
    const followers: Member[] = [];
    if (ripple) {
      const end = clip.start + clip.length;
      for (const other of doc.tracks.find((t) => t.id === trackId)?.clips ?? []) {
        if (other.id === clip.id || other.start < end) continue;
        const otherNode = lanes.querySelector<HTMLElement>(`.fw-clip[data-key="${other.id}"]`);
        if (otherNode) followers.push({ trackId, clip: other, node: otherNode });
      }
    }
    drag = { kind, node, trackId, clip, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, low, high, group, ripple, followers };
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  const shiftGain = (db: number, delta: number) => Math.round(Math.min(GAIN_TOP_DB, Math.max(GAIN_TOP_DB - GAIN_SPAN_DB, db + delta)) * 10) / 10;

  const preview = (d: Gesture, spp: number) => {
    if (d.kind === "gain") {
      const delta = dragGain(d.clip.gainDb, d.dy, d.node.clientHeight) - d.clip.gainDb;
      for (const m of d.group) {
        const line = m.node.querySelector<HTMLElement>(".fw-gain-line");
        if (!line) continue;
        const db = shiftGain(m.clip.gainDb, delta);
        line.style.transform = `translateY(${((gainFraction(db) - gainFraction(m.clip.gainDb)) * m.node.clientHeight).toFixed(1)}px)`;
        line.dataset.db = gainLabel(db);
      }
      return;
    }
    const shift = `translateX(${d.dx.toFixed(1)}px)`;
    if (d.kind === "move") for (const member of d.group) member.node.style.transform = shift;
    else if (d.kind === "trim-left") {
      if (!d.ripple) d.node.style.transform = shift;
      d.node.style.width = `${Math.max(1, d.clip.length / spp - d.dx).toFixed(2)}px`;
      for (const f of d.followers) f.node.style.transform = `translateX(${(-d.dx).toFixed(1)}px)`;
    } else if (d.kind === "trim-right") {
      d.node.style.width = `${Math.max(1, d.clip.length / spp + d.dx).toFixed(2)}px`;
      for (const f of d.followers) f.node.style.transform = shift;
    }
    else {
      for (const m of d.group) {
        const handle = m.node.querySelector<HTMLElement>(d.kind === "fade-in" ? ".fw-fade-in" : ".fw-fade-out");
        const base = d.kind === "fade-in" ? (m.clip.fadeIn ?? 0) / spp : -(m.clip.fadeOut ?? 0) / spp;
        if (handle) handle.style.transform = `translateX(${(base + d.dx).toFixed(2)}px)`;
      }
    }
  };

  const restore = (d: Gesture) => {
    for (const member of d.group) member.node.style.transform = "";
    for (const f of d.followers) f.node.style.transform = "";
    if (d.node.dataset.width) d.node.style.width = d.node.dataset.width;
    for (const m of d.group) {
      for (const handle of m.node.querySelectorAll<HTMLElement>(".fw-fade-handle")) handle.style.transform = handle.dataset.tx ?? "";
      const line = m.node.querySelector<HTMLElement>(".fw-gain-line");
      if (line) {
        line.style.transform = "";
        line.dataset.db = gainLabel(m.clip.gainDb);
      }
    }
  };

  const commit = (d: Gesture, spp: number) => {
    if (d.kind === "gain") {
      const delta = dragGain(d.clip.gainDb, d.dy, d.node.clientHeight) - d.clip.gainDb;
      engine.dispatch({
        type: "batch",
        commands: d.group.map((m) => ({ type: "set-clip-gain" as const, trackId: m.trackId, clipId: m.clip.id, gainDb: shiftGain(m.clip.gainDb, delta) })),
      });
      return;
    }
    const delta = Math.round(d.dx * spp);
    const c = d.clip;
    const ids = { trackId: d.trackId, clipId: c.id };
    if (d.kind === "move")
      engine.dispatch({
        type: "batch",
        commands: d.group.map((m) => ({ type: "move-clip" as const, trackId: m.trackId, clipId: m.clip.id, start: m.clip.start + delta })),
      });
    else if (d.kind === "trim-left" || d.kind === "trim-right") {
      const left = d.kind === "trim-left";
      const bounds = {
        type: "set-clip-bounds" as const,
        ...ids,
        start: left && !d.ripple ? c.start + delta : c.start,
        sourceIn: left ? c.sourceIn + delta : c.sourceIn,
        length: left ? c.length - delta : c.length + delta,
      };
      const shiftBy = left ? -delta : delta;
      const moves = d.ripple ? d.followers.map((f) => ({ type: "move-clip" as const, trackId: f.trackId, clipId: f.clip.id, start: f.clip.start + shiftBy })) : [];
      engine.dispatch({ type: "batch", commands: [bounds, ...moves] });
    }
    else
      engine.dispatch({
        type: "batch",
        commands: d.group.map((m) => ({
          type: "set-clip-fades" as const,
          trackId: m.trackId,
          clipId: m.clip.id,
          fadeIn: (m.clip.fadeIn ?? 0) + (d.kind === "fade-in" ? delta : 0),
          fadeOut: (m.clip.fadeOut ?? 0) - (d.kind === "fade-out" ? delta : 0),
        })),
      });
  };

  lanes.addEventListener("pointermove", (e) => {
    if (box) {
      updateMarquee(e);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(drag.kind === "gain" ? dy : dx) < 3) return;
    drag.moved = true;
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    if (drag.kind === "gain") {
      drag.dy = dy;
      preview(drag, spp);
      return;
    }
    let next = Math.min(drag.high, Math.max(drag.low, dx));
    const anchor =
      drag.kind === "move" || drag.kind === "trim-left" ? drag.clip.start : drag.kind === "trim-right" ? drag.clip.start + drag.clip.length : null;
    if (anchor !== null && gridEnabled()) {
      const snapped = snapSamples(anchor + next * spp, doc.sampleRate, doc.sampleRate / spp);
      next = Math.min(drag.high, Math.max(drag.low, (snapped - anchor) / spp));
    }
    drag.dx = next;
    preview(drag, spp);
  });

  const endDrag = (apply: boolean) => {
    const d = drag;
    drag = null;
    if (!d || !d.moved) return;
    restore(d);
    if (apply) commit(d, samplesPerPixel(engine.get("document")));
  };
  lanes.addEventListener("pointerup", () => {
    endMarquee();
    endDrag(true);
  });
  lanes.addEventListener("pointercancel", () => {
    endMarquee();
    endDrag(false);
  });

  type Dispatchable = Parameters<Engine["dispatch"]>[0];
  let clipboard: { trackId: string; clip: Clip }[] = [];
  const selectedClips = () =>
    engine
      .get("document")
      .tracks.flatMap((t) => t.clips.filter((c) => selectedClipIds.has(c.id)).map((c) => ({ trackId: t.id, clip: c })));

  const removalCommands = (removed: { trackId: string; clip: Clip }[]): Dispatchable[] => {
    const commands: Dispatchable[] = removed.map(({ trackId, clip }) => ({ type: "remove-clip" as const, trackId, clipId: clip.id }));
    if (!shuffleEnabled()) return commands;
    for (const track of engine.get("document").tracks) {
      const gone = removed.filter((r) => r.trackId === track.id).map((r) => r.clip);
      if (!gone.length) continue;
      for (const clip of track.clips) {
        if (gone.some((g) => g.id === clip.id)) continue;
        const shift = gone.filter((g) => g.start < clip.start).reduce((sum, g) => sum + g.length, 0);
        if (shift) commands.push({ type: "move-clip", trackId: track.id, clipId: clip.id, start: clip.start - shift });
      }
    }
    return commands;
  };

  const paste = () => {
    const doc = engine.get("document");
    const targets = clipboard.filter((c) => doc.tracks.some((t) => t.id === c.trackId));
    if (!targets.length) return;
    const at = engine.get("transport").positionSamples;
    const origin = Math.min(...targets.map((c) => c.clip.start));
    const span = Math.max(...targets.map((c) => c.clip.start + c.clip.length)) - origin;
    const commands: Dispatchable[] = [];
    if (shuffleEnabled()) {
      for (const trackId of new Set(targets.map((c) => c.trackId))) {
        for (const clip of doc.tracks.find((t) => t.id === trackId)?.clips ?? []) {
          if (clip.start >= at) commands.push({ type: "move-clip", trackId, clipId: clip.id, start: clip.start + span });
        }
      }
    }
    for (const { trackId, clip } of targets) {
      commands.push({
        type: "paste-clip",
        trackId,
        clip: {
          mediaId: clip.mediaId,
          start: at + clip.start - origin,
          length: clip.length,
          sourceIn: clip.sourceIn,
          gainDb: clip.gainDb,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          fadeShape: clip.fadeShape,
        },
      });
    }
    const before = new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    engine.dispatch({ type: "batch", commands });
    selectedClipIds.clear();
    for (const track of engine.get("document").tracks) for (const clip of track.clips) if (!before.has(clip.id)) selectedClipIds.add(clip.id);
    markSelected();
  };

  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        for (const track of engine.get("document").tracks) for (const clip of track.clips) selectedClipIds.add(clip.id);
        markSelected();
        return;
      }
      if (key === "c" || key === "x") {
        const chosen = selectedClips();
        if (!chosen.length) return;
        e.preventDefault();
        clipboard = chosen.map(({ trackId, clip }) => ({ trackId, clip: { ...clip } }));
        if (key === "x") {
          selectedClipIds.clear();
          engine.dispatch({ type: "batch", commands: removalCommands(chosen) });
        }
        return;
      }
      if (key === "v" && clipboard.length) {
        e.preventDefault();
        paste();
        return;
      }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const selection = selectedClips;
    if (e.key === "=" || e.key === "+") setZoom(zoom * 2);
    else if (e.key === "-") setZoom(zoom / 2);
    else if (e.key === "0") setZoom(1);
    else if (e.key.toLowerCase() === "s" && selectedClipIds.size) {
      const at = engine.get("transport").positionSamples;
      const commands = selection()
        .filter(({ clip }) => at > clip.start && at < clip.start + clip.length)
        .map(({ trackId, clip }) => ({ type: "split-clip" as const, trackId, clipId: clip.id, at }));
      if (commands.length) engine.dispatch({ type: "batch", commands });
    } else if ((e.key === "Delete" || e.key === "Backspace") && selectedClipIds.size) {
      const commands = removalCommands(selection());
      selectedClipIds.clear();
      if (commands.length) engine.dispatch({ type: "batch", commands });
    } else if (e.key === "Escape" && selectedClipIds.size) {
      selectedClipIds.clear();
      markSelected();
    } else return;
    e.preventDefault();
  });
}
