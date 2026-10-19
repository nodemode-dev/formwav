import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import { documentLength, fadeCurve, groupPeers, nextFadeShape, sessionLength, type AutoPoint, type SessionView } from "../engine/document";
import { copyRange, pasteRange, type RangeClip } from "../engine/editing";
import { renderNotes } from "../audio/notes";
import { icon as fcIcon } from "../vendor/formcut/icons";
import { fetchPeaks, type PeakData } from "../io/media-client";
import { gridEnabled, shuffleEnabled, snapSamples, spotEnabled } from "./grid";
import { armedTracks, isArmed, onArm, setArmedTrack, toggleArmed } from "./arm";
import { spectralHz } from "./spectrogram-view";
import { patchList, setText } from "../vendor/nodemode/dom-stable";

const PEAK_SPP = 256;
// AU-13: with the ruler and waveform canvases covering only the view, the timeline is laid out up to 16 million px
// (under every browser's largest layout size), enough for single samples on sessions up to about five minutes at 48 kHz
const MAX_TIMELINE_PX = 16_000_000;
// Below this many frames a device pixel, the lanes draw the real samples of what is in view (fetched in chunks)
const RAW_BELOW = 16;
const RAW_CHUNK = 8192;
const rawChunks = new Map<string, Float32Array[]>();
const rawPending = new Set<string>();

/** AU-13: the stroke the pencil is drawing (frames of the media to their values), shown before it is applied. */
let drawPreview: { mediaId: string; channel: number; values: Map<number, number> } | null = null;

export function setDrawPreview(preview: { mediaId: string; channel: number; values: Map<number, number> } | null): void {
  drawPreview = preview;
}

/** A sample of media `id` from the chunks already fetched (0 where none is). */
export function sampleAt(id: string, channel: number, frame: number): number {
  const ci = Math.floor(frame / RAW_CHUNK);
  const chunk = rawChunks.get(`${id}:${ci}`);
  const data = chunk?.[Math.min(channel, (chunk?.length ?? 1) - 1)];
  return data ? data[frame - ci * RAW_CHUNK] ?? 0 : 0;
}

/** Repaints every clip showing media `id` (a stroke's preview as it grows). */
export function repaintMedia(id: string): void {
  for (const c of viewStage?.querySelectorAll<HTMLCanvasElement>(".fw-clip .fw-wave") ?? []) {
    if (paintInfo.get(c)?.media.id === id) schedulePaint(c, id);
  }
}

/** The samples of media `id` from `first` for `count` frames, if every chunk is here; otherwise null, the missing chunks
 *  fetched and `canvas` repainted when each arrives. */
function rawWindow(id: string, first: number, count: number, canvas: HTMLCanvasElement): ((channel: number, frame: number) => number) | null {
  const c0 = Math.max(0, Math.floor(first / RAW_CHUNK));
  const c1 = Math.max(c0, Math.floor((first + count) / RAW_CHUNK));
  let ready = true;
  for (let ci = c0; ci <= c1; ci++) {
    const key = `${id}:${ci}`;
    if (rawChunks.has(key)) continue;
    ready = false;
    if (rawPending.has(key)) continue;
    rawPending.add(key);
    fetch(`/api/media/${id}/samples?start=${ci * RAW_CHUNK}&count=${RAW_CHUNK}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((out: { channels: number[][] }) => {
        rawChunks.set(key, out.channels.map((ch) => Float32Array.from(ch)));
        // the most recent 512 chunks are kept (16 to 32 MB), the oldest let go first
        for (const old of rawChunks.keys()) {
          if (rawChunks.size <= 512) break;
          rawChunks.delete(old);
        }
        const info = paintInfo.get(canvas);
        if (info) schedulePaint(canvas, info.media.id);
      })
      .catch(() => undefined)
      .finally(() => rawPending.delete(key));
  }
  if (!ready) return null;
  return (channel, frame) => {
    // AU-13: a stroke being drawn shows over the stored samples until it is applied
    if (drawPreview && drawPreview.mediaId === id && drawPreview.channel === channel) {
      const drawn = drawPreview.values.get(frame);
      if (drawn !== undefined) return drawn;
    }
    const ci = Math.floor(frame / RAW_CHUNK);
    const chunk = rawChunks.get(`${id}:${ci}`);
    const data = chunk?.[Math.min(channel, (chunk?.length ?? 1) - 1)];
    return data ? data[frame - ci * RAW_CHUNK] ?? 0 : 0;
  };
}
const BASE_PX_PER_SECOND = 100;

interface PaintInfo {
  clip: Clip;
  media: MediaRef;
  sessionRate: number;
  spp: number;
}

const peakCache = new Map<string, Promise<PeakData>>();
const paintInfo = new WeakMap<HTMLCanvasElement, PaintInfo>();

/** Each media's peaks once they have arrived, so a page turn can repaint in the same frame (AU-13). */
const peakReady = new Map<string, PeakData>();

function peaksFor(id: string): Promise<PeakData> {
  let pending = peakCache.get(id);
  if (!pending) {
    pending = fetchPeaks(id, PEAK_SPP);
    peakCache.set(id, pending);
    pending.then((peaks) => peakReady.set(id, peaks)).catch(() => peakCache.delete(id));
  }
  return pending;
}

const ZOOM_MIN = 0.25;
// AU-13: up from 16 (30 samples a pixel at 48 kHz) to 8000: about 17 pixels a sample at 48 kHz, 8 at 96 kHz
const ZOOM_MAX = 8000;
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

// AU-34: the stage the lanes scroll in, kept for currentView
let viewStage: HTMLElement | null = null;

/** AU-34: the view to save with a session: the zoom factor, the lanes' left edge in seconds, the time selection. */
export function currentView(engine: Engine): SessionView {
  const doc = engine.get("document");
  const sel = engine.get("selection");
  const scroll = viewStage ? (viewStage.scrollLeft * samplesPerPixel(doc)) / doc.sampleRate : 0;
  return { zoom, scrollSeconds: Math.round(scroll * 1000) / 1000, ...(sel && sel.end > sel.start ? { selection: { start: sel.start, end: sel.end } } : {}) };
}

export function onZoom(listener: () => void): void {
  zoomListeners.add(listener);
}

export function samplesPerPixel(doc: SessionDoc): number {
  // AU-13: the cap's floor a plain ratio: rounded up, it held every session at one sample a pixel at least
  return Math.max(doc.sampleRate / (BASE_PX_PER_SECOND * zoom), documentLength(doc) / MAX_TIMELINE_PX);
}

/** The lanes zoomed so start to end (samples) fills the part of the stage in view, scrolled to it, 12 px either side. */
export function zoomToSpan(doc: SessionDoc, start: number, end: number): void {
  const stage = viewStage;
  if (!stage || !(end > start)) return;
  const head = stage.querySelector<HTMLElement>(".fw-ruler-corner")?.offsetWidth ?? 0;
  const view = stage.clientWidth - head - 24;
  if (view <= 0) return;
  setZoom((doc.sampleRate * view) / (BASE_PX_PER_SECOND * (end - start)));
  stage.scrollLeft = Math.max(0, start / samplesPerPixel(doc) - 12);
}

function channelLabel(n: number): string {
  return n === 1 ? "mono" : n === 2 ? "stereo" : `${n} channels`;
}

function paint(canvas: HTMLCanvasElement, peaks: PeakData): void {
  const info = paintInfo.get(canvas);
  if (!info || !canvas.isConnected) return;
  const dpr = window.devicePixelRatio || 1;
  // AU-13: the canvas covers only the part of its clip in view (at deep zoom a clip is far wider than a canvas can
  // be); what follows maps through the clip's whole width (full) and the window's offset into it (off)
  const node = canvas.parentElement;
  const box = node?.getBoundingClientRect();
  const stageBox = viewStage?.getBoundingClientRect();
  if (!node || !box || !viewStage || !stageBox) return;
  const head = viewStage.querySelector<HTMLElement>(".fw-ruler-corner")?.offsetWidth ?? 0;
  const from = Math.max(box.left, stageBox.left + head);
  const to = Math.min(box.right, stageBox.left + viewStage.clientWidth);
  const cssW = Math.max(0, to - from);
  const offCss = Math.max(0, from - box.left);
  // placed by a transform, so its place moving inside the clip as the view pages is never a layout shift (a left
  // offset was one, at a page turn that brought a clip's start out of view)
  const shiftStyle = `translateX(${offCss}px)`;
  const widthStyle = `${Math.max(1, cssW)}px`;
  if (canvas.style.transform !== shiftStyle) canvas.style.transform = shiftStyle;
  if (canvas.style.width !== widthStyle) canvas.style.width = widthStyle;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const full = Math.max(1, node.clientWidth * dpr);
  const off = offCss * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(canvas).color;
  const notes = info.clip.notes;
  const sourceFrames = (info.clip.length * info.media.sampleRate) / info.sessionRate;
  if (notes && notes.length) {
    // a note clip draws its notes, a small piano roll over at least an octave, rather than its rendering's waveform
    let lowest = 127;
    let highest = 0;
    for (const n of notes) {
      lowest = Math.min(lowest, n.pitch);
      highest = Math.max(highest, n.pitch);
    }
    const rows = Math.max(12, highest - lowest + 1);
    const base = lowest - Math.floor((rows - (highest - lowest + 1)) / 2);
    const noteH = h / rows;
    const pxPerFrame = full / sourceFrames;
    for (const n of notes) {
      const x0 = (n.at - info.clip.sourceIn) * pxPerFrame - off;
      const x1 = (n.at + n.length - info.clip.sourceIn) * pxPerFrame - off;
      if (x1 < 0 || x0 > w) continue;
      ctx.globalAlpha = 0.4 + 0.6 * (n.velocity / 127);
      ctx.fillRect(Math.max(0, x0), h - (n.pitch - base + 1) * noteH + 1, Math.max(2, Math.min(w, x1) - Math.max(0, x0)), Math.max(2, noteH - 2));
    }
    ctx.globalAlpha = 1;
  }
  const ch = Math.max(1, peaks.channels);
  const stride = ch * 2;
  const blocksPerPx = sourceFrames / full / peaks.samplesPerPeak;
  const startBlock = info.clip.sourceIn / peaks.samplesPerPeak + off * blocksPerPx;
  const rowH = h / ch;
  const half = (rowH / 2) * 0.9;
  const clipGain = 10 ** (info.clip.gainDb / 20);
  const drawWave = !(notes && notes.length);
  // AU-13: zoomed in past the overview, the samples themselves (the overview drawn meanwhile, until they arrive)
  const fpp = sourceFrames / full; // the media's frames a device pixel
  const first = info.clip.sourceIn + off * fpp;
  const raw = drawWave && fpp < RAW_BELOW ? rawWindow(info.media.id, Math.floor(first), Math.ceil(w * fpp) + 2, canvas) : null;
  if (raw) {
    const total = info.media.frames;
    for (let c = 0; c < ch; c++) {
      const mid = rowH * c + rowH / 2;
      const yOf = (v: number) => mid - Math.max(-1, Math.min(1, v * clipGain)) * half;
      if (fpp >= 1) {
        // still several frames a pixel: each pixel's own minimum and maximum, exact
        for (let x = 0; x < w; x++) {
          const k0 = Math.floor(first + x * fpp);
          const k1 = Math.min(total, Math.max(k0 + 1, Math.floor(first + (x + 1) * fpp)));
          let lo = Infinity;
          let hi = -Infinity;
          for (let k = k0; k < k1; k++) {
            const v = raw(c, k);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          if (hi < lo) continue;
          const top = yOf(hi);
          ctx.fillRect(x, top, 1, Math.max(1, yOf(lo) - top));
        }
        continue;
      }
      // fewer frames than pixels: a line through the samples, and a dot on each once they stand 6 px apart
      const k0 = Math.max(0, Math.floor(first));
      const k1 = Math.min(total - 1, Math.ceil(first + w * fpp));
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const x = (k - first) / fpp;
        if (k === k0) ctx.moveTo(x, yOf(raw(c, k)));
        else ctx.lineTo(x, yOf(raw(c, k)));
      }
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.stroke();
      if (1 / fpp >= 6 * dpr) {
        const r = 1.5 * dpr;
        for (let k = k0; k <= k1; k++) ctx.fillRect((k - first) / fpp - r, yOf(raw(c, k)) - r, 2 * r, 2 * r);
      }
    }
  }
  for (let x = 0; drawWave && !raw && x < w; x++) {
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
  const curve = (v: number, rising: boolean) => fadeCurve(v, rising ? clip.fadeShape : (clip.fadeOutShape ?? clip.fadeShape));
  const style = getComputedStyle(canvas);
  const pxPerSample = full / clip.length;
  // AU-13: the curve traced only across the pixels in view (a fade at deep zoom can span millions of them)
  const envelope = (from: number, span: number, rising: boolean) => {
    const a = Math.max(from, 0);
    const b = Math.min(from + span, w);
    if (b <= a || span <= 0) return false;
    ctx.beginPath();
    ctx.moveTo(a, 0);
    const steps = Math.max(2, Math.ceil(b - a));
    for (let i = 0; i <= steps; i++) {
      const x = a + ((b - a) * i) / steps;
      const v = (x - from) / span;
      ctx.lineTo(x, h * (1 - curve(rising ? v : 1 - v, rising)));
    }
    ctx.lineTo(b, 0);
    ctx.closePath();
    return true;
  };
  ctx.fillStyle = style.outlineColor;
  ctx.globalAlpha = 0.6;
  if (fadeIn > 0 && envelope(-off, fadeIn * pxPerSample, true)) {
    ctx.fill();
  }
  if (fadeOut > 0 && envelope(full - fadeOut * pxPerSample - off, fadeOut * pxPerSample, false)) {
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function schedulePaint(canvas: HTMLCanvasElement, mediaId: string): void {
  peaksFor(mediaId)
    .then((peaks) => requestAnimationFrame(() => paint(canvas, peaks)))
    .catch(() => undefined);
}

export const GAIN_TOP_DB = 12;
export const GAIN_SPAN_DB = 48;

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
  fadeIn.title = "Drag to set the fade-in; click to change its curve";
  const fadeOut = document.createElement("span");
  fadeOut.className = "fw-fade-handle fw-fade-out";
  fadeOut.title = "Drag to set the fade-out; click to change its curve";
  const gain = document.createElement("span");
  gain.className = "fw-gain-line";
  const env = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  env.setAttribute("class", "fw-clip-env");
  env.setAttribute("viewBox", "0 0 1000 100");
  env.setAttribute("preserveAspectRatio", "none");
  env.setAttribute("aria-hidden", "true");
  env.append(document.createElementNS("http://www.w3.org/2000/svg", "polyline"));
  const takeBadge = document.createElement("button");
  takeBadge.type = "button";
  takeBadge.className = "fw-take";
  takeBadge.hidden = true;
  takeBadge.title = "Loop-recorded takes: click to play the next one";
  const name = document.createElement("span");
  name.className = "fw-clip-name";
  name.setAttribute("aria-hidden", "true");
  const by = document.createElement("span");
  by.className = "fw-clip-by";
  by.setAttribute("aria-hidden", "true");
  const lock = document.createElement("span");
  lock.className = "fw-clip-lock";
  lock.hidden = true;
  lock.innerHTML = fcIcon("lock");
  node.append(canvas, env, fadeIn, fadeOut, gain, takeBadge, name, by, lock);
  return node;
}

/** PT-09: a clip's warp markers as handles at their places in the clip, reused across renders. */
function syncWarpMarkers(node: HTMLElement, clip: Clip, spp: number): void {
  const markers = clip.warp?.markers ?? [];
  const els = [...node.querySelectorAll<HTMLElement>(":scope > .fw-warp-marker")];
  while (els.length > markers.length) els.pop()?.remove();
  while (els.length < markers.length) {
    const el = document.createElement("div");
    el.className = "fw-warp-marker";
    el.title = "Warp marker: drag to re-time the audio on either side of it; double-click to remove it";
    node.append(el);
    els.push(el);
  }
  markers.forEach((m, i) => {
    const el = els[i];
    if (el.dataset.index !== String(i)) el.dataset.index = String(i);
    const left = `${(m.dst / spp).toFixed(2)}px`;
    if (el.style.left !== left) el.style.left = left;
  });
}

function updateClip(node: HTMLElement, clip: Clip, doc: SessionDoc, spp: number): void {
  syncWarpMarkers(node, clip, spp);
  const clipColor = clip.color ? `var(--fw-color-${clip.color})` : "";
  if (node.style.getPropertyValue("--fw-clip-color") !== clipColor) node.style.setProperty("--fw-clip-color", clipColor);
  setText(node.querySelector(".fw-clip-name"), clip.name ?? (doc.media[clip.mediaId]?.name ?? "").replace(/\.[a-z0-9]+$/i, ""));
  const muted = String(!!clip.mute);
  if (node.dataset.mute !== muted) node.dataset.mute = muted;
  const lock = node.querySelector<HTMLElement>(".fw-clip-lock");
  if (lock) {
    if (lock.hidden === !!clip.lock) lock.hidden = !clip.lock;
    const title = clip.lock === "edit" ? "Edit-locked: no edit until it is unlocked" : clip.lock === "time" ? "Time-locked: it stays where it is in time" : "";
    if (lock.title !== title) lock.title = title;
  }
  const by = node.querySelector<HTMLElement>(".fw-clip-by");
  setText(by, clip.by === "agent" ? "Claude" : "you");
  if (by && by.dataset.by !== (clip.by ?? "you")) by.dataset.by = clip.by ?? "you";
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
  const badge = node.querySelector<HTMLButtonElement>(".fw-take");
  if (badge) {
    const count = clip.takes?.length ?? 0;
    const hide = count < 2;
    if (badge.hidden !== hide) badge.hidden = hide;
    const label = hide ? "" : `Take ${(clip.take ?? count - 1) + 1}/${count}`;
    if (badge.textContent !== label) badge.textContent = label;
  }
  const line = node.querySelector<HTMLElement>(".fw-gain-line");
  const envSvg = node.querySelector<SVGSVGElement>(".fw-clip-env");
  if (envSvg) {
    const pts = clip.envelope ?? [];
    const on = pts.length > 0;
    const shown = envSvg.getAttribute("data-on") === "true";
    if (shown !== on) envSvg.setAttribute("data-on", String(on));
    const path = on
      ? [
          `0,${(gainFraction(clip.gainDb + pts[0].db) * 100).toFixed(2)}`,
          ...pts.map((p) => `${(((p.at - clip.sourceIn) / Math.max(1, clip.length)) * 1000).toFixed(1)},${(gainFraction(clip.gainDb + p.db) * 100).toFixed(2)}`),
          `1000,${(gainFraction(clip.gainDb + pts[pts.length - 1].db) * 100).toFixed(2)}`,
        ].join(" ")
      : "";
    const poly = envSvg.firstElementChild;
    if (poly && poly.getAttribute("points") !== path) poly.setAttribute("points", path);
  }
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

/** A folder header (folder tracks): one per bus, before the first track routed to it. */
function folderNode(): HTMLElement {
  const row = document.createElement("div");
  row.className = "fw-folder";
  row.innerHTML = `<button type="button" class="fw-folder-toggle" aria-expanded="true"><span class="fw-folder-icon" aria-hidden="true"></span><span class="fw-folder-name"></span></button>`;
  return row;
}

function updateFolder(row: HTMLElement, bus: { id: string; name: string }, count: number, folded: boolean): void {
  const toggle = row.querySelector<HTMLButtonElement>(".fw-folder-toggle");
  const icon = row.querySelector<HTMLElement>(".fw-folder-icon");
  const expanded = String(!folded);
  if (toggle && (toggle.getAttribute("aria-expanded") !== expanded || !icon?.firstChild)) {
    toggle.setAttribute("aria-expanded", expanded);
    if (icon) icon.innerHTML = fcIcon(folded ? "chevR" : "chevD");
  }
  if (toggle && toggle.dataset.bus !== bus.id) toggle.dataset.bus = bus.id;
  setText(row.querySelector(".fw-folder-name"), `${bus.name} · ${count} ${count === 1 ? "track" : "tracks"}${folded ? " (folded)" : ""}`);
}

function laneNode(): HTMLElement {
  const lane = document.createElement("div");
  lane.className = "fw-lane";
  lane.innerHTML = `<div class="fw-lane-head"><span class="fw-lane-num" aria-hidden="true"></span><span class="fw-lane-name"></span><button type="button" class="fw-arm" aria-pressed="false" aria-label="Arm track for recording" title="Arm this track: recording goes into it at the playhead. Shift-click to arm several tracks at once">R</button><button type="button" class="fw-takes-toggle fw-icon-btn" hidden aria-expanded="false" aria-label="Takes and playlists" title="Show every take and every other playlist as a lane; drag across one to comp that range (a click on a playlist's clip comps the whole clip)">${fcIcon("layers")}</button><span class="fw-lane-meta"></span><div class="fw-lane-meter" aria-hidden="true"><div class="fw-out-track"><div class="fw-out-bar"></div></div><div class="fw-out-track"><div class="fw-out-bar"></div></div></div><div class="fw-lane-ms"><button type="button" class="fw-lane-mute fw-icon-btn" aria-pressed="false" aria-label="Mute" title="Mute this track">M</button><button type="button" class="fw-lane-solo fw-icon-btn" aria-pressed="false" aria-label="Solo" title="Solo this track">S</button></div><button type="button" class="fw-auto-toggle fw-icon-btn" aria-expanded="false" aria-label="Show automation" title="Show volume and pan automation: click a line to add a point, drag to move it, Alt-click to delete it">A</button></div><div class="fw-lane-body"></div><div class="fw-auto-heads" hidden aria-hidden="true"><span>Volume</span><span>Pan L / R</span><span class="fw-auto-fx-head" hidden><select class="fw-auto-fx" aria-label="Effect parameter to automate"></select></span></div><div class="fw-auto-rows" hidden><div class="fw-auto-row" data-param="volume" aria-label="Volume automation"><svg class="fw-auto-svg"><polyline class="fw-auto-line"></polyline><g class="fw-auto-points"></g></svg></div><div class="fw-auto-row" data-param="pan" aria-label="Pan automation, left at the top"><svg class="fw-auto-svg"><polyline class="fw-auto-line"></polyline><g class="fw-auto-points"></g></svg></div><div class="fw-auto-row" data-param="fx" data-fx="0" data-key="freq" aria-label="Effect parameter automation" hidden><svg class="fw-auto-svg"><polyline class="fw-auto-line"></polyline><g class="fw-auto-points"></g></svg></div></div><div class="fw-take-heads" hidden aria-hidden="true"></div><div class="fw-take-rows" hidden></div>`;
  return lane;
}

function updateLane(node: HTMLElement, track: Track, doc: SessionDoc, spp: number): void {
  setText(node.querySelector(".fw-lane-name"), track.name);
  // S5: the track's height (its waves painted again at the new size) and its comments as the head's tooltip
  const height = track.height ?? "medium";
  if ((node.dataset.height ?? "medium") !== height) {
    node.dataset.height = height;
    requestAnimationFrame(() => {
      for (const c of node.querySelectorAll<HTMLCanvasElement>(".fw-wave")) {
        const info = paintInfo.get(c);
        if (info) schedulePaint(c, info.media.id);
      }
    });
  }
  const head = node.querySelector<HTMLElement>(".fw-lane-head");
  if (head && head.title !== (track.comments ?? "")) head.title = track.comments ?? "";
  if ((node.dataset.inactive !== undefined) !== !!track.inactive) {
    if (track.inactive) node.dataset.inactive = "";
    else delete node.dataset.inactive;
  }
  setText(node.querySelector(".fw-lane-num"), String(doc.tracks.findIndex((t) => t.id === track.id) + 1).padStart(2, "0"));
  const laneColor = track.color ? `var(--fw-color-${track.color})` : "";
  if (node.style.getPropertyValue("--fw-lane-color") !== laneColor) node.style.setProperty("--fw-lane-color", laneColor);
  const arm = node.querySelector<HTMLElement>(".fw-arm");
  const armed = String(isArmed(track.id));
  if (arm && arm.getAttribute("aria-pressed") !== armed) arm.setAttribute("aria-pressed", armed);
  const first = track.clips[0];
  const media = first ? doc.media[first.mediaId] : undefined;
  const channels = channelLabel(track.channels);
  const fxCount = (track.fx ?? []).length;
  setText(node.querySelector(".fw-lane-meta"), `${track.inactive ? "Inactive, " : ""}${channels[0]?.toUpperCase() ?? ""}${channels.slice(1)}, ${fxCount === 0 ? "no effects" : fxCount === 1 ? "1 effect" : `${fxCount} effects`}`);
  node.querySelector(".fw-lane-meta")?.setAttribute("title", media ? `${media.format}, ${(media.sampleRate / 1000).toFixed(1)} kHz` : channels);
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
  const autoOpen = autoTracks.has(track.id);
  const muteButton = node.querySelector(".fw-lane-mute");
  if (muteButton && muteButton.getAttribute("aria-pressed") !== String(track.mute)) muteButton.setAttribute("aria-pressed", String(track.mute));
  const soloButton = node.querySelector(".fw-lane-solo");
  if (soloButton && soloButton.getAttribute("aria-pressed") !== String(track.solo)) soloButton.setAttribute("aria-pressed", String(track.solo));
  const autoToggle = node.querySelector<HTMLElement>(".fw-auto-toggle");
  if (autoToggle && autoToggle.getAttribute("aria-expanded") !== String(autoOpen)) autoToggle.setAttribute("aria-expanded", String(autoOpen));
  const autoRows = node.querySelector<HTMLElement>(".fw-auto-rows");
  const autoHeads = node.querySelector<HTMLElement>(".fw-auto-heads");
  if (autoHeads && autoHeads.hidden === autoOpen) autoHeads.hidden = !autoOpen;
  if (autoRows) {
    if (autoRows.hidden === autoOpen) autoRows.hidden = !autoOpen;
    if (autoOpen) {
      laneDoc = doc;
      syncFxRow(node, track);
      for (const row of autoRows.querySelectorAll<HTMLElement>(".fw-auto-row")) if (!row.hidden) drawAutoLane(row, track, rowScale(row), spp);
    }
  }
  const takeClips = track.clips.filter((c) => (c.takes?.length ?? 0) > 1);
  const count = takeClips.reduce((most, c) => Math.max(most, c.takes?.length ?? 0), 0);
  // S13: the track's other playlists show as lanes under its takes; dragging across one comps that span from it
  const lists = track.playlists ?? [];
  const open = count + lists.length > 0 && expandedTracks.has(track.id);
  const toggle = node.querySelector<HTMLButtonElement>(".fw-takes-toggle");
  if (toggle) {
    if (toggle.hidden !== (count + lists.length === 0)) toggle.hidden = count + lists.length === 0;
    if (toggle.getAttribute("aria-expanded") !== String(open)) toggle.setAttribute("aria-expanded", String(open));
  }
  const takeHeads = node.querySelector<HTMLElement>(".fw-take-heads");
  if (takeHeads) {
    if (takeHeads.hidden === open) takeHeads.hidden = !open;
    if (open)
      patchList(takeHeads, [...Array.from({ length: count }, (_, k) => String(k)), ...lists.map((p) => `pl:${p.name}`)], {
        key: (k) => k,
        create: (k) => {
          const label = document.createElement("span");
          if (k.startsWith("pl:")) {
            label.textContent = k.slice(3);
            label.setAttribute("translate", "no");
          } else label.textContent = `Take ${Number(k) + 1}`;
          return label;
        },
        update: () => {},
      });
  }
  const rows = node.querySelector<HTMLElement>(".fw-take-rows");
  if (!rows) return;
  if (rows.hidden === open) rows.hidden = !open;
  if (!open) return;
  const fillPlaylist = (row: HTMLElement, name: string) =>
    patchList(row, [...(lists.find((p) => p.name === name)?.clips ?? [])], {
      key: (c) => c.id,
      create: (c) => {
        const seg = clipNode();
        seg.classList.add("fw-take-seg", "fw-playlist-seg");
        updateClip(seg, { ...c, id: `${c.id}:playlist` }, doc, spp);
        return seg;
      },
      update: (seg, c) => updateClip(seg, { ...c, id: `${c.id}:playlist` }, doc, spp),
    });
  const fillRow = (row: HTMLElement, k: number) =>
    patchList(row, takeClips.filter((c) => k < (c.takes?.length ?? 0)), {
      key: (c) => c.id,
      create: (c) => {
        const seg = clipNode();
        seg.classList.add("fw-take-seg");
        updateTakeSegment(seg, c, k, doc, spp);
        return seg;
      },
      update: (seg, c) => updateTakeSegment(seg, c, k, doc, spp),
    });
  patchList(rows, [...Array.from({ length: count }, (_, k) => String(k)), ...lists.map((p) => `pl:${p.name}`)], {
    key: (k) => k,
    create: (k) => {
      const row = document.createElement("div");
      row.className = "fw-take-row";
      if (k.startsWith("pl:")) {
        row.dataset.playlist = k.slice(3);
        row.setAttribute("aria-label", `Playlist ${k.slice(3)}`);
        fillPlaylist(row, k.slice(3));
      } else {
        row.dataset.take = k;
        row.setAttribute("aria-label", `Take ${Number(k) + 1}`);
        fillRow(row, Number(k));
      }
      return row;
    },
    update: (row, k) => (k.startsWith("pl:") ? fillPlaylist(row, k.slice(3)) : fillRow(row, Number(k))),
  });
}

/** A take segment is the clip drawn from take k's offset, without fades or gain, marked when k plays. */
function updateTakeSegment(seg: HTMLElement, c: Clip, k: number, doc: SessionDoc, spp: number): void {
  const takes = c.takes ?? [];
  updateClip(seg, { ...c, id: `${c.id}:take${k}`, sourceIn: takes[k], fadeIn: 0, fadeOut: 0, gainDb: 0, takes: undefined, take: undefined }, doc, spp);
  const current = String((c.take ?? takes.length - 1) === k);
  if (seg.getAttribute("aria-current") !== current) seg.setAttribute("aria-current", current);
}

/** Tracks whose take lanes are shown (interface state, like the selection). */
const expandedTracks = new Set<string>();

/** Tracks whose volume automation lane is shown (interface state). */
const autoTracks = new Set<string>();
const AUTO_ROW_H = 48;
/** Space above the top value and below the bottom one, so a point (radius 4 plus stroke) at an extreme is not clipped. */
const AUTO_INSET = 5;

type AutoParam = "volume" | "pan";
/** A row's scale: volume, pan, or a filter parameter (PT-19): frequency and Q logarithmic, as they are heard; S9's mute
 *  (stepped, on at the top) and trim (as a gain). */
type AutoScale = AutoParam | "freq" | "gain" | "q" | "mute" | "trim";
/** S9: the lanes the third row offers beside the filters' parameters, by its data-fx. */
const MORE_LANES = new Set(["mute", "trim", "vca", "send", "master"]);
/** The session the lanes last drew, for rows whose points live outside the track (its VCA, a send's bus, the master). */
let laneDoc: SessionDoc | null = null;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Where a value sits down an automation row, 0 at the top: volume +12 to -36 dB; pan left (-1) to right (+1);
 * frequency 20 kHz to 20 Hz; gain +24 to -24 dB; Q 18 to 0.1. */
function autoFraction(param: AutoScale, value: number): number {
  switch (param) {
    case "volume":
      return gainFraction(value);
    case "pan":
      return clamp01((value + 1) / 2);
    case "freq":
      return clamp01(1 - Math.log(Math.max(20, value) / 20) / Math.log(1000));
    case "gain":
    case "trim":
      return clamp01((24 - value) / 48);
    case "q":
      return clamp01(1 - Math.log(Math.max(0.1, value) / 0.1) / Math.log(180));
    case "mute":
      return value >= 0.5 ? 0.15 : 0.85;
  }
}

/** The value at a fraction down an automation row (the inverse of autoFraction), rounded as the document stores it. */
function autoValue(param: AutoScale, frac: number): number {
  switch (param) {
    case "volume":
      return Math.round((GAIN_TOP_DB - frac * GAIN_SPAN_DB) * 10) / 10;
    case "pan":
      return Math.round((frac * 2 - 1) * 100) / 100;
    case "freq":
      return Math.round(20 * 1000 ** (1 - frac));
    case "gain":
    case "trim":
      return Math.round((24 - 48 * frac) * 10) / 10;
    case "q":
      return Math.round(0.1 * 180 ** (1 - frac) * 100) / 100;
    case "mute":
      return frac < 0.5 ? 1 : 0;
  }
}

/** The scale a row draws on: volume or pan, or for the effect row the chosen parameter (its data-key). */
function rowScale(row: HTMLElement): AutoScale {
  const p = row.dataset.param;
  if (p === "volume" || p === "pan") return p;
  const more = row.dataset.fx ?? "";
  if (MORE_LANES.has(more)) return more === "mute" || more === "trim" ? more : "volume";
  return row.dataset.key === "gain" || row.dataset.key === "q" ? row.dataset.key : "freq";
}

/** S9: the points and the static value of a row for one of MORE_LANES. */
function moreLane(row: HTMLElement, track: Track): { points: AutoPoint[]; fallback: number } | null {
  const more = row.dataset.fx ?? "";
  if (row.dataset.param !== "fx" || !MORE_LANES.has(more)) return null;
  const doc = laneDoc;
  if (more === "mute") return { points: track.automation?.mute ?? [], fallback: 0 };
  if (more === "trim") return { points: track.automation?.trim ?? [], fallback: 0 };
  if (more === "master") return { points: doc?.masterAutomation ?? [], fallback: doc?.masterGainDb ?? 0 };
  if (more === "vca") {
    const vca = (doc?.vcas ?? []).find((v) => v.id === track.vcaId);
    return { points: vca?.automation ?? [], fallback: vca?.gainDb ?? 0 };
  }
  const send = (track.sends ?? []).find((s) => s.busId === row.dataset.key);
  return { points: send?.automation ?? [], fallback: send?.gainDb ?? -12 };
}

/** The filter an effect row automates (its data-fx), or nothing when the track has no such filter. */
function rowFilter(row: HTMLElement, track: Track) {
  const f = row.dataset.param === "fx" ? track.fx?.[Number(row.dataset.fx)] : undefined;
  return f && f.kind !== "processor" && f.kind !== "compressor" && f.kind !== "dehum" && f.kind !== "declick" && f.kind !== "dereverb" && f.kind !== "denoise" && f.kind !== "reverb" && f.kind !== "echo" && f.kind !== "chorus" && f.kind !== "limiter" && f.kind !== "tremolo" && f.kind !== "gate" && f.kind !== "phaser" && f.kind !== "flanger" && f.kind !== "voice" ? f : undefined;
}

/** A row's points: the track's volume or pan automation, or the chosen filter parameter's. */
function rowPoints(row: HTMLElement, track: Track): AutoPoint[] {
  const p = row.dataset.param;
  if (p === "volume" || p === "pan") return track.automation?.[p] ?? [];
  const more = moreLane(row, track);
  if (more) return more.points;
  const key = rowScale(row);
  return key === "freq" || key === "gain" || key === "q" ? (rowFilter(row, track)?.automation?.[key] ?? []) : [];
}

/** The static value a row shows (dashed) while it holds no automation. */
function rowStatic(row: HTMLElement, track: Track): number {
  const p = row.dataset.param;
  if (p === "volume") return track.gainDb;
  if (p === "pan") return track.pan ?? 0;
  const more = moreLane(row, track);
  if (more) return more.fallback;
  const f = rowFilter(row, track);
  const key = rowScale(row);
  return !f ? 0 : key === "gain" ? f.gainDb : key === "q" ? f.q : f.freq;
}

const FILTER_NAMES: Record<string, string> = { highpass: "High-pass", lowpass: "Low-pass", peak: "Peak", lowshelf: "Low shelf", highshelf: "High shelf" };

/** The effect row's menu follows the track's filters (frequency and Q for every filter, gain where it acts); the row
 * and its head show only when there is a filter, and a choice that no longer exists falls back to the first. */
function syncFxRow(node: HTMLElement, track: Track): void {
  const select = node.querySelector<HTMLSelectElement>(".fw-auto-fx");
  const head = node.querySelector<HTMLElement>(".fw-auto-fx-head");
  const row = node.querySelector<HTMLElement>('.fw-auto-row[data-param="fx"]');
  if (!select || !head || !row) return;
  const options: [string, string][] = [];
  (track.fx ?? []).forEach((f, i) => {
    if (f.kind === "processor" || f.kind === "compressor" || f.kind === "denoise" || f.kind === "reverb" || f.kind === "echo" || f.kind === "chorus" || f.kind === "limiter" || f.kind === "tremolo" || f.kind === "gate" || f.kind === "phaser" || f.kind === "flanger" || f.kind === "voice" || f.kind === "dehum" || f.kind === "declick" || f.kind === "dereverb") return;
    const keys: [string, string][] = f.kind === "highpass" || f.kind === "lowpass" ? [["freq", "Frequency"], ["q", "Q"]] : [["freq", "Frequency"], ["gain", "Gain"], ["q", "Q"]];
    for (const [key, label] of keys) options.push([`${i}:${key}`, `${i + 1} ${FILTER_NAMES[f.kind] ?? f.kind} · ${label}${f.automation?.[key as "freq"] ? " (automated)" : ""}`]);
  });
  // S9: the track's mute and trim lanes, its VCA's, each send's and the master's
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const doc = laneDoc;
  const vca = (doc?.vcas ?? []).find((v) => v.id === track.vcaId);
  options.push(["mute:", "Mute"], ["trim:", "Trim"]);
  if (vca) options.push(["vca:", `VCA · ${esc(vca.name)}`]);
  for (const s of track.sends ?? []) options.push([`send:${s.busId}`, `Send · ${esc((doc?.buses ?? []).find((b) => b.id === s.busId)?.name ?? "bus")}`]);
  options.push(["master:", "Master volume"]);
  const none = options.length === 0;
  if (head.hidden !== none) head.hidden = none;
  if (row.hidden !== none) row.hidden = none;
  const html = options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  if (select.dataset.html !== html) {
    select.dataset.html = html;
    select.innerHTML = html;
  }
  const chosen = `${row.dataset.fx}:${row.dataset.key}`;
  const value = options.some(([v]) => v === chosen) ? chosen : (options[0]?.[0] ?? "");
  if (value && select.value !== value) select.value = value;
  const [fx, key] = value.split(":");
  if (fx !== undefined && row.dataset.fx !== fx) row.dataset.fx = fx;
  if (key !== undefined && row.dataset.key !== key) row.dataset.key = key;
  const label = MORE_LANES.has(fx ?? "") ? "Automation of the lane chosen above" : "Effect parameter automation";
  if (row.getAttribute("aria-label") !== label) row.setAttribute("aria-label", label);
}

/** Draws one automation row: the line through the points (held before the first and after the last), a circle per point; with no automation a dashed line shows the static fader or pan. */
function drawAutoLane(row: HTMLElement, track: Track, param: AutoScale, spp: number, points: AutoPoint[] = rowPoints(row, track)): void {
  const svg = row.querySelector<SVGSVGElement>(".fw-auto-svg");
  const line = svg?.querySelector<SVGPolylineElement>(".fw-auto-line");
  const group = svg?.querySelector<SVGGElement>(".fw-auto-points");
  if (!svg || !line || !group) return;
  const y = (value: number) => (AUTO_INSET + autoFraction(param, value) * (AUTO_ROW_H - 2 * AUTO_INSET)).toFixed(1);
  const x = (time: number) => (time / spp).toFixed(1);
  const fallback = rowStatic(row, track);
  const last = points[points.length - 1];
  const steps = param === "mute" ? points.flatMap((p, i) => (i === 0 ? [`${x(p.time)},${y(p.value)}`] : [`${x(p.time)},${y(points[i - 1].value)}`, `${x(p.time)},${y(p.value)}`])) : null;
  const coords = steps && last
    ? [`0,${y(points[0].value)}`, ...steps, `${(last.time / spp + 100000).toFixed(1)},${y(last.value)}`]
    : points.length
    ? [`0,${y(points[0].value)}`, ...points.map((p) => `${x(p.time)},${y(p.value)}`), `${(last.time / spp + 100000).toFixed(1)},${y(last.value)}`]
    : [`0,${y(fallback)}`, `100000,${y(fallback)}`];
  const attr = coords.join(" ");
  if (line.getAttribute("points") !== attr) line.setAttribute("points", attr);
  const fader = String(points.length === 0);
  if (line.dataset.static !== fader) line.dataset.static = fader;
  while (group.children.length > points.length) group.lastElementChild?.remove();
  while (group.children.length < points.length) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("r", "4");
    group.append(c);
  }
  points.forEach((p, i) => {
    const c = group.children[i];
    const cx = x(p.time);
    const cy = y(p.value);
    if (c.getAttribute("cx") !== cx) c.setAttribute("cx", cx);
    if (c.getAttribute("cy") !== cy) c.setAttribute("cy", cy);
  });
}

export function mountLanes(host: HTMLElement, engine: Engine): void {
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  viewStage = stage;
  // AU-13: a clip's waveform canvas covers only the part in view, so scrolling or resizing repaints them (once a frame)
  let waveRaf = 0;
  const repaintWaves = () => {
    if (waveRaf || !stage) return;
    waveRaf = requestAnimationFrame(() => {
      waveRaf = 0;
      for (const c of stage.querySelectorAll<HTMLCanvasElement>(".fw-clip .fw-wave")) {
        const info = paintInfo.get(c);
        if (info) schedulePaint(c, info.media.id);
      }
    });
  };
  stage?.addEventListener("scroll", repaintWaves, { passive: true });
  if (stage) new ResizeObserver(repaintWaves).observe(stage);
  // a page turn while playing (the transport's Follow) repaints the waves in view before that frame is drawn: the
  // scroll event and its frame came a frame late, the waves showing for one frame where the page had been
  stage?.addEventListener("fw-scrolled", () => {
    for (const c of stage.querySelectorAll<HTMLCanvasElement>(".fw-clip .fw-wave")) {
      const info = paintInfo.get(c);
      const peaks = info ? peakReady.get(info.media.id) : undefined;
      if (peaks) paint(c, peaks);
    }
  });
  // AU-34: a session opened with a saved view comes back to its zoom and left edge (the engine restores the selection)
  engine.subscribe("view", (view) => {
    if (!view) return;
    if (typeof view.zoom === "number" && Number.isFinite(view.zoom)) setZoom(view.zoom);
    const seconds = view.scrollSeconds;
    if (stage && typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      requestAnimationFrame(() => {
        const doc = engine.get("document");
        stage.scrollLeft = (seconds * doc.sampleRate) / samplesPerPixel(doc);
      });
    }
  });
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!stage || !lanes) return;

  const folded = new Set<string>();
  lanes.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".fw-folder-toggle")?.dataset.bus;
    if (!id) return;
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    render(engine.get("document"));
  });

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
    // Folder view (folder tracks): a header before the first track routed to each bus, and that bus's tracks
    // hidden while it is folded. Folding is view state kept here: not saved with the session and not an undo step.
    const buses = new Map((doc.buses ?? []).map((b) => [b.id, b]));
    type Row = { track: Track } | { bus: { id: string; name: string }; count: number };
    const rows: Row[] = [];
    const headed = new Set<string>();
    for (const t of doc.tracks) {
      const bus = t.busId ? buses.get(t.busId) : undefined;
      if (bus && !headed.has(bus.id)) {
        headed.add(bus.id);
        rows.push({ bus, count: doc.tracks.filter((x) => x.busId === bus.id).length });
      }
      rows.push({ track: t });
    }
    const hideLane = (n: HTMLElement, t: Track) => {
      const hide = !!t.hidden || (!!t.busId && buses.has(t.busId) && folded.has(t.busId));
      if (n.hidden !== hide) n.hidden = hide;
    };
    patchList(lanes, rows, {
      key: (r) => ("track" in r ? r.track.id : `folder:${r.bus.id}`),
      create: (r) => {
        if (!("track" in r)) {
          const n = folderNode();
          updateFolder(n, r.bus, r.count, folded.has(r.bus.id));
          return n;
        }
        const n = laneNode();
        updateLane(n, r.track, doc, spp);
        hideLane(n, r.track);
        return n;
      },
      update: (n, r) => {
        if (!("track" in r)) updateFolder(n, r.bus, r.count, folded.has(r.bus.id));
        else {
          updateLane(n, r.track, doc, spp);
          hideLane(n, r.track);
        }
      },
    });
    lanes.dispatchEvent(new Event("fw-lanes-rendered"));
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

  lanes.addEventListener("click", (e) => {
    const arm = (e.target as HTMLElement).closest<HTMLElement>(".fw-arm");
    const id = arm?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!arm || !id) return;
    if ((e as MouseEvent).shiftKey) toggleArmed(id);
    else setArmedTrack(isArmed(id) && armedTracks().length === 1 ? null : id);
  });
  onArm(() => render(engine.get("document")));
  lanes.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>(".fw-lane-mute, .fw-lane-solo");
    const trackId = button?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!button || !trackId) return;
    const on = button.getAttribute("aria-pressed") !== "true";
    engine.dispatch(button.classList.contains("fw-lane-mute") ? { type: "set-track-mute", trackId, mute: on } : { type: "set-track-solo", trackId, solo: on });
  });
  // S5: a click on a track's head (not its buttons) or an empty stretch of it makes it the track the Track menu and a
  // range paste act on, as a press on one of its clips does later
  let pickedTrack: string | null = null;
  lanes.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const lane = target.closest(".fw-lane-head, .fw-lane-body") && !target.closest("button, input, select, .fw-clip") ? target.closest<HTMLElement>(".fw-lane") : null;
    if (!lane?.dataset.key) return;
    pickedTrack = lane.dataset.key;
    for (const l of lanes.querySelectorAll<HTMLElement>(".fw-lane[data-current]")) if (l !== lane) delete l.dataset.current;
    if (lane.dataset.current === undefined) lane.dataset.current = "";
    lanes.dispatchEvent(new CustomEvent("fw-track", { bubbles: true, detail: lane.dataset.key }));
  });
  lanes.addEventListener("click", (e) => {
    const toggle = (e.target as HTMLElement).closest<HTMLElement>(".fw-takes-toggle");
    const id = toggle?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!toggle || !id) return;
    if (expandedTracks.has(id)) expandedTracks.delete(id);
    else expandedTracks.add(id);
    render(engine.get("document"));
  });

  let takeDrag: { trackId: string; clip: Clip; take: number; seg: HTMLElement; x0: number; moved: boolean; playlist?: string } | null = null;
  const takeRange = (d: NonNullable<typeof takeDrag>, clientX: number): [number, number] => {
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    const r = d.seg.getBoundingClientRect();
    const at = (x: number) => {
      const raw = d.clip.start + Math.max(0, Math.min(r.width, x - r.left)) * spp;
      return Math.max(d.clip.start, Math.min(d.clip.start + d.clip.length, Math.round(snapSamples(raw, doc.sampleRate, doc.sampleRate / spp))));
    };
    const a = at(d.x0);
    const b = at(clientX);
    return [Math.min(a, b), Math.max(a, b)];
  };
  const startTakeDrag = (e: PointerEvent, seg: HTMLElement) => {
    const trackId = seg.closest<HTMLElement>(".fw-lane")?.dataset.key;
    const playlist = seg.closest<HTMLElement>(".fw-take-row")?.dataset.playlist;
    if (playlist !== undefined) {
      const source = engine.get("document").tracks.find((t) => t.id === trackId)?.playlists?.find((p) => p.name === playlist);
      const clip = source?.clips.find((c) => c.id === seg.dataset.key);
      if (!trackId || !clip) return;
      takeDrag = { trackId, clip, take: -1, seg, x0: e.clientX, moved: false, playlist };
      seg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const take = Number(seg.closest<HTMLElement>(".fw-take-row")?.dataset.take);
    const clip = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === seg.dataset.key);
    if (!trackId || !clip || !Number.isFinite(take)) return;
    takeDrag = { trackId, clip, take, seg, x0: e.clientX, moved: false };
    seg.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  lanes.addEventListener("pointermove", (e) => {
    const d = takeDrag;
    if (!d || (!d.moved && Math.abs(e.clientX - d.x0) < 4)) return;
    d.moved = true;
    const [a, b] = takeRange(d, e.clientX);
    const spp = samplesPerPixel(engine.get("document"));
    const lr = lanes.getBoundingClientRect();
    const sr = d.seg.getBoundingClientRect();
    marquee.style.transform = `translate(${(sr.left - lr.left + (a - d.clip.start) / spp).toFixed(1)}px, ${(sr.top - lr.top).toFixed(1)}px)`;
    marquee.style.width = `${((b - a) / spp).toFixed(1)}px`;
    marquee.style.height = `${sr.height.toFixed(1)}px`;
    if (marquee.hidden) marquee.hidden = false;
  });
  const endTakeDrag = (apply: boolean, clientX: number) => {
    const d = takeDrag;
    takeDrag = null;
    if (!d) return;
    if (!marquee.hidden) marquee.hidden = true;
    if (!apply) return;
    if (d.playlist !== undefined) {
      // a click comps the whole clip from that playlist, a drag the span dragged across
      const [a, b] = d.moved ? takeRange(d, clientX) : [d.clip.start, d.clip.start + d.clip.length];
      if (b > a) engine.dispatch({ type: "comp-from-playlist", trackId: d.trackId, name: d.playlist, start: a, end: b });
      return;
    }
    if (!d.moved) {
      engine.dispatch({ type: "set-clip-take", trackId: d.trackId, clipId: d.clip.id, take: d.take });
      return;
    }
    const [a, b] = takeRange(d, clientX);
    if (b > a) engine.dispatch({ type: "comp-range", trackId: d.trackId, clipId: d.clip.id, from: a, to: b, take: d.take });
  };
  lanes.addEventListener("pointerup", (e) => endTakeDrag(true, e.clientX));
  lanes.addEventListener("pointercancel", (e) => endTakeDrag(false, e.clientX));
  lanes.addEventListener("click", (e) => {
    const badge = (e.target as HTMLElement).closest<HTMLElement>(".fw-take");
    const clipId = badge?.closest<HTMLElement>(".fw-clip")?.dataset.key;
    const trackId = badge?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!badge || !clipId || !trackId) return;
    const clip = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
    if (clip?.takes) engine.dispatch({ type: "set-clip-take", trackId, clipId, take: (clip.take ?? clip.takes.length - 1) + 1 });
  });

  lanes.addEventListener("click", (e) => {
    const toggle = (e.target as HTMLElement).closest<HTMLElement>(".fw-auto-toggle");
    const id = toggle?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!toggle || !id) return;
    if (autoTracks.has(id)) autoTracks.delete(id);
    else autoTracks.add(id);
    render(engine.get("document"));
  });

  let autoDrag: { trackId: string; row: HTMLElement; param: AutoScale; index: number; points: AutoPoint[] } | null = null;
  /** A row's edit: volume and pan are the track's automation; the effect row is its chosen filter parameter's. */
  const commitAuto = (row: HTMLElement, trackId: string, points: AutoPoint[]) => {
    const key = rowScale(row);
    const more = row.dataset.param === "fx" ? row.dataset.fx ?? "" : "";
    if (more === "mute" || more === "trim") engine.dispatch({ type: "set-automation", trackId, param: more, points });
    else if (more === "master") engine.dispatch({ type: "set-master-automation", points });
    else if (more === "send") engine.dispatch({ type: "set-send-automation", trackId, busId: row.dataset.key ?? "", points });
    else if (more === "vca") {
      const vcaId = engine.get("document").tracks.find((t) => t.id === trackId)?.vcaId;
      if (vcaId) engine.dispatch({ type: "set-vca-automation", vcaId, points });
    } else if (row.dataset.param === "fx" && (key === "freq" || key === "gain" || key === "q")) engine.dispatch({ type: "set-fx-automation", trackId, fxIndex: Number(row.dataset.fx), param: key, points });
    else engine.dispatch({ type: "set-automation", trackId, param: row.dataset.param === "pan" ? "pan" : "volume", points });
  };
  const autoPointAt = (row: HTMLElement, param: AutoScale, e: PointerEvent): AutoPoint => {
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    const r = row.getBoundingClientRect();
    const time = Math.round(snapSamples(Math.max(0, e.clientX - r.left) * spp, doc.sampleRate, doc.sampleRate / spp));
    return { time, value: autoValue(param, Math.min(1, Math.max(0, (e.clientY - r.top - AUTO_INSET) / (r.height - 2 * AUTO_INSET)))) };
  };
  const previewAuto = (d: NonNullable<typeof autoDrag>) => {
    const track = engine.get("document").tracks.find((t) => t.id === d.trackId);
    if (track) drawAutoLane(d.row, track, d.param, samplesPerPixel(engine.get("document")), d.points);
  };
  const startAuto = (e: PointerEvent, _rows: HTMLElement) => {
    const row = (e.target as Element).closest<HTMLElement>(".fw-auto-row");
    const trackId = row?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    const track = engine.get("document").tracks.find((t) => t.id === trackId);
    if (!row || !trackId || !track) return;
    e.preventDefault();
    const param = rowScale(row);
    const points = [...rowPoints(row, track)];
    const circle = (e.target as Element).closest("circle");
    let index = circle?.parentElement ? Array.from(circle.parentElement.children).indexOf(circle) : -1;
    if (index >= 0 && e.altKey) {
      points.splice(index, 1);
      commitAuto(row, trackId, points);
      return;
    }
    if (index < 0) {
      const added = autoPointAt(row, param, e);
      points.push(added);
      points.sort((a, b) => a.time - b.time);
      index = points.indexOf(added);
    }
    autoDrag = { trackId, row, param, index, points };
    row.setPointerCapture(e.pointerId);
    previewAuto(autoDrag);
  };
  lanes.addEventListener("pointermove", (e) => {
    const d = autoDrag;
    if (!d) return;
    const next = autoPointAt(d.row, d.param, e);
    const lo = d.index > 0 ? d.points[d.index - 1].time + 1 : 0;
    const hi = d.index < d.points.length - 1 ? d.points[d.index + 1].time - 1 : Number.MAX_SAFE_INTEGER;
    d.points[d.index] = { time: Math.min(hi, Math.max(lo, next.time)), value: next.value };
    previewAuto(d);
  });
  const endAuto = (apply: boolean) => {
    const d = autoDrag;
    autoDrag = null;
    if (!d) return;
    if (apply) commitAuto(d.row, d.trackId, d.points);
    else render(engine.get("document"));
  };
  lanes.addEventListener("pointerup", () => endAuto(true));
  lanes.addEventListener("pointercancel", () => endAuto(false));
  // the effect row's menu (PT-19): which filter parameter the row shows and edits
  lanes.addEventListener("change", (e) => {
    const select = (e.target as Element).closest<HTMLSelectElement>("select.fw-auto-fx");
    const row = select?.closest(".fw-lane")?.querySelector<HTMLElement>('.fw-auto-row[data-param="fx"]');
    if (!select || !row) return;
    const [fx, key] = select.value.split(":");
    row.dataset.fx = fx;
    row.dataset.key = key;
    render(engine.get("document"));
  });

  /** Smart Tool range (interface state): a time range on one track, made by dragging in a clip's upper half. */
  let range: { trackId: string; start: number; end: number; more?: string[]; band?:{ lowHz: number; highHz: number }; mask?: { from: number; to: number; low: number; high: number }[] } | null = null;
  let rangeBand: { top: number; height: number } | null = null;
  let rangeDrag: { trackId: string; body: HTMLElement; x0: number; moved: boolean; y0: number; clipTop: number; clipHeight: number; bodyTop: number; nyquist: number; spectral: boolean; dabs?: { at: number; hz: number; low: number; high: number; x: number; y: number }[] } | null = null;
  // AA-06: with the heal brush on (the Inspector sets body[data-heal-brush]), a drag in the spectrogram view paints dabs
  // instead of drawing a box; each dab covers BRUSH_PX either way, and the stroke goes to the Inspector on release
  const BRUSH_PX = 8;
  const brushDots: HTMLElement[] = [];
  // A track shows a spectrogram when the session's view is the spectrogram or its own view is (AU-30); there a drag
  // anywhere on a clip selects time and frequency (or paints, with the heal brush) rather than moving the clip
  const spectralTrack = (trackId: string | undefined): boolean =>
    lanes.classList.contains("is-spectral") || (!!trackId && engine.get("document").tracks.find((t) => t.id === trackId)?.view === "spectrogram");
  let hovered: HTMLElement | null = null;
  const rangeBox = document.createElement("div");
  rangeBox.className = "fw-range";
  rangeBox.hidden = true;
  const rangeAt = (body: HTMLElement, clientX: number) => {
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    const raw = Math.max(0, clientX - body.getBoundingClientRect().left) * spp;
    return Math.round(snapSamples(raw, doc.sampleRate, doc.sampleRate / spp));
  };
  const drawRange = () => {
    const body = range ? lanes.querySelector<HTMLElement>(`.fw-lane[data-key="${range.trackId}"] .fw-lane-body`) : null;
    if (!range || !body) {
      if (!rangeBox.hidden) rangeBox.hidden = true;
      for (const box of moreBoxes) if (!box.hidden) box.hidden = true;
      return;
    }
    if (rangeBox.parentElement !== body) body.append(rangeBox);
    const spp = samplesPerPixel(engine.get("document"));
    const transform = `translateX(${(range.start / spp).toFixed(1)}px)`;
    const width = `${((range.end - range.start) / spp).toFixed(1)}px`;
    if (rangeBox.style.transform !== transform) rangeBox.style.transform = transform;
    if (rangeBox.style.width !== width) rangeBox.style.width = width;
    const top = rangeBand ? `${rangeBand.top.toFixed(1)}px` : "";
    const height = rangeBand ? `${rangeBand.height.toFixed(1)}px` : "";
    const bottom = rangeBand ? "auto" : "";
    if (rangeBox.style.top !== top) rangeBox.style.top = top;
    if (rangeBox.style.height !== height) rangeBox.style.height = height;
    if (rangeBox.style.bottom !== bottom) rangeBox.style.bottom = bottom;
    if (rangeBox.hidden) rangeBox.hidden = false;
    // S10: the range's other tracks (an edit group's, or Shift-clicked names) each show the same span
    const more = range.more ?? [];
    while (moreBoxes.length < more.length) moreBoxes.push(Object.assign(document.createElement("div"), { className: "fw-range" }));
    moreBoxes.forEach((box, i) => {
      const at = i < more.length ? lanes.querySelector<HTMLElement>(`.fw-lane[data-key="${more[i]}"] .fw-lane-body`) : null;
      if (!at) {
        if (!box.hidden) box.hidden = true;
        return;
      }
      if (box.parentElement !== at) at.append(box);
      if (box.style.transform !== transform) box.style.transform = transform;
      if (box.style.width !== width) box.style.width = width;
      if (box.hidden) box.hidden = false;
    });
  };
  const moreBoxes: HTMLElement[] = [];
  const clearRange = () => {
    for (const dot of brushDots.splice(0)) dot.remove();
    if (!range) return;
    range = null;
    rangeBand = null;
    lanes.dispatchEvent(new CustomEvent("fw-range", { bubbles: true, detail: null }));
    drawRange();
  };
  lanes.addEventListener("fw-lanes-rendered", drawRange);
  lanes.addEventListener(
    "pointerdown",
    (e) => {
      // S10: Shift on a track's name adds that track to the range, or takes it out
      const head = e.shiftKey && range && !range.mask ? (e.target as HTMLElement).closest<HTMLElement>(".fw-lane-head") : null;
      const id = head?.closest<HTMLElement>(".fw-lane")?.dataset.key;
      if (!range || !id || (e.target as HTMLElement).closest("button, input, select")) return clearRange();
      if (id === range.trackId) return;
      const more = range.more?.includes(id) ? range.more.filter((x) => x !== id) : [...(range.more ?? []), id];
      const { more: _old, ...rest } = range;
      range = more.length ? { ...rest, more } : rest;
      e.stopPropagation();
      lanes.dispatchEvent(new CustomEvent("fw-range", { bubbles: true, detail: range }));
      drawRange();
    },
    true,
  );
  // PT-09: warp markers. Dragging one re-times the audio on either side of it, each side kept within half to twice its
  // speed (as the engine allows); on release the clip is rendered again from its original and the new media and
  // markers land as one undo step. Double-clicking one removes it; removing the last restores the original.
  const renderWarp = async (trackId: string, clipId: string, markers: { src: number; dst: number }[]) => {
    const doc = engine.get("document");
    const clip = doc.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
    const w = clip?.warp;
    if (!clip || !w) return;
    if (!markers.length) {
      engine.dispatch({ type: "set-clip-warp", trackId, clipId, warp: null });
      return;
    }
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    const rate = doc.media[w.source]?.sampleRate ?? doc.sampleRate;
    const sorted = [...markers].sort((a, b) => a.src - b.src);
    const pts = [{ src: 0, dst: 0 }, ...sorted, { src: w.sourceLength, dst: clip.length }];
    const segments = pts.slice(1).map((b, k) => ({ from: (w.sourceIn + pts[k].src) / rate, to: (w.sourceIn + b.src) / rate, length: (b.dst - pts[k].dst) / rate }));
    setText(notice, "Warping...");
    try {
      const res = await fetch(`/api/media/${w.source}/warp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments }) });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      engine.dispatch({ type: "set-clip-warp", trackId, clipId, warp: { ...w, markers: sorted }, media: out as unknown as MediaRef });
      setText(notice, `Warped the clip at ${sorted.length} marker${sorted.length === 1 ? "" : "s"}`);
    } catch (err) {
      setText(notice, `Could not warp: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const warpTarget = (el: HTMLElement) => {
    const node = el.closest<HTMLElement>(".fw-clip");
    const trackId = node?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    const clip = engine.get("document").tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === node?.dataset.key);
    const index = Number(el.dataset.index);
    return trackId && clip?.warp && clip.warp.markers[index] ? { trackId, clip, warp: clip.warp, index } : null;
  };
  lanes.addEventListener(
    "pointerdown",
    (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".fw-warp-marker");
      if (!el || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const t = warpTarget(el);
      if (!t) return;
      const { trackId, clip, warp: w, index } = t;
      const spp = samplesPerPixel(engine.get("document"));
      const m = w.markers[index];
      const prev = index > 0 ? w.markers[index - 1] : { src: 0, dst: 0 };
      const next = index < w.markers.length - 1 ? w.markers[index + 1] : { src: w.sourceLength, dst: clip.length };
      const lo = Math.max(prev.dst + (m.src - prev.src) / 2, next.dst - 2 * (next.src - m.src));
      const hi = Math.min(prev.dst + 2 * (m.src - prev.src), next.dst - (next.src - m.src) / 2);
      if (lo > hi) return;
      const x0 = e.clientX;
      let dst = m.dst;
      el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        dst = Math.round(Math.min(hi, Math.max(lo, m.dst + (ev.clientX - x0) * spp)));
        el.style.left = `${(dst / spp).toFixed(2)}px`;
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        if (Math.abs(dst - m.dst) >= 1) void renderWarp(trackId, clip.id, w.markers.map((k, i) => (i === index ? { ...k, dst } : k)));
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up, { once: true });
    },
    true,
  );
  lanes.addEventListener(
    "dblclick",
    (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".fw-warp-marker");
      if (!el) return;
      e.stopPropagation();
      const t = warpTarget(el);
      if (t) void renderWarp(t.trackId, t.clip.id, t.warp.markers.filter((_, i) => i !== t.index));
    },
    true,
  );
  // DS-11: the transcript's one selected word drawn on its clip with an edge to drag at each end; a drag sends the
  // edge's new place to the transcript pane, which applies it as a typed Start or End (kept between the neighbours)
  let wordSpan: { mediaId: string; start: number; end: number } | null = null;
  const wordBox = document.createElement("div");
  wordBox.className = "fw-word-span";
  wordBox.hidden = true;
  wordBox.innerHTML = '<span class="fw-word-edge" data-edge="start" title="Drag to move where the word starts"></span><span class="fw-word-edge" data-edge="end" title="Drag to move where the word ends"></span>';
  const placeWord = () => {
    const doc = engine.get("document");
    const w = wordSpan;
    const lane = w
      ? [...lanes.querySelectorAll<HTMLElement>(".fw-lane")].find((l) => doc.tracks.find((t) => t.id === l.dataset.key)?.clips.some((c) => c.mediaId === w.mediaId && c.start <= w.start && c.start + c.length >= w.end))
      : undefined;
    const laneBody = lane?.querySelector<HTMLElement>(".fw-lane-body");
    if (!w || !laneBody) {
      if (!wordBox.hidden) wordBox.hidden = true;
      return;
    }
    if (wordBox.parentElement !== laneBody) laneBody.append(wordBox);
    const spp = samplesPerPixel(doc);
    wordBox.style.left = `${(w.start / spp).toFixed(2)}px`;
    wordBox.style.width = `${Math.max(2, (w.end - w.start) / spp).toFixed(2)}px`;
    if (wordBox.hidden) wordBox.hidden = false;
  };
  document.addEventListener("fw-word-span", (e) => {
    wordSpan = (e as CustomEvent<{ mediaId: string; start: number; end: number } | null>).detail;
    placeWord();
  });
  lanes.addEventListener("fw-lanes-rendered", placeWord);
  wordBox.addEventListener("pointerdown", (e) => {
    const handle = (e.target as HTMLElement).closest<HTMLElement>(".fw-word-edge");
    const edge = handle?.dataset.edge === "start" || handle?.dataset.edge === "end" ? handle.dataset.edge : null;
    if (!handle || !edge || !wordSpan || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const spp = samplesPerPixel(engine.get("document"));
    const base = { ...wordSpan };
    const x0 = e.clientX;
    let at = base[edge];
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      at = Math.round(base[edge] + (ev.clientX - x0) * spp);
      const s = edge === "start" ? Math.min(at, base.end - 1) : base.start;
      const en = edge === "end" ? Math.max(at, base.start + 1) : base.end;
      wordBox.style.left = `${(s / spp).toFixed(2)}px`;
      wordBox.style.width = `${Math.max(2, (en - s) / spp).toFixed(2)}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      if (Math.abs(at - base[edge]) >= 1) document.dispatchEvent(new CustomEvent("fw-word-edge", { detail: { edge, at } }));
      else placeWord();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  });
  const startRange = (e: PointerEvent, trackId: string, node: HTMLElement) => {
    const body = node.closest<HTMLElement>(".fw-lane-body");
    if (!body) return;
    const doc = engine.get("document");
    const clip = doc.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === node.dataset.key);
    const rate = (clip && doc.media[clip.mediaId]?.sampleRate) || doc.sampleRate;
    const box = node.getBoundingClientRect();
    rangeDrag = { trackId, body, x0: e.clientX, moved: false, y0: e.clientY, clipTop: box.top, clipHeight: box.height, bodyTop: body.getBoundingClientRect().top, nyquist: rate / 2, spectral: spectralTrack(trackId) };
    body.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  lanes.addEventListener("pointermove", (e) => {
    const d = rangeDrag;
    if (d) {
      const tool = document.body.dataset.healBrush === "on" ? "heal" : document.body.dataset.spectralTool;
      if (d.spectral && (tool === "heal" || tool === "paint" || tool === "lasso")) {
        // AA-06 and AA-05: a dab where the pointer is, in session samples and Hz (with the brush's reach), drawn as a dot
        // over the clip; a lasso keeps the same points as its outline
        d.moved = true;
        const y = Math.min(d.clipTop + d.clipHeight, Math.max(d.clipTop, e.clientY));
        const hzAt = (py: number) => spectralHz(1 - (Math.min(d.clipTop + d.clipHeight, Math.max(d.clipTop, py)) - d.clipTop) / d.clipHeight, d.nyquist);
        (d.dabs ??= []).push({ at: rangeAt(d.body, e.clientX), hz: hzAt(y), low: hzAt(y + BRUSH_PX), high: hzAt(y - BRUSH_PX), x: e.clientX, y });
        const dot = document.createElement("div");
        dot.className = "fw-brush-dot";
        dot.style.left = `${e.clientX - d.body.getBoundingClientRect().left - BRUSH_PX}px`;
        dot.style.top = `${y - d.bodyTop - BRUSH_PX}px`;
        d.body.append(dot);
        brushDots.push(dot);
        return;
      }
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
      d.moved = true;
      const a = rangeAt(d.body, d.x0);
      const b = rangeAt(d.body, e.clientX);
      const peers = groupPeers(engine.get("document"), d.trackId, "edit");
      range = { trackId: d.trackId, start: Math.min(a, b), end: Math.max(a, b), ...(peers.size && !d.spectral ? { more: engine.get("document").tracks.filter((t) => peers.has(t.id)).map((t) => t.id) } : {}) };
      rangeBand = null;
      if (d.spectral && Math.abs(e.clientY - d.y0) >= 4) {
        const clampY = (y: number) => Math.min(d.clipTop + d.clipHeight, Math.max(d.clipTop, y));
        const y1 = clampY(Math.min(d.y0, e.clientY));
        const y2 = clampY(Math.max(d.y0, e.clientY));
        const hz = (y: number) => Math.round(spectralHz(1 - (y - d.clipTop) / d.clipHeight, d.nyquist));
        range.band = { lowHz: hz(y2), highHz: hz(y1) };
        rangeBand = { top: y1 - d.bodyTop, height: y2 - y1 };
      }
      lanes.dispatchEvent(new CustomEvent("fw-range", { bubbles: true, detail: range }));
      drawRange();
      return;
    }
    if (e.buttons) return;
    const clip = (e.target as HTMLElement).closest<HTMLElement>(".fw-lane-body .fw-clip");
    if (hovered && hovered !== clip) {
      delete hovered.dataset.zone;
      hovered = null;
    }
    if (!clip) return;
    const r = clip.getBoundingClientRect();
    const x = e.clientX - r.left;
    const onHandle = !!(e.target as HTMLElement).closest(".fw-gain-line, .fw-fade-handle, .fw-take");
    const zone = onHandle || x < EDGE_PX || x > r.width - EDGE_PX ? "" : spectralTrack(clip.closest<HTMLElement>(".fw-lane")?.dataset.key) || e.clientY - r.top < r.height / 2 ? "range" : "grab";
    if ((clip.dataset.zone ?? "") !== zone) {
      if (zone) clip.dataset.zone = zone;
      else delete clip.dataset.zone;
    }
    hovered = clip;
  });
  const endRange = (apply: boolean) => {
    const d = rangeDrag;
    rangeDrag = null;
    if (!d) return;
    if (d.dabs) {
      const tool = document.body.dataset.healBrush === "on" ? "heal" : document.body.dataset.spectralTool;
      const radiusSamples = Math.abs(rangeAt(d.body, d.x0 + BRUSH_PX) - rangeAt(d.body, d.x0));
      if (tool === "heal" || !apply || !d.dabs.length) {
        for (const dot of brushDots.splice(0)) dot.remove();
        if (apply && d.dabs.length && tool === "heal") lanes.dispatchEvent(new CustomEvent("fw-heal-stroke", { bubbles: true, detail: { trackId: d.trackId, dabs: d.dabs, radiusSamples } }));
        return;
      }
      // AA-05: a paint selection is its dabs' patches; a lasso is its outline cut into 3 px columns, each column's spans
      // inside the outline (even-odd) a box; either is a range with this mask, and effects change only inside it. The
      // dots stay as the selection's mark until it is cleared.
      const hzAt = (py: number) => spectralHz(1 - (Math.min(d.clipTop + d.clipHeight, Math.max(d.clipTop, py)) - d.clipTop) / d.clipHeight, d.nyquist);
      const mask: { from: number; to: number; low: number; high: number }[] = [];
      const pts = d.dabs;
      if (tool === "paint") {
        for (const p of pts) mask.push({ from: Math.max(0, p.at - radiusSamples), to: p.at + radiusSamples, low: p.low, high: p.high });
      } else {
        const xs = pts.map((p) => p.x);
        for (let cx = Math.min(...xs) + 1.5; cx < Math.max(...xs); cx += 3) {
          const ys: number[] = [];
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            if ((a.x <= cx && b.x > cx) || (b.x <= cx && a.x > cx)) ys.push(a.y + ((cx - a.x) * (b.y - a.y)) / (b.x - a.x));
          }
          ys.sort((p, q) => p - q);
          for (let k = 0; k + 1 < ys.length; k += 2) mask.push({ from: Math.max(0, rangeAt(d.body, cx - 1.5)), to: rangeAt(d.body, cx + 1.5), low: hzAt(ys[k + 1]), high: hzAt(ys[k]) });
        }
      }
      if (!mask.length) {
        clearRange();
        return;
      }
      range = { trackId: d.trackId, start: Math.min(...mask.map((m) => m.from)), end: Math.max(...mask.map((m) => m.to)), mask };
      rangeBand = null;
      lanes.dispatchEvent(new CustomEvent("fw-range", { bubbles: true, detail: range }));
      drawRange();
      return;
    }
    if (!apply || !d.moved || (range && range.end <= range.start)) clearRange();
  };
  lanes.addEventListener("pointerup", () => endRange(true));
  lanes.addEventListener("pointercancel", () => endRange(false));

  const spot = document.createElement("div");
  spot.className = "fw-spot";
  spot.hidden = true;
  spot.innerHTML = `<label class="fw-spot-label">Start<input class="fw-spot-input" type="text" inputmode="decimal" spellcheck="false" aria-label="Clip start, in seconds or m:ss.mmm"></label>`;
  lanes.append(spot);
  const spotInput = spot.querySelector<HTMLInputElement>(".fw-spot-input") as HTMLInputElement;
  let spotTarget: { trackId: string; clipId: string } | null = null;

  const formatTime = (samples: number, rate: number) => {
    const seconds = samples / rate;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
  };
  const parseTime = (text: string, rate: number): number | null => {
    const parts = text.trim().split(":");
    if (!text.trim() || parts.length > 2 || parts.some((p) => p.trim() === "")) return null;
    const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * rate) : null;
  };
  const closeSpot = () => {
    spotTarget = null;
    if (!spot.hidden) spot.hidden = true;
    if (document.activeElement === spotInput) spotInput.blur();
  };
  const openSpot = (trackId: string, clip: Clip, node: HTMLElement) => {
    const r = lanes.getBoundingClientRect();
    const c = node.getBoundingClientRect();
    spot.style.transform = `translate(${(c.left - r.left).toFixed(1)}px, ${(c.top - r.top + 4).toFixed(1)}px)`;
    spotTarget = { trackId, clipId: clip.id };
    spotInput.value = formatTime(clip.start, engine.get("document").sampleRate);
    spotInput.removeAttribute("aria-invalid");
    spot.hidden = false;
    spotInput.focus();
    spotInput.select();
  };
  spotInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSpot();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const start = parseTime(spotInput.value, engine.get("document").sampleRate);
    if (start === null) {
      spotInput.setAttribute("aria-invalid", "true");
      return;
    }
    if (spotTarget) engine.dispatch({ type: "move-clip", ...spotTarget, start });
    closeSpot();
  });
  spotInput.addEventListener("input", () => spotInput.removeAttribute("aria-invalid"));
  spotInput.addEventListener("blur", closeSpot);

  /**
   * Shuffle reorder: lift the clip out (later clips close its gap), then insert it at the clip boundary
   * nearest to where it was dropped (clips at or after that boundary move right by its length).
   * Gaps between the other clips are kept. Returns every clip's new start.
   */
  const shuffleLayout = (clip: Clip, others: Member[], delta: number): Map<string, number> => {
    const rest = others.map((m) => ({ id: m.clip.id, length: m.clip.length, start: m.clip.start > clip.start ? m.clip.start - clip.length : m.clip.start }));
    const target = Math.max(0, clip.start + delta);
    const bounds = rest.length ? rest.flatMap((r) => [r.start, r.start + r.length]) : [target];
    const slot = bounds.reduce((best, b) => (Math.abs(b - target) < Math.abs(best - target) ? b : best), bounds[0]);
    const starts = new Map<string, number>([[clip.id, slot]]);
    for (const r of rest) starts.set(r.id, r.start >= slot ? r.start + clip.length : r.start);
    return starts;
  };

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

  // Clip groups: selecting any member selects the whole group, so the existing multi-clip move and delete
  // carry the group; grouped clips carry data-group for their outline.
  const groupOf = () => {
    const map = new Map<string, string>();
    for (const t of engine.get("document").tracks) for (const c of t.clips) if (c.groupId) map.set(c.id, c.groupId);
    return map;
  };
  const expandGroups = () => {
    const groups = groupOf();
    const wanted = new Set([...selectedClipIds].map((id) => groups.get(id)).filter((g): g is string => !!g));
    if (!wanted.size) return;
    for (const [id, g] of groups) if (wanted.has(g)) selectedClipIds.add(id);
  };
  const markGroups = () => {
    const groups = groupOf();
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const g = node.dataset.key !== undefined ? groups.get(node.dataset.key) : undefined;
      if ((node.dataset.group ?? undefined) !== g) {
        if (g) node.dataset.group = g;
        else delete node.dataset.group;
      }
    }
  };
  engine.subscribe("document", () => queueMicrotask(markGroups));
  const markSelected = () => {
    markGroups();
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const on = String(node.dataset.key !== undefined && selectedClipIds.has(node.dataset.key));
      if (node.getAttribute("aria-selected") !== on) node.setAttribute("aria-selected", on);
    }
    lanes.dispatchEvent(new CustomEvent("fw-selection", { bubbles: true, detail: [...selectedClipIds] }));
  };
  // S4: the editing commands (ui/editing.ts) select what they made, the clips by id or the range moved onto the copy
  host.addEventListener("fw-select-clips", (e) => {
    selectedClipIds.clear();
    for (const id of (e as CustomEvent<string[]>).detail ?? []) selectedClipIds.add(id);
    markSelected();
  });
  host.addEventListener("fw-set-range", (e) => {
    const next = (e as CustomEvent<{ trackId: string; start: number; end: number } | null>).detail;
    if (!next || next.end <= next.start) {
      clearRange();
      return;
    }
    range = { trackId: next.trackId, start: Math.round(next.start), end: Math.round(next.end) };
    rangeBand = null;
    lanes.dispatchEvent(new CustomEvent("fw-range", { bubbles: true, detail: range }));
    drawRange();
  });

  type GestureKind = "move" | "trim-left" | "trim-right" | "fade-in" | "fade-out" | "gain" | "range";
  type Member = { trackId: string; clip: Clip; node: HTMLElement };
  type Gesture = { kind: GestureKind; node: HTMLElement; trackId: string; clip: Clip; startX: number; startY: number; dx: number; dy: number; moved: boolean; low: number; high: number; group: Member[]; ripple: boolean; followers: Member[]; reorder: boolean; stretch?: boolean };
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
      case "range":
        return [0, 0];
    }
  };

  lanes.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".fw-take")) return;
    const autoRows = target.closest<HTMLElement>(".fw-auto-rows");
    if (autoRows) {
      if (e.button === 0) startAuto(e, autoRows);
      return;
    }
    if (target.closest(".fw-take-rows")) {
      const seg = target.closest<HTMLElement>(".fw-take-seg");
      if (seg && e.button === 0) startTakeDrag(e, seg);
      return;
    }
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
    pickedTrack = trackId;
    for (const l of lanes.querySelectorAll<HTMLElement>(".fw-lane[data-current]")) delete l.dataset.current;
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
              : spectralTrack(trackId) || e.clientY - rect.top < rect.height / 2
                ? "range"
                : "move";
    if (spotEnabled() && (kind === "move" || kind === "range") && !e.shiftKey) {
      e.preventDefault();
      selectedClipIds.clear();
      selectedClipIds.add(clip.id);
      markSelected();
      openSpot(trackId, clip, node);
      return;
    }
    if (e.shiftKey && (kind === "move" || kind === "range")) {
      const members = clip.groupId ? [...groupOf()].filter(([, g]) => g === clip.groupId).map(([id]) => id) : [clip.id];
      if (selectedClipIds.has(clip.id)) for (const id of members) selectedClipIds.delete(id);
      else for (const id of members) selectedClipIds.add(id);
      markSelected();
      e.preventDefault();
      return;
    }
    if (!selectedClipIds.has(clip.id)) {
      selectedClipIds.clear();
      selectedClipIds.add(clip.id);
      expandGroups();
    }
    markSelected();
    if (kind === "range") {
      startRange(e, trackId, node);
      return;
    }
    // S5: a time-locked clip keeps its place, an edit-locked one any edit but its gain
    if (clip.lock && (kind === "move" || (clip.lock === "edit" && kind !== "gain"))) {
      setText(host.querySelector(".fw-notice"), clip.lock === "edit" ? "This clip is edit-locked: Clip > Edit lock unlocks it" : "This clip is time-locked: Clip > Time lock unlocks it");
      e.preventDefault();
      return;
    }
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    let [low, high] = limits(kind, clip, spp);
    const group: Member[] = [{ trackId, clip, node }];
    if (kind === "move" || kind === "fade-in" || kind === "fade-out" || kind === "gain" || ((kind === "trim-left" || kind === "trim-right") && !shuffleEnabled())) {
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
    const reorder = shuffleEnabled() && kind === "move" && group.length === 1;
    const followers: Member[] = [];
    if (ripple || reorder) {
      const end = clip.start + clip.length;
      for (const other of doc.tracks.find((t) => t.id === trackId)?.clips ?? []) {
        if (other.id === clip.id || (ripple && other.start < end)) continue;
        const otherNode = lanes.querySelector<HTMLElement>(`.fw-clip[data-key="${other.id}"]`);
        if (otherNode) followers.push({ trackId, clip: other, node: otherNode });
      }
    }
    const stretch = kind === "trim-right" && e.altKey;
    const spanSpp = samplesPerPixel(doc);
    drag = stretch
      ? { kind, node, trackId, clip, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, low: -(clip.length * 0.5) / spanSpp, high: clip.length / spanSpp, group, ripple: false, followers: [], reorder: false, stretch }
      : { kind, node, trackId, clip, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, low, high, group, ripple, followers, reorder };
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
    if (d.kind === "move" && d.reorder) {
      const starts = shuffleLayout(d.clip, d.followers, Math.round(d.dx * spp));
      for (const m of [{ trackId: d.trackId, clip: d.clip, node: d.node }, ...d.followers]) {
        m.node.style.transform = `translateX(${(((starts.get(m.clip.id) ?? m.clip.start) - m.clip.start) / spp).toFixed(1)}px)`;
      }
    } else if (d.kind === "move") for (const member of d.group) member.node.style.transform = shift;
    else if (d.kind === "trim-left") {
      for (const m of d.group) {
        if (!d.ripple) m.node.style.transform = shift;
        m.node.style.width = `${Math.max(1, m.clip.length / spp - d.dx).toFixed(2)}px`;
      }
      for (const f of d.followers) f.node.style.transform = `translateX(${(-d.dx).toFixed(1)}px)`;
    } else if (d.kind === "trim-right") {
      for (const m of d.group) m.node.style.width = `${Math.max(1, m.clip.length / spp + d.dx).toFixed(2)}px`;
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
    for (const m of d.group) if (m.node.dataset.width) m.node.style.width = m.node.dataset.width;
    for (const m of d.group) {
      for (const handle of m.node.querySelectorAll<HTMLElement>(".fw-fade-handle")) handle.style.transform = handle.dataset.tx ?? "";
      const line = m.node.querySelector<HTMLElement>(".fw-gain-line");
      if (line) {
        line.style.transform = "";
        line.dataset.db = gainLabel(m.clip.gainDb);
      }
    }
  };

  /** Clip stretching: every clip in the gesture re-timed by `ratio` with the Fit to length render, each media once, one undo step. */
  const stretchGroup = async (group: Member[], ratio: number) => {
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    const percent = Math.round(ratio * 1000) / 10;
    setText(notice, `Stretching to ${percent}%...`);
    try {
      const rendered = new Map<string, MediaRef>();
      for (const m of group) {
        if (rendered.has(m.clip.mediaId)) continue;
        const params = encodeURIComponent(JSON.stringify({ percent: (1 / ratio - 1) * 100 }));
        const res = await fetch(`/api/media/${m.clip.mediaId}/effect?name=stretch-rhythmic&params=${params}`, { method: "POST" });
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        rendered.set(m.clip.mediaId, out as unknown as MediaRef);
      }
      const commands: Dispatchable[] = group.map((m) => ({ type: "set-clip-media" as const, trackId: m.trackId, clipId: m.clip.id, media: rendered.get(m.clip.mediaId) as MediaRef }));
      // AA-10: later clips on the track that the lengthened clip now overlaps move right by the overlap, spacing kept,
      // in the same undo step (as Stretch selected clips does)
      if (ratio > 1) {
        const doc = engine.get("document");
        const ids = new Set(group.map((m) => m.clip.id));
        for (const trackId of new Set(group.map((m) => m.trackId))) {
          const mine = group.filter((m) => m.trackId === trackId);
          const oldEnd = Math.max(...mine.map((m) => m.clip.start + m.clip.length));
          const newEnd = Math.max(...mine.map((m) => m.clip.start + Math.round(m.clip.length * ratio)));
          const later = (doc.tracks.find((t) => t.id === trackId)?.clips ?? []).filter((c) => !ids.has(c.id) && c.start >= oldEnd);
          const shift = later.length ? newEnd - Math.min(...later.map((c) => c.start)) : 0;
          if (shift > 0) for (const c of later) commands.push({ type: "move-clip", trackId, clipId: c.id, start: c.start + shift });
        }
      }
      engine.dispatch({ type: "batch", commands });
      setText(notice, `Stretched ${group.length === 1 ? "the clip" : `${group.length} clips`} to ${percent}% of ${group.length === 1 ? "its" : "their"} length, pitch kept`);
    } catch (err) {
      setText(notice, `Could not stretch: ${err instanceof Error ? err.message : String(err)}`);
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
    if (d.kind === "move" && d.reorder) {
      const starts = shuffleLayout(d.clip, d.followers, delta);
      const commands = [{ trackId: d.trackId, clip: d.clip }, ...d.followers]
        .filter((m) => starts.get(m.clip.id) !== m.clip.start)
        .map((m) => ({ type: "move-clip" as const, trackId: m.trackId, clipId: m.clip.id, start: starts.get(m.clip.id) ?? m.clip.start }));
      if (commands.length) engine.dispatch({ type: "batch", commands });
    } else if (d.kind === "move")
      engine.dispatch({
        type: "batch",
        commands: d.group.map((m) => ({ type: "move-clip" as const, trackId: m.trackId, clipId: m.clip.id, start: m.clip.start + delta })),
      });
    else if (d.stretch) {
      const ratio = (d.clip.length + delta) / d.clip.length;
      if (Math.abs(ratio - 1) >= 0.001) void stretchGroup(d.group, ratio);
    }
    else if (d.kind === "trim-left" || d.kind === "trim-right") {
      const left = d.kind === "trim-left";
      const bounds = d.group.map((m) => ({
        type: "set-clip-bounds" as const,
        trackId: m.trackId,
        clipId: m.clip.id,
        start: left && !d.ripple ? m.clip.start + delta : m.clip.start,
        sourceIn: left ? m.clip.sourceIn + delta : m.clip.sourceIn,
        length: left ? m.clip.length - delta : m.clip.length + delta,
      }));
      const shiftBy = left ? -delta : delta;
      const moves = d.ripple ? d.followers.map((f) => ({ type: "move-clip" as const, trackId: f.trackId, clipId: f.clip.id, start: f.clip.start + shiftBy })) : [];
      engine.dispatch({ type: "batch", commands: [...bounds, ...moves] });
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
    lastPointerY = e.clientY;
    if (drag && drag.kind === "move" && drag.moved && drag.group.length === 1) markDropLane(laneAt(e.clientY), drag.group[0].trackId);
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
    // AU-07: alignment guides: a moved clip's start or end within 6 px of another clip's edge (any track) or the
    // playhead snaps to it, and a guide line marks where they align
    let guideAt: number | null = null;
    if (drag.kind === "move") {
      const moving = drag.clip;
      const start = moving.start + next * spp;
      let best = 6 * spp;
      const edges = [engine.get("transport").positionSamples, ...doc.tracks.flatMap((t) => t.clips.filter((c) => c.id !== moving.id).flatMap((c) => [c.start, c.start + c.length]))];
      for (const edge of edges) {
        for (const offset of [0, moving.length]) {
          const gap = Math.abs(start + offset - edge);
          if (gap < best) {
            best = gap;
            guideAt = edge;
            next = Math.min(drag.high, Math.max(drag.low, (edge - offset - moving.start) / spp));
          }
        }
      }
    }
    showGuide(guideAt, spp);
    drag.dx = next;
    preview(drag, spp);
  });
  const showGuide = (at: number | null, spp: number) => {
    for (const body of lanes.querySelectorAll<HTMLElement>(".fw-lane-body")) {
      let guide = body.querySelector<HTMLElement>(":scope > .fw-align-guide");
      if (at === null) {
        if (guide && !guide.hidden) guide.hidden = true;
        continue;
      }
      if (!guide) {
        guide = document.createElement("div");
        guide.className = "fw-align-guide";
        guide.setAttribute("aria-hidden", "true");
        body.append(guide);
      }
      const left = `${(at / spp).toFixed(1)}px`;
      if (guide.style.left !== left) guide.style.left = left;
      if (guide.hidden) guide.hidden = false;
    }
  };
  lanes.addEventListener("pointerup", () => showGuide(null, 1));

  // Free clip placement: a single moved clip released over another lane goes to that track, mono or stereo,
  // replacing what it overlaps there; the lane under the pointer is marked while dragging.
  let lastPointerY = 0;
  const laneAt = (y: number) =>
    [...lanes.querySelectorAll<HTMLElement>(".fw-lane")].find((l) => {
      const r = l.getBoundingClientRect();
      return y >= r.top && y < r.bottom;
    }) ?? null;
  const markDropLane = (lane: HTMLElement | null, from: string | null) => {
    for (const l of lanes.querySelectorAll<HTMLElement>(".fw-lane[data-drop]")) if (l !== lane || lane.dataset.key === from) delete l.dataset.drop;
    if (lane && from !== null && lane.dataset.key !== from && lane.dataset.drop === undefined) lane.dataset.drop = "";
  };

  const endDrag = (apply: boolean) => {
    const d = drag;
    drag = null;
    markDropLane(null, null);
    if (!d) return;
    if (apply && d.moved && d.kind === "move" && d.group.length === 1) {
      const target = laneAt(lastPointerY)?.dataset.key;
      const only = d.group[0];
      if (target && target !== only.trackId) {
        restore(d);
        const start = Math.max(0, Math.round(only.clip.start + d.dx * samplesPerPixel(engine.get("document"))));
        engine.dispatch({ type: "move-clip-to-track", trackId: only.trackId, clipId: only.clip.id, toTrackId: target, start });
        void adaptToTrack(target, [only.clip.id]);
        return;
      }
    }
    if (!d.moved) {
      if (apply && (d.kind === "fade-in" || d.kind === "fade-out")) {
        // S5: a click on a fade changes that edge's curve alone
        const out = (c: Clip) => c.fadeOutShape ?? c.fadeShape ?? "linear";
        const shape = d.kind === "fade-in" ? nextFadeShape(d.clip.fadeShape) : nextFadeShape(out(d.clip));
        engine.dispatch({
          type: "batch",
          commands: d.group.map((m) => ({
            type: "set-clip-fades" as const,
            trackId: m.trackId,
            clipId: m.clip.id,
            fadeIn: m.clip.fadeIn ?? 0,
            fadeOut: m.clip.fadeOut ?? 0,
            ...(d.kind === "fade-in" ? { shape, outShape: out(m.clip) } : { outShape: shape }),
          })),
        });
      }
      return;
    }
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
  let rangeClip: { clip: RangeClip; trackId: string } | null = null;
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

  // AU-06: a stereo clip that lands on a mono track, pasted or dragged there, is mixed down to mono, as reference editors do on
  // paste (a mono clip on a stereo track already plays on both sides); the engine's Downmix makes the mono media, set as
  // the clip's media (a second undo step, after the paste or move)
  const adaptToTrack = async (trackId: string, clipIds: Iterable<string>) => {
    const ids = new Set(clipIds);
    const doc = engine.get("document");
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track || track.channels !== 1) return;
    for (const clip of track.clips.filter((c) => ids.has(c.id))) {
      if ((doc.media[clip.mediaId]?.channels ?? 1) < 2) continue;
      const res = await fetch(`/api/media/${clip.mediaId}/effect?name=downmix-mono`, { method: "POST" });
      if (!res.ok) continue;
      engine.dispatch({ type: "set-clip-media", trackId, clipId: clip.id, media: (await res.json()) as SessionDoc["media"][string] });
    }
  };

  // PLAN_v13 S13, Paste Special > Repeat to fill selection: the copied clips (as one block) laid end to end across the
  // range on its track from its start, the last copy cut at the range's end
  host.addEventListener("fw-paste-repeat", () => {
    const doc = engine.get("document");
    const r = range;
    const say = (s: string) => setText(host.querySelector<HTMLElement>(".fw-notice"), s);
    if (!clipboard.length) return say("Copy clips first (Cmd or Ctrl C)");
    if (!r || r.end <= r.start || !doc.tracks.some((t) => t.id === r.trackId)) return say("Draw a range to fill");
    const origin = Math.min(...clipboard.map((c) => c.clip.start));
    const span = Math.max(...clipboard.map((c) => c.clip.start + c.clip.length)) - origin;
    if (span <= 0) return;
    const commands: Dispatchable[] = [{ type: "clear-range", trackId: r.trackId, start: r.start, end: r.end, ripple: false }];
    for (let at = r.start; at < r.end; at += span) {
      for (const { clip } of clipboard) {
        const start = at + clip.start - origin;
        if (start >= r.end) continue;
        const length = Math.min(clip.length, r.end - start);
        commands.push({ type: "paste-clip", trackId: r.trackId, clip: { mediaId: clip.mediaId, start, length, sourceIn: clip.sourceIn, gainDb: clip.gainDb, fadeIn: Math.min(clip.fadeIn ?? 0, length), fadeOut: length < clip.length ? 0 : clip.fadeOut, fadeShape: clip.fadeShape } });
      }
    }
    engine.dispatch({ type: "batch", commands, label: "Repeated to fill the selection" });
    say(`Filled ${((r.end - r.start) / doc.sampleRate).toFixed(2)} s with ${commands.length - 1} copies`);
  });
  // S13, Paste Special > Merge: the copied note clips' notes added into the note clip under the playhead on the same
  // track (nothing there is replaced), the clip played again with its instrument, in one step
  host.addEventListener("fw-paste-merge", () => {
    const doc = engine.get("document");
    const say = (s: string) => setText(host.querySelector<HTMLElement>(".fw-notice"), s);
    const copied = clipboard.filter((c) => c.clip.notes?.length);
    if (!copied.length) return say("Copy a note clip first (Cmd or Ctrl C)");
    const at = engine.get("transport").positionSamples;
    const track = doc.tracks.find((t) => t.id === copied[0].trackId);
    const target = track?.clips.find((c) => c.notes && at >= c.start && at < c.start + c.length);
    if (!track || !target) return say("Put the playhead inside a note clip on the copied clip's track");
    const origin = Math.min(...copied.map((c) => c.clip.start));
    const added = copied.flatMap(({ clip }) => (clip.notes ?? []).map((n) => ({ ...n, at: at + clip.start - origin + n.at - target.start })));
    const fits = added.filter((n) => n.at >= 0 && n.at < target.length).map((n) => ({ ...n, length: Math.min(n.length, target.length - n.at) }));
    const key = (n: { at: number; pitch: number }) => `${n.at}:${n.pitch}`;
    const have = new Set((target.notes ?? []).map(key));
    const merged = [...(target.notes ?? []), ...fits.filter((n) => !have.has(key(n)))].sort((a, b) => a.at - b.at || a.pitch - b.pitch);
    if (merged.length === target.notes?.length) return say("Nothing to merge: the copied notes are there already or fall outside the clip");
    say("Merging the notes...");
    void renderNotes(engine, track.id, target.id, merged).then(
      () => say(`Merged ${merged.length - (target.notes?.length ?? 0)} notes into the clip`),
      (err) => say(`Could not merge: ${err instanceof Error ? err.message : String(err)}`),
    );
  });
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
          ...(clip.fadeOutShape ? { fadeOutShape: clip.fadeOutShape } : {}),
          ...(clip.name ? { name: clip.name } : {}),
          ...(clip.mute ? { mute: true } : {}),
          ...(clip.takes ? { takes: [...clip.takes], take: clip.take } : {}),
        },
      });
    }
    const before = new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    engine.dispatch({ type: "batch", commands });
    selectedClipIds.clear();
    for (const track of engine.get("document").tracks) for (const clip of track.clips) if (!before.has(clip.id)) selectedClipIds.add(clip.id);
    markSelected();
    for (const track of engine.get("document").tracks) void adaptToTrack(track.id, [...selectedClipIds]);
  };

  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "g") {
      const ids = [...selectedClipIds];
      if (e.shiftKey ? !ids.length : ids.length < 2) return;
      e.preventDefault();
      const groupId = e.shiftKey ? null : `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      engine.dispatch({ type: "set-clip-group", clipIds: ids, groupId });
      markSelected();
      return;
    }
    // AU-05, split variants on a range, each one undo step: Ctrl+Alt+X split-cut (the range to the clip
    // clipboard, a gap left), Ctrl+Alt+K split-delete (a gap left, whatever Shuffle says), Ctrl+Alt+I split to a new
    // track (the range's audio moved to a new track at the same time, a gap left)
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && range && ["x", "k", "i"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const key = e.key.toLowerCase();
      const r = range;
      const doc = engine.get("document");
      const track = doc.tracks.find((t) => t.id === r.trackId);
      const pieces = (track?.clips ?? [])
        .filter((c) => c.start < r.end && r.start < c.start + c.length)
        .map((c) => ({ clip: c, a: Math.max(r.start, c.start), b: Math.min(r.end, c.start + c.length) }));
      if (!track || !pieces.length) return;
      clearRange();
      const commands: Dispatchable[] = [{ type: "clear-range", trackId: track.id, start: r.start, end: r.end, ripple: false }];
      if (key === "x") {
        clipboard = pieces.map(({ clip, a, b }) => ({ trackId: track.id, clip: { ...clip, start: a, length: b - a, sourceIn: clip.sourceIn + (a - clip.start), fadeIn: 0, fadeOut: 0 } }));
        rangeClip = null;
      }
      if (key === "i") {
        for (const { clip, a, b } of pieces) {
          const media = doc.media[clip.mediaId];
          if (media) commands.push({ type: "import-media", media, at: a, clip: { sourceIn: clip.sourceIn + (a - clip.start), length: b - a } });
        }
      }
      engine.dispatch({ type: "batch", commands });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        for (const track of engine.get("document").tracks) for (const clip of track.clips) selectedClipIds.add(clip.id);
        markSelected();
        return;
      }
      // S5, range copy and paste: the range's audio and its track's
      // automation, pasted over what lies at the destination; the last copy, of clips or a range, is what pastes
      if ((key === "c" || key === "x") && range) {
        const r = range;
        const copied = copyRange(engine.get("document"), r);
        if (!copied) return;
        e.preventDefault();
        rangeClip = { clip: copied, trackId: r.trackId };
        clipboard = [];
        if (key === "x") {
          clearRange();
          const cut = engine.dispatch({ type: "batch", label: "Cut a range", commands: [{ type: "clear-range", trackId: r.trackId, start: r.start, end: r.end, ripple: shuffleEnabled(), follow: "tracks" }] });
          if (!cut && engine.get("document").tracks.some((t) => t.clips.some((c) => c.lock))) {
            setText(host.querySelector(".fw-notice"), "A locked clip is in the way, so the range is copied, not cut: Clip > Edit lock or Time lock unlocks it");
            return;
          }
        }
        setText(host.querySelector(".fw-notice"), `${key === "x" ? "Cut" : "Copied"} ${(copied.length / engine.get("document").sampleRate).toFixed(3)} s; Cmd or Ctrl V pastes it at the playhead or over a range`);
        return;
      }
      if (key === "v" && rangeClip) {
        e.preventDefault();
        const doc = engine.get("document");
        const trackId = [range?.trackId, pickedTrack, rangeClip.trackId].find((id) => id && doc.tracks.some((t) => t.id === id));
        const at = range ? range.start : engine.get("transport").positionSamples;
        const command = trackId ? pasteRange(doc, rangeClip.clip, trackId, at, shuffleEnabled()) : null;
        if (!command || !trackId) return;
        if (!engine.dispatch(command)) {
          if (doc.tracks.some((t) => t.clips.some((c) => c.lock))) setText(host.querySelector(".fw-notice"), "A locked clip is in the way of the paste: Clip > Edit lock or Time lock unlocks it");
          return;
        }
        range = { trackId, start: Math.round(at), end: Math.round(at) + rangeClip.clip.length };
        rangeBand = null;
        lanes.dispatchEvent(new CustomEvent("fw-range", { bubbles: true, detail: range }));
        drawRange();
        return;
      }
      if (key === "c" || key === "x") {
        const chosen = selectedClips();
        if (!chosen.length) return;
        e.preventDefault();
        rangeClip = null;
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
    // the keypad's plus and minus nudge (ui/editing.ts)
    if ((e.key === "=" || e.key === "+") && e.code !== "NumpadAdd") setZoom(zoom * 2);
    else if (e.key === "-" && e.code !== "NumpadSubtract") setZoom(zoom / 2);
    else if (e.key === "0") setZoom(1);
    else if (range && (e.key === "Delete" || e.key === "Backspace")) {
      const r = range;
      clearRange();
      const ids = [r.trackId, ...(r.more ?? [])];
      const cleared = ids.map((trackId) => ({ type: "clear-range" as const, trackId, start: r.start, end: r.end, ripple: shuffleEnabled(), follow: "tracks" as const }));
      engine.dispatch(cleared.length > 1 ? { type: "batch", commands: cleared } : cleared[0]);
    } else if (range && e.key.toLowerCase() === "s") {
      const r = range;
      const ids = [r.trackId, ...(r.more ?? [])];
      // End first: a split keeps the left piece's id, so the start split still finds the same clip.
      const commands = engine.get("document").tracks.filter((t) => ids.includes(t.id)).flatMap((t) =>
        t.clips.flatMap((c) => [r.end, r.start].filter((at) => at > c.start && at < c.start + c.length).map((at) => ({ type: "split-clip" as const, trackId: t.id, clipId: c.id, at }))),
      );
      if (commands.length) engine.dispatch({ type: "batch", commands });
    } else if (range && e.key === "Escape") clearRange();
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
