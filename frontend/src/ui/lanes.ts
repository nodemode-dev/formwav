import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import { documentLength } from "../engine/document";
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
  node.append(canvas);
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

  let drag: { node: HTMLElement; trackId: string; clipId: string; startX: number; origin: number; dx: number; moved: boolean } | null = null;

  lanes.addEventListener("pointerdown", (e) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>(".fw-clip");
    const trackId = node?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!node || !trackId || !node.dataset.key || e.button !== 0) {
      if (selectedClipId !== null && !(e.target as HTMLElement).closest(".fw-lane-head")) {
        selectedClipId = null;
        markSelected();
      }
      return;
    }
    const clip = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === node.dataset.key);
    if (!clip) return;
    selectedClipId = clip.id;
    markSelected();
    drag = { node, trackId, clipId: clip.id, startX: e.clientX, origin: clip.start, dx: 0, moved: false };
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  lanes.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    drag.dx = Math.max(-drag.origin / samplesPerPixel(engine.get("document")), dx);
    drag.node.style.transform = `translateX(${drag.dx.toFixed(1)}px)`;
  });

  const endDrag = (commit: boolean) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved) d.node.style.transform = "";
    if (commit && d.moved) {
      const start = d.origin + d.dx * samplesPerPixel(engine.get("document"));
      engine.dispatch({ type: "move-clip", trackId: d.trackId, clipId: d.clipId, start });
    }
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
