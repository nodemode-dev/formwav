import type { Engine, SessionDoc } from "../engine";
import type { Player } from "../audio/player";
import { documentLength } from "../engine/document";
import { formatPosition, frameRate, nominal, samplesAtFrame, type FrameRate, type TimeFormat } from "../engine/timebase";
import { barBeatAt, barsBetween, barStartTick, bpmAt, keyAt, meterAtTick, sampleToTick, tempoMap, tickToSample, ticksPerBeat } from "../engine/tempo";
import { chordsPerBar } from "../engine/midi";
import { RULERS, rulers } from "./counters";
import { barsEnabled, labelStep, setBeatGrid, snapSamples } from "./grid";
import { onZoom, samplesPerPixel } from "./lanes";
import { CLOCK_MODES, clockMode, timecodeRate, timeOf } from "./shell";

const MIN_MINOR_PX = 6;
const ROW_H = 20;

function label(seconds: number, step: number): string {
  const minutes = Math.floor(seconds / 60 + 1e-9);
  const rest = Math.max(0, seconds - minutes * 60);
  // AU-13: as many decimals as the step needs (0.1 needs 1, 0.25 needs 2, 0.0001 needs 4), up to 6
  let decimals = 0;
  while (decimals < 6 && Math.abs(step * 10 ** decimals - Math.round(step * 10 ** decimals)) > 1e-9) decimals++;
  const text = step < 1 ? rest.toFixed(Math.max(step < 0.5 ? 2 : 1, decimals)) : String(Math.round(rest));
  return `${minutes}:${rest < 10 ? "0" : ""}${text}`;
}

/** S6: one timebase's ticks and labels in a row `h` high at `y0`, across the visible pixels: Min:Secs at the main
 *  ruler's steps, samples at 1, 2 and 5 times a power of ten, bars at the session's tempo, and timecode and Feet+Frames
 *  on whole frames at `rate` (whole seconds and minutes once frames crowd), labels at least 60 to 90 px apart. */
function drawRow(g: CanvasRenderingContext2D, doc: SessionDoc, fmt: TimeFormat | "tempo" | "meter" | "key" | "chords", rate: FrameRate, y0: number, h: number, left: number, view: number, spp: number): void {
  const time = timeOf(doc);
  const sr = doc.sampleRate;
  const tick = (x: number, major: boolean) => g.fillRect(Math.round(x), y0 + h * (major ? 0.5 : 0.75), 1, h * (major ? 0.5 : 0.25));
  const text = (x: number, s: string) => g.fillText(s, Math.round(x) + 4, y0 + 3);
  const each = (stepPx: number, fn: (k: number) => void) => {
    for (let k = Math.max(0, Math.floor(left / stepPx) - 1); k * stepPx <= left + view + stepPx; k++) fn(k);
  };
  if (fmt === "min_secs") {
    const step = labelStep(sr / spp);
    const minorPx = ((step / 5) * sr) / spp;
    each(minorPx, (i) => {
      if (i % 5 !== 0 && minorPx < MIN_MINOR_PX) return;
      tick(i * minorPx, i % 5 === 0);
      if (i % 5 === 0) text(i * minorPx, label((i * step) / 5, step));
    });
  } else if (fmt === "samples") {
    let step = 1;
    while (step / spp < 90) step *= String(step).startsWith("2") ? 2.5 : 2;
    each(step / spp, (k) => {
      tick((k * step) / spp, true);
      text((k * step) / spp, String(k * step));
    });
  } else if (fmt === "bars_beats") {
    const map = tempoMap(doc);
    const barPx = ((sr * 60) / time.bpm) * time.beatsPerBar / spp;
    let every = 1;
    while (every * barPx < 60 && every < 65536) every *= 2;
    for (const b of barsBetween(map, Math.max(0, left - 90) * spp, (left + view) * spp)) {
      if (b.bar % every !== 0) continue;
      tick(b.at / spp, true);
      text(b.at / spp, String(b.bar + 1));
      const start = barStartTick(map, b.bar);
      if (barPx >= 240) for (let k = 1; k < b.num; k++) tick(tickToSample(map, start + k * ticksPerBeat(b.den)) / spp, false);
    }
  } else if (fmt === "tempo" || fmt === "meter" || fmt === "key" || fmt === "chords") {
    // S11: the map rows: each change's value where it starts (the first at 0), chords one a bar
    const map = tempoMap(doc);
    const marks: [number, string][] =
      fmt === "tempo"
        ? [[0, doc.tempo?.bpm ?? 120], ...(doc.tempoChanges ?? []).map((c) => [c.tick, c.bpm] as [number, number])].map(([t, bpm]) => [tickToSample(map, t), `${+bpm.toFixed(2)}`])
        : fmt === "meter"
          ? map.meters.map((m) => [tickToSample(map, m.tick), `${m.num}/${m.den}`])
          : fmt === "key"
            ? [...(doc.key ? [[0, doc.key.name] as [number, string]] : []), ...(doc.keyChanges ?? []).map((k) => [tickToSample(map, k.tick), k.key] as [number, string])]
            : chordsPerBar(doc).map((c) => [c.at, c.name]);
    let lastX = -Infinity;
    for (const [at, s] of marks) {
      const x = at / spp;
      if (x > left + view || x < left - 200) continue;
      tick(x, true);
      if (x - lastX >= 28) text(x, s);
      lastX = x;
    }
  } else {
    const perFrame = (sr * rate.den) / rate.num;
    const base = nominal(rate);
    const seconds = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600].map((s) => s * base);
    const steps = fmt === "feet_frames" ? [1, 2, 4, 8, 16, 32, 64, 160, 320, 640, 1600, 3200, 6400, 16000, 32000] : [1, 2, 5, 10, ...seconds];
    const step = steps.find((s) => (s * perFrame) / spp >= 72) ?? steps[steps.length - 1];
    each((step * perFrame) / spp, (k) => {
      const at = samplesAtFrame(k * step, rate, sr);
      tick(at / spp, true);
      text(at / spp, formatPosition(at, fmt, time, rate));
    });
  }
}

export function mountRuler(host: HTMLElement, engine: Engine, player: Player): void {
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!stage || !lanes) return;
  const ruler = document.createElement("div");
  ruler.className = "fw-ruler";
  // AU-13: the first canvas spans the timeline and takes the clicks (it holds no pixels); the second, only the visible
  // window wide, paints, so a timeline zoomed to single samples (millions of pixels) never needs a canvas that big
  ruler.innerHTML = `<div class="fw-ruler-corner"><span class="fw-ruler-title">Sections, time</span></div><canvas class="fw-ruler-canvas" aria-label="Timeline: click to move the playhead"></canvas><canvas class="fw-ruler-canvas fw-ruler-paint" aria-hidden="true"></canvas><div class="fw-ruler-names" aria-hidden="true"></div>`;
  stage.insertBefore(ruler, lanes);
  const corner = ruler.firstElementChild as HTMLElement;
  const canvas = ruler.children[1] as HTMLCanvasElement;
  const paint = ruler.children[2] as HTMLCanvasElement;
  const names = ruler.children[3] as HTMLElement;
  let lastWidth = "";
  // S6: the rulers chosen (ui/counters.ts) as rows under the main one, each named in the corner column
  const placeRows = () => {
    const shown = rulers();
    const rows = String(shown.length);
    if (ruler.style.getPropertyValue("--fw-ruler-rows") !== rows) ruler.style.setProperty("--fw-ruler-rows", rows);
    const text = shown.map((id) => RULERS.find((r) => r.id === id)?.label ?? id);
    if ([...names.children].map((n) => n.textContent).join("|") !== text.join("|")) names.replaceChildren(...text.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
  };
  placeRows();

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
    if (canvas.width !== 1) canvas.width = 1;
    if (canvas.height !== 1) canvas.height = 1;
    const dpr = window.devicePixelRatio || 1;
    const left = Math.min(stage.scrollLeft, Math.max(0, width - 1));
    const view = Math.max(1, Math.min(width - left, stage.clientWidth - corner.offsetWidth));
    const paintLeft = `${corner.offsetWidth + left}px`;
    const paintWidth = `${view}px`;
    if (paint.style.left !== paintLeft) paint.style.left = paintLeft;
    if (paint.style.width !== paintWidth) paint.style.width = paintWidth;
    const w = Math.max(1, Math.round(view * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (paint.width !== w) paint.width = w;
    if (paint.height !== h) paint.height = h;
    const ctx = paint.getContext("2d");
    if (!ctx) return;
    const style = getComputedStyle(canvas);
    const total = h / dpr;
    const height = Math.min(total, corner.offsetHeight || total);
    ctx.setTransform(dpr, 0, 0, dpr, -left * dpr, 0);
    ctx.clearRect(left, 0, view, total);
    ctx.font = `${style.fontSize} ${style.fontFamily}`;
    ctx.textBaseline = "top";

    const pxPerSecond = doc.sampleRate / spp;
    const tempo = barsEnabled() && doc.tempo ? doc.tempo : null;
    setBeatGrid(tempo ? 60 / tempo.bpm : null);
    ctx.fillStyle = style.color;
    const rate = timecodeRate(doc);
    rulers().forEach((id, i) => {
      const y0 = height + i * ROW_H;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(left, y0, view, 1);
      ctx.globalAlpha = 1;
      drawRow(ctx, doc, id === "timecode2" ? "timecode" : (id as TimeFormat), id === "timecode2" ? frameRate(rate.id === "25" ? "30" : "25") : rate, y0, ROW_H, left, view, spp);
    });
    const mainFormat = CLOCK_MODES.find((m) => m.id === clockMode())?.format ?? "min_secs";
    if (!tempo && mainFormat !== "min_secs") {
      // S6: the main ruler in the main counter's timebase, the markers over it as before
      drawRow(ctx, doc, mainFormat, rate, 0, height, left, view, spp);
    } else if (tempo) {
      // Bars and beats (the beats and measures ruler): a line at each bar, numbered every 1, 2, 4... bars as
      // zoom allows; beat ticks from 6 px apart, labelled bar.beat from 48 px.
      // S11: bar by bar along the tempo and meter map, so a tempo or meter change moves every line after it
      const map = tempoMap(doc);
      const bars = barsBetween(map, Math.max(0, left - 60) * spp, Math.min(width, left + view) * spp);
      const barPx = (60 / tempo.bpm) * pxPerSecond * tempo.beatsPerBar;
      let every = 1;
      while (every * barPx < 48) every *= 2;
      for (const b of bars) {
        const x = Math.round(b.at / spp);
        ctx.fillRect(x, height * 0.5, 1, height * 0.5);
        if (b.bar % every === 0) ctx.fillText(String(b.bar + 1), x + 4, 3);
        const start = barStartTick(map, b.bar);
        for (let beat = 1; beat < b.num; beat++) {
          const bx = Math.round(tickToSample(map, start + beat * ticksPerBeat(b.den)) / spp);
          const beatPx = (bx - x) / beat;
          if (beatPx < 6) break;
          ctx.fillRect(bx, height * 0.75, 1, height * 0.25);
          if (beatPx >= 48) ctx.fillText(`${b.bar + 1}.${beat + 1}`, bx + 4, 3);
        }
      }
    } else {
      const step = labelStep(pxPerSecond);
      const minor = step / 5;
      const drawMinor = minor * pxPerSecond >= MIN_MINOR_PX;
      const tickPx = minor * pxPerSecond;
      for (let i = Math.max(0, Math.floor((left - 5 * tickPx) / tickPx)); i * tickPx <= Math.min(width, left + view + tickPx); i++) {
        const major = i % 5 === 0;
        if (!major && !drawMinor) continue;
        const x = Math.round(i * minor * pxPerSecond);
        ctx.fillRect(x, major ? height * 0.5 : height * 0.75, 1, height * (major ? 0.5 : 0.25));
        if (major) ctx.fillText(label(i * minor, step), x + 4, 3);
      }
    }

    // S5: a memory location with a colour of its own is drawn in it
    const palette = getComputedStyle(document.documentElement);
    const tint = (color: string | undefined) => (color && palette.getPropertyValue(`--fw-color-${color}`).trim()) || style.outlineColor;
    for (const region of doc.regions ?? []) {
      const x0 = region.start / spp;
      ctx.fillStyle = tint(region.color);
      ctx.fillRect(x0, height - 4, Math.max(1, (region.end - region.start) / spp), 4);
      ctx.fillText(region.label, x0 + 4, height - 16);
    }
    for (const marker of doc.markers) {
      const x = Math.round(marker.at / spp);
      ctx.fillStyle = tint(marker.color);
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
  // The draggable playhead: a press within 6 px of it grabs it, and dragging seeks (once a frame) instead of
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
  // Scrubbing (AU-42): dragging the playhead plays what passes under it, at the drag's own speed (0.25 to 4 times);
  // moving back seeks back and plays forward in short bursts (seek-scrub); holding still goes quiet; the
  // release restores the speed slider's value and keeps playing only if playback was running before the grab
  let scrub: { wasPlaying: boolean; x: number; t: number; idle: number } | null = null;
  const sliderSpeed = () => 2 ** (Number(host.querySelector<HTMLInputElement>("[data-speed]")?.value) || 0);
  const scrubStart = (e: PointerEvent) => {
    scrub = { wasPlaying: engine.get("transport").playing, x: e.offsetX, t: e.timeStamp, idle: 0 };
  };
  const scrubMove = (e: PointerEvent) => {
    if (!scrub) return;
    const dt = (e.timeStamp - scrub.t) / 1000;
    if (dt > 0) {
      const frames = Math.abs(toSamples(e.offsetX) - toSamples(scrub.x));
      player.setSpeed(Math.min(4, Math.max(0.25, frames / dt / engine.get("document").sampleRate)));
    }
    scrub.x = e.offsetX;
    scrub.t = e.timeStamp;
    if (!engine.get("transport").playing) void player.play();
    window.clearTimeout(scrub.idle);
    scrub.idle = window.setTimeout(() => {
      if (dragHead && engine.get("transport").playing) player.stop();
    }, 120);
  };
  const scrubEnd = () => {
    if (!scrub) return;
    window.clearTimeout(scrub.idle);
    player.setSpeed(sliderSpeed());
    if (!scrub.wasPlaying && engine.get("transport").playing) player.stop();
    else if (scrub.wasPlaying && !engine.get("transport").playing) void player.play();
    scrub = null;
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !engine.get("document").tracks.length) return;
    if (nearHead(e.offsetX)) {
      dragHead = true;
      canvas.setPointerCapture(e.pointerId);
      scrubStart(e);
      return;
    }
    pressX = e.offsetX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragHead) {
      scrubMove(e);
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
      scrubEnd();
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
  // S11: double-clicking the Tempo, Meter or Key row sets a change at the bar under the pointer (the first bar sets the
  // session's own); Tempo 0, Meter 0 or Key None removes the change there
  type Values = Record<string, number | string | null>;
  const ask = (title: string, note: string, fields: unknown[], ok: string) =>
    new Promise<Values | null>((done) => host.dispatchEvent(new CustomEvent("fw-ask", { detail: { title, note, fields, ok, done } })));
  canvas.addEventListener("dblclick", async (e) => {
    const row = rulers()[Math.floor((e.offsetY - corner.offsetHeight) / ROW_H)];
    if (e.offsetY < corner.offsetHeight || (row !== "tempo" && row !== "meter" && row !== "key")) return;
    const doc = engine.get("document");
    const map = tempoMap(doc);
    const { bar } = barBeatAt(map, sampleToTick(map, e.offsetX * samplesPerPixel(doc)));
    const tick = barStartTick(map, bar);
    const where = `bar ${bar + 1}`;
    if (row === "tempo") {
      const v = await ask("Tempo change", `The tempo from ${where} on, in quarter notes a minute; 0 removes the change there.`, [{ key: "bpm", label: "Tempo", value: bpmAt(map, tick), min: 0, max: 300, step: 0.001, unit: "BPM" }], "Set");
      if (v && typeof v.bpm === "number") engine.dispatch({ type: "set-tempo-change", tick, bpm: v.bpm > 0 ? v.bpm : null });
    } else if (row === "meter") {
      const m = meterAtTick(map, tick);
      const v = await ask("Meter change", `The meter from ${where} on; 0 beats removes the change there.`, [{ key: "num", label: "Beats", value: m.num, min: 0, max: 32, step: 1 }, { key: "den", label: "Of", value: String(m.den), options: [["2", "half notes"], ["4", "quarter notes"], ["8", "eighth notes"], ["16", "sixteenth notes"]] }], "Set");
      if (v && typeof v.num === "number") engine.dispatch({ type: "set-meter-change", bar, num: Math.max(1, v.num), den: Number(v.den), remove: v.num <= 0 });
    } else {
      const keys = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"].flatMap((k) => [`${k} major`, `${k} minor`]);
      const v = await ask("Key change", `The key from ${where} on.`, [{ key: "key", label: "Key", value: keyAt(doc, tick) ?? "C major", options: [["", "None"], ...keys.map((k) => [k, k])] }], "Set");
      if (v) engine.dispatch({ type: "set-key-change", tick, key: typeof v.key === "string" && v.key ? v.key : null });
    }
  });
  canvas.addEventListener("pointercancel", () => {
    dragHead = false;
    headX = null;
    pressX = null;
    scrubEnd();
    if (pending) {
      pending = null;
      draw();
    }
  });
  engine.subscribe("document", draw);
  onZoom(draw);
  document.addEventListener("fw:clock-mode", draw); // PT-26: labels follow the clock's timecode
  document.addEventListener("fw:rulers", () => {
    placeRows();
    draw();
  });
  // AU-13: the paint canvas covers only what is in view, so scrolling repaints it (once a frame)
  let scrollRaf = 0;
  stage.addEventListener(
    "scroll",
    () => {
      if (!scrollRaf)
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          draw();
        });
    },
    { passive: true },
  );
  stage.addEventListener("fw-scrolled", draw);
  document.addEventListener("nm:ui-settings-changed", draw);
  document.addEventListener("fw-bars-changed", draw);
  window.addEventListener("resize", draw);
  draw();
}
