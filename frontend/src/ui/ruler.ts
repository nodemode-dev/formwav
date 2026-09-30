import type { Engine } from "../engine";
import type { Player } from "../audio/player";
import { documentLength } from "../engine/document";
import { barsEnabled, labelStep, setBeatGrid, snapSamples } from "./grid";
import { onZoom, samplesPerPixel } from "./lanes";

const MIN_MINOR_PX = 6;

function label(seconds: number, step: number): string {
  const minutes = Math.floor(seconds / 60 + 1e-9);
  const rest = Math.max(0, seconds - minutes * 60);
  const text = step < 1 ? rest.toFixed(step < 0.5 ? 2 : 1) : String(Math.round(rest));
  return `${minutes}:${rest < 10 ? "0" : ""}${text}`;
}

export function mountRuler(host: HTMLElement, engine: Engine, player: Player): void {
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!stage || !lanes) return;
  const ruler = document.createElement("div");
  ruler.className = "fw-ruler";
  ruler.innerHTML = `<div class="fw-ruler-corner"></div><canvas class="fw-ruler-canvas" aria-label="Timeline: click to move the playhead"></canvas>`;
  stage.insertBefore(ruler, lanes);
  const corner = ruler.firstElementChild as HTMLElement;
  const canvas = ruler.lastElementChild as HTMLCanvasElement;
  let lastWidth = "";

  const draw = () => {
    const doc = engine.get("document");
    if (!doc.tracks.length) return;
    const spp = samplesPerPixel(doc);
    const width = Math.max(Math.ceil(documentLength(doc) / spp), stage.clientWidth - corner.offsetWidth);
    const cssWidth = `${width}px`;
    if (cssWidth !== lastWidth) {
      lastWidth = cssWidth;
      canvas.style.width = cssWidth;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const style = getComputedStyle(canvas);
    const height = h / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    ctx.textBaseline = "top";

    const pxPerSecond = doc.sampleRate / spp;
    const tempo = barsEnabled() && doc.tempo ? doc.tempo : null;
    setBeatGrid(tempo ? 60 / tempo.bpm : null);
    ctx.fillStyle = style.color;
    if (tempo) {
      // Bars and beats (Audacity's beats and measures ruler): a line at each bar, numbered every 1, 2, 4... bars as
      // zoom allows; beat ticks from 6 px apart, labelled bar.beat from 48 px.
      const beatPx = (60 / tempo.bpm) * pxPerSecond;
      const barPx = beatPx * tempo.beatsPerBar;
      let every = 1;
      while (every * barPx < 48) every *= 2;
      for (let b = 0; b * beatPx <= width; b++) {
        const x = Math.round(b * beatPx);
        const inBar = b % tempo.beatsPerBar;
        const barIndex = Math.floor(b / tempo.beatsPerBar);
        if (inBar === 0) {
          ctx.fillRect(x, height * 0.5, 1, height);
          if (barIndex % every === 0) ctx.fillText(String(barIndex + 1), x + 4, 3);
        } else if (beatPx >= 6) {
          ctx.fillRect(x, height * 0.75, 1, height);
          if (beatPx >= 48) ctx.fillText(`${barIndex + 1}.${inBar + 1}`, x + 4, 3);
        }
      }
    } else {
      const step = labelStep(pxPerSecond);
      const minor = step / 5;
      const drawMinor = minor * pxPerSecond >= MIN_MINOR_PX;
      for (let i = 0; i * minor * pxPerSecond <= width; i++) {
        const major = i % 5 === 0;
        if (!major && !drawMinor) continue;
        const x = Math.round(i * minor * pxPerSecond);
        ctx.fillRect(x, major ? height * 0.5 : height * 0.75, 1, height);
        if (major) ctx.fillText(label(i * minor, step), x + 4, 3);
      }
    }

    ctx.fillStyle = style.outlineColor;
    for (const region of doc.regions ?? []) {
      const x0 = region.start / spp;
      ctx.fillRect(x0, height - 4, Math.max(1, (region.end - region.start) / spp), 4);
      ctx.fillText(region.label, x0 + 4, height - 16);
    }
    for (const marker of doc.markers) {
      const x = Math.round(marker.at / spp);
      ctx.fillRect(x, 0, 1, height);
      ctx.fillRect(x, height - 8, 6, 8);
      ctx.fillText(marker.label, x + 8, height - 16);
    }

    const range = pending ?? doc.loop;
    if (range) {
      ctx.fillStyle = style.borderTopColor;
      ctx.globalAlpha = pending || doc.loop?.enabled ? 1 : 0.35;
      const x0 = range.start / spp;
      const x1 = range.end / spp;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), 3);
      ctx.fillRect(x0, 0, 1, height);
      ctx.fillRect(Math.max(x0, x1 - 1), 0, 1, height);
      ctx.globalAlpha = 1;
    }
  };

  let pending: { start: number; end: number } | null = null;
  let pressX: number | null = null;
  const toSamples = (x: number) => {
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    return snapSamples(Math.max(0, x) * spp, doc.sampleRate, doc.sampleRate / spp);
  };
  // Audacity 4's draggable playhead: a press within 6 px of it grabs it, and dragging seeks (once a frame) instead of
  // drawing a loop range; a press anywhere else keeps click-to-seek and drag-for-loop.
  let dragHead = false;
  let headRaf = 0;
  let headX: number | null = null;
  const headPx = () => engine.get("transport").positionSamples / samplesPerPixel(engine.get("document"));
  const nearHead = (x: number) => engine.get("document").tracks.length > 0 && Math.abs(x - headPx()) <= 6;
  const seekSoon = (x: number) => {
    headX = x;
    if (headRaf) return;
    headRaf = requestAnimationFrame(() => {
      headRaf = 0;
      if (headX !== null) player.seek(toSamples(headX));
    });
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !engine.get("document").tracks.length) return;
    if (nearHead(e.offsetX)) {
      dragHead = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    pressX = e.offsetX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragHead) {
      seekSoon(e.offsetX);
      return;
    }
    if (pressX === null) {
      const cursor = nearHead(e.offsetX) ? "ew-resize" : "";
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
    if (pressX === null || (!pending && Math.abs(e.offsetX - pressX) < 4)) return;
    const a = toSamples(pressX);
    const b = toSamples(e.offsetX);
    pending = { start: Math.min(a, b), end: Math.max(a, b) };
    draw();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (dragHead) {
      dragHead = false;
      headX = null;
      if (headRaf) cancelAnimationFrame(headRaf);
      headRaf = 0;
      player.seek(toSamples(e.offsetX));
      return;
    }
    if (pressX === null) return;
    const range = pending;
    pressX = null;
    pending = null;
    if (range && range.end > range.start) {
      engine.dispatch({ type: "set-loop", start: range.start, end: range.end, enabled: engine.get("document").loop?.enabled ?? false });
      draw();
    } else {
      player.seek(toSamples(e.offsetX));
      if (range) draw();
    }
  });
  canvas.addEventListener("pointercancel", () => {
    dragHead = false;
    headX = null;
    pressX = null;
    if (pending) {
      pending = null;
      draw();
    }
  });
  engine.subscribe("document", draw);
  onZoom(draw);
  document.addEventListener("nm:ui-settings-changed", draw);
  document.addEventListener("fw-bars-changed", draw);
  window.addEventListener("resize", draw);
  draw();
}
