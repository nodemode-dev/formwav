import type { Clip, Engine, MediaRef, SessionDoc, Track } from "../engine";
import { documentLength, fadeCurve, nextFadeShape, sessionLength, type AutoPoint } from "../engine/document";
import { fetchPeaks, type PeakData } from "../io/media-client";
import { gridEnabled, shuffleEnabled, snapSamples, spotEnabled } from "./grid";
import { armedTrack, onArm, setArmedTrack } from "./arm";
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
  const curve = (v: number) => fadeCurve(v, clip.fadeShape);
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
  fadeIn.title = "Drag to set the fade-in; click to change its curve";
  const fadeOut = document.createElement("span");
  fadeOut.className = "fw-fade-handle fw-fade-out";
  fadeOut.title = "Drag to set the fade-out; click to change its curve";
  const gain = document.createElement("span");
  gain.className = "fw-gain-line";
  const takeBadge = document.createElement("button");
  takeBadge.type = "button";
  takeBadge.className = "fw-take";
  takeBadge.hidden = true;
  takeBadge.title = "Loop-recorded takes: click to play the next one";
  node.append(canvas, fadeIn, fadeOut, gain, takeBadge);
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
  const badge = node.querySelector<HTMLButtonElement>(".fw-take");
  if (badge) {
    const count = clip.takes?.length ?? 0;
    const hide = count < 2;
    if (badge.hidden !== hide) badge.hidden = hide;
    const label = hide ? "" : `Take ${(clip.take ?? count - 1) + 1}/${count}`;
    if (badge.textContent !== label) badge.textContent = label;
  }
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
  lane.innerHTML = `<div class="fw-lane-head"><span class="fw-lane-name"></span><button type="button" class="fw-arm" aria-pressed="false" aria-label="Arm track for recording" title="Arm this track: recording goes into it at the playhead"></button><button type="button" class="fw-takes-toggle" hidden aria-expanded="false" title="Show every take as a lane; drag across a take to comp that range">Takes</button><span class="fw-lane-meta"></span><div class="fw-lane-meter" aria-hidden="true"><div class="fw-out-track"><div class="fw-out-bar"></div></div><div class="fw-out-track"><div class="fw-out-bar"></div></div></div><button type="button" class="fw-auto-toggle" aria-expanded="false" title="Show volume and pan automation: click a line to add a point, drag to move it, Alt-click to delete it">Auto</button></div><div class="fw-lane-body"></div><div class="fw-auto-heads" hidden aria-hidden="true"><span>Volume</span><span>Pan L / R</span></div><div class="fw-auto-rows" hidden><div class="fw-auto-row" data-param="volume" aria-label="Volume automation"><svg class="fw-auto-svg"><polyline class="fw-auto-line"></polyline><g class="fw-auto-points"></g></svg></div><div class="fw-auto-row" data-param="pan" aria-label="Pan automation, left at the top"><svg class="fw-auto-svg"><polyline class="fw-auto-line"></polyline><g class="fw-auto-points"></g></svg></div></div><div class="fw-take-heads" hidden aria-hidden="true"></div><div class="fw-take-rows" hidden></div>`;
  return lane;
}

function updateLane(node: HTMLElement, track: Track, doc: SessionDoc, spp: number): void {
  setText(node.querySelector(".fw-lane-name"), track.name);
  const arm = node.querySelector<HTMLElement>(".fw-arm");
  const armed = String(armedTrack() === track.id);
  if (arm && arm.getAttribute("aria-pressed") !== armed) arm.setAttribute("aria-pressed", armed);
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
  const autoOpen = autoTracks.has(track.id);
  const autoToggle = node.querySelector<HTMLElement>(".fw-auto-toggle");
  if (autoToggle && autoToggle.getAttribute("aria-expanded") !== String(autoOpen)) autoToggle.setAttribute("aria-expanded", String(autoOpen));
  const autoRows = node.querySelector<HTMLElement>(".fw-auto-rows");
  const autoHeads = node.querySelector<HTMLElement>(".fw-auto-heads");
  if (autoHeads && autoHeads.hidden === autoOpen) autoHeads.hidden = !autoOpen;
  if (autoRows) {
    if (autoRows.hidden === autoOpen) autoRows.hidden = !autoOpen;
    if (autoOpen) for (const row of autoRows.querySelectorAll<HTMLElement>(".fw-auto-row")) drawAutoLane(row, track, row.dataset.param === "pan" ? "pan" : "volume", spp);
  }
  const takeClips = track.clips.filter((c) => (c.takes?.length ?? 0) > 1);
  const count = takeClips.reduce((most, c) => Math.max(most, c.takes?.length ?? 0), 0);
  const open = count > 0 && expandedTracks.has(track.id);
  const toggle = node.querySelector<HTMLButtonElement>(".fw-takes-toggle");
  if (toggle) {
    if (toggle.hidden !== (count === 0)) toggle.hidden = count === 0;
    if (toggle.getAttribute("aria-expanded") !== String(open)) toggle.setAttribute("aria-expanded", String(open));
  }
  const takeHeads = node.querySelector<HTMLElement>(".fw-take-heads");
  if (takeHeads) {
    if (takeHeads.hidden === open) takeHeads.hidden = !open;
    if (open)
      patchList(takeHeads, Array.from({ length: count }, (_, k) => k), {
        key: (k) => String(k),
        create: (k) => {
          const label = document.createElement("span");
          label.textContent = `Take ${k + 1}`;
          return label;
        },
        update: () => {},
      });
  }
  const rows = node.querySelector<HTMLElement>(".fw-take-rows");
  if (!rows) return;
  if (rows.hidden === open) rows.hidden = !open;
  if (!open) return;
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
  patchList(rows, Array.from({ length: count }, (_, k) => k), {
    key: (k) => String(k),
    create: (k) => {
      const row = document.createElement("div");
      row.className = "fw-take-row";
      row.dataset.take = String(k);
      row.setAttribute("aria-label", `Take ${k + 1}`);
      fillRow(row, k);
      return row;
    },
    update: (row, k) => fillRow(row, k),
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

/** Where a value sits down an automation row, 0 at the top: volume +12 to -36 dB; pan left (-1) to right (+1). */
function autoFraction(param: AutoParam, value: number): number {
  return param === "volume" ? gainFraction(value) : Math.min(1, Math.max(0, (value + 1) / 2));
}

/** The value at a fraction down an automation row (the inverse of autoFraction), rounded as the document stores it. */
function autoValue(param: AutoParam, frac: number): number {
  return param === "volume" ? Math.round((GAIN_TOP_DB - frac * GAIN_SPAN_DB) * 10) / 10 : Math.round((frac * 2 - 1) * 100) / 100;
}

/** Draws one automation row: the line through the points (held before the first and after the last), a circle per point; with no automation a dashed line shows the static fader or pan. */
function drawAutoLane(row: HTMLElement, track: Track, param: AutoParam, spp: number, points: AutoPoint[] = track.automation?.[param] ?? []): void {
  const svg = row.querySelector<SVGSVGElement>(".fw-auto-svg");
  const line = svg?.querySelector<SVGPolylineElement>(".fw-auto-line");
  const group = svg?.querySelector<SVGGElement>(".fw-auto-points");
  if (!svg || !line || !group) return;
  const y = (value: number) => (AUTO_INSET + autoFraction(param, value) * (AUTO_ROW_H - 2 * AUTO_INSET)).toFixed(1);
  const x = (time: number) => (time / spp).toFixed(1);
  const fallback = param === "volume" ? track.gainDb : track.pan ?? 0;
  const last = points[points.length - 1];
  const coords = points.length
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

  lanes.addEventListener("click", (e) => {
    const arm = (e.target as HTMLElement).closest<HTMLElement>(".fw-arm");
    const id = arm?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!arm || !id) return;
    setArmedTrack(armedTrack() === id ? null : id);
  });
  onArm(() => render(engine.get("document")));
  lanes.addEventListener("click", (e) => {
    const toggle = (e.target as HTMLElement).closest<HTMLElement>(".fw-takes-toggle");
    const id = toggle?.closest<HTMLElement>(".fw-lane")?.dataset.key;
    if (!toggle || !id) return;
    if (expandedTracks.has(id)) expandedTracks.delete(id);
    else expandedTracks.add(id);
    render(engine.get("document"));
  });

  let takeDrag: { trackId: string; clip: Clip; take: number; seg: HTMLElement; x0: number; moved: boolean } | null = null;
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

  let autoDrag: { trackId: string; row: HTMLElement; param: AutoParam; index: number; points: AutoPoint[] } | null = null;
  const autoPointAt = (row: HTMLElement, param: AutoParam, e: PointerEvent): AutoPoint => {
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
    const param: AutoParam = row.dataset.param === "pan" ? "pan" : "volume";
    const points = [...(track.automation?.[param] ?? [])];
    const circle = (e.target as Element).closest("circle");
    let index = circle?.parentElement ? Array.from(circle.parentElement.children).indexOf(circle) : -1;
    if (index >= 0 && e.altKey) {
      points.splice(index, 1);
      engine.dispatch({ type: "set-automation", trackId, param, points });
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
    if (apply) engine.dispatch({ type: "set-automation", trackId: d.trackId, param: d.param, points: d.points });
    else render(engine.get("document"));
  };
  lanes.addEventListener("pointerup", () => endAuto(true));
  lanes.addEventListener("pointercancel", () => endAuto(false));

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

  const markSelected = () => {
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const on = String(node.dataset.key !== undefined && selectedClipIds.has(node.dataset.key));
      if (node.getAttribute("aria-selected") !== on) node.setAttribute("aria-selected", on);
    }
  };

  type GestureKind = "move" | "trim-left" | "trim-right" | "fade-in" | "fade-out" | "gain";
  type Member = { trackId: string; clip: Clip; node: HTMLElement };
  type Gesture = { kind: GestureKind; node: HTMLElement; trackId: string; clip: Clip; startX: number; startY: number; dx: number; dy: number; moved: boolean; low: number; high: number; group: Member[]; ripple: boolean; followers: Member[]; reorder: boolean };
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
    if (spotEnabled() && kind === "move" && !e.shiftKey) {
      e.preventDefault();
      selectedClipIds.clear();
      selectedClipIds.add(clip.id);
      markSelected();
      openSpot(trackId, clip, node);
      return;
    }
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
    drag = { kind, node, trackId, clip, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, low, high, group, ripple, followers, reorder };
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
    if (!d) return;
    if (!d.moved) {
      if (apply && (d.kind === "fade-in" || d.kind === "fade-out")) {
        const shape = nextFadeShape(d.clip.fadeShape);
        engine.dispatch({
          type: "batch",
          commands: d.group.map((m) => ({
            type: "set-clip-fades" as const,
            trackId: m.trackId,
            clipId: m.clip.id,
            fadeIn: m.clip.fadeIn ?? 0,
            fadeOut: m.clip.fadeOut ?? 0,
            shape,
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
          ...(clip.takes ? { takes: [...clip.takes], take: clip.take } : {}),
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
