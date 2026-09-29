import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import { documentLength, sessionLength } from "../engine/document";
import { fetchPeaks, type PeakData } from "../io/media-client";
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
let selectedClipId: string | null = null;
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
      const top = mid - Math.min(1, hi) * half;
      const bottom = mid - Math.max(-1, lo) * half;
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

function clipNode(): HTMLElement {
  const node = document.createElement("div");
  node.className = "fw-clip";
  const canvas = document.createElement("canvas");
  canvas.className = "fw-wave";
  const fadeIn = document.createElement("span");
  fadeIn.className = "fw-fade-handle fw-fade-in";
  const fadeOut = document.createElement("span");
  fadeOut.className = "fw-fade-handle fw-fade-out";
  node.append(canvas, fadeIn, fadeOut);
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
  const selected = String(clip.id === selectedClipId);
  if (node.getAttribute("aria-selected") !== selected) node.setAttribute("aria-selected", selected);
  const handles: [string, string][] = [
    [".fw-fade-in", `translateX(${((clip.fadeIn ?? 0) / spp).toFixed(2)}px)`],
    [".fw-fade-out", `translateX(${(-(clip.fadeOut ?? 0) / spp).toFixed(2)}px)`],
  ];
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
  onZoom(() => render(engine.get("document")));
  render(engine.get("document"));

  const markSelected = () => {
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const on = String(node.dataset.key === selectedClipId);
      if (node.getAttribute("aria-selected") !== on) node.setAttribute("aria-selected", on);
    }
  };

  type GestureKind = "move" | "trim-left" | "trim-right" | "fade-in" | "fade-out";
  type Gesture = { kind: GestureKind; node: HTMLElement; trackId: string; clip: Clip; startX: number; dx: number; moved: boolean; low: number; high: number };
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
    }
  };

  lanes.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    const node = target.closest<HTMLElement>(".fw-clip");
    const trackId = node?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!node || !trackId || !node.dataset.key || e.button !== 0) {
      if (selectedClipId !== null && !target.closest(".fw-lane-head")) {
        selectedClipId = null;
        markSelected();
      }
      return;
    }
    const clip = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === node.dataset.key);
    if (!clip) return;
    const box = node.getBoundingClientRect();
    const x = e.clientX - box.left;
    const kind: GestureKind = target.classList.contains("fw-fade-in")
      ? "fade-in"
      : target.classList.contains("fw-fade-out")
        ? "fade-out"
        : x < EDGE_PX
          ? "trim-left"
          : x > box.width - EDGE_PX
            ? "trim-right"
            : "move";
    const [low, high] = limits(kind, clip, samplesPerPixel(engine.get("document")));
    selectedClipId = clip.id;
    markSelected();
    drag = { kind, node, trackId, clip, startX: e.clientX, dx: 0, moved: false, low, high };
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  const preview = (d: Gesture, spp: number) => {
    const shift = `translateX(${d.dx.toFixed(1)}px)`;
    if (d.kind === "move") d.node.style.transform = shift;
    else if (d.kind === "trim-left") {
      d.node.style.transform = shift;
      d.node.style.width = `${Math.max(1, d.clip.length / spp - d.dx).toFixed(2)}px`;
    } else if (d.kind === "trim-right") d.node.style.width = `${Math.max(1, d.clip.length / spp + d.dx).toFixed(2)}px`;
    else {
      const handle = d.node.querySelector<HTMLElement>(d.kind === "fade-in" ? ".fw-fade-in" : ".fw-fade-out");
      const base = d.kind === "fade-in" ? (d.clip.fadeIn ?? 0) / spp : -(d.clip.fadeOut ?? 0) / spp;
      if (handle) handle.style.transform = `translateX(${(base + d.dx).toFixed(2)}px)`;
    }
  };

  const restore = (d: Gesture) => {
    d.node.style.transform = "";
    if (d.node.dataset.width) d.node.style.width = d.node.dataset.width;
    for (const handle of d.node.querySelectorAll<HTMLElement>(".fw-fade-handle")) handle.style.transform = handle.dataset.tx ?? "";
  };

  const commit = (d: Gesture, spp: number) => {
    const delta = Math.round(d.dx * spp);
    const c = d.clip;
    const ids = { trackId: d.trackId, clipId: c.id };
    if (d.kind === "move") engine.dispatch({ type: "move-clip", ...ids, start: c.start + delta });
    else if (d.kind === "trim-left") engine.dispatch({ type: "set-clip-bounds", ...ids, start: c.start + delta, sourceIn: c.sourceIn + delta, length: c.length - delta });
    else if (d.kind === "trim-right") engine.dispatch({ type: "set-clip-bounds", ...ids, start: c.start, sourceIn: c.sourceIn, length: c.length + delta });
    else if (d.kind === "fade-in") engine.dispatch({ type: "set-clip-fades", ...ids, fadeIn: (c.fadeIn ?? 0) + delta, fadeOut: c.fadeOut ?? 0 });
    else engine.dispatch({ type: "set-clip-fades", ...ids, fadeIn: c.fadeIn ?? 0, fadeOut: (c.fadeOut ?? 0) - delta });
  };

  lanes.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    drag.dx = Math.min(drag.high, Math.max(drag.low, dx));
    preview(drag, samplesPerPixel(engine.get("document")));
  });

  const endDrag = (apply: boolean) => {
    const d = drag;
    drag = null;
    if (!d || !d.moved) return;
    restore(d);
    if (apply) commit(d, samplesPerPixel(engine.get("document")));
  };
  lanes.addEventListener("pointerup", () => endDrag(true));
  lanes.addEventListener("pointercancel", () => endDrag(false));

  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "=" || e.key === "+") setZoom(zoom * 2);
    else if (e.key === "-") setZoom(zoom / 2);
    else if (e.key === "0") setZoom(1);
    else if (e.key.toLowerCase() === "s" && selectedClipId) {
      const clipId = selectedClipId;
      const track = engine.get("document").tracks.find((t) => t.clips.some((c) => c.id === clipId));
      if (track) engine.dispatch({ type: "split-clip", trackId: track.id, clipId, at: engine.get("transport").positionSamples });
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && selectedClipId) {
      const clipId = selectedClipId;
      const track = engine.get("document").tracks.find((t) => t.clips.some((c) => c.id === clipId));
      selectedClipId = null;
      if (track) engine.dispatch({ type: "remove-clip", trackId: track.id, clipId });
    } else if (e.key === "Escape" && selectedClipId) {
      selectedClipId = null;
      markSelected();
    } else return;
    e.preventDefault();
  });
}
