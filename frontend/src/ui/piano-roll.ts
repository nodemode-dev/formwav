import type { Engine } from "../engine";
import type { NoteEvent } from "../engine/document";
import { midiFile, renderNotes } from "../audio/notes";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * The note editor (PT-17): the selected note clip's notes on a canvas, a keyboard column at the left, a pitch-by-time
 * grid with beat lines, the notes (opacity by velocity, the selected in the accent), and a velocity lane beneath.
 * Click empty grid to add a note; drag a note to move it, its right edge to resize it; drag a velocity bar; Delete
 * removes the selection. A drag only redraws; letting go commits the gesture through renderNotes (set-clip-notes), so
 * each gesture is one re-render and one undo step. Beats are at 120 BPM until formwav has a tempo map. The canvas
 * carries its geometry as data attributes (keyW, low, rows, rowH, pxPerFrame, velH) for tests to aim at notes.
 */
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_W = 44;
const VEL_H = 52;
const MIN_ROWS = 24;
const BEAT_SECONDS = 0.5;
const EDGE_PX = 6;

const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const black = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);

export function mountPianoRoll(host: HTMLElement, engine: Engine): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const transport = pane?.querySelector<HTMLElement>(".fw-transport");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  if (!pane || !transport || !view) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.dataset.piano = "";
  toggle.setAttribute("aria-pressed", "false");
  toggle.title = "Show the note editor for the selected note clip";
  toggle.innerHTML = "<span>Notes</span>";
  view.append(toggle);

  const panel = document.createElement("section");
  panel.className = "fw-piano";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Note editor");
  panel.innerHTML = `<div class="fw-piano-head"><label class="fw-piano-opt">Snap <select data-snap aria-label="Snap"><option value="0">Off</option><option value="1">1/4</option><option value="0.5">1/8</option><option value="0.25" selected>1/16</option></select></label><button type="button" class="fw-ibtn" data-zoom="out" title="Shorter rows (Ctrl or Cmd and the wheel)">Zoom −</button><button type="button" class="fw-ibtn" data-zoom="in" title="Taller rows (Ctrl or Cmd and the wheel)">Zoom +</button><button type="button" class="fw-ibtn" data-zoom="fit" title="Fit the notes; the wheel scrolls pitch">Fit</button><button type="button" class="fw-ibtn" data-quantize title="Move the selected notes' starts (all notes when none is selected) to the snap grid (Q)">Quantize</button><button type="button" class="fw-ibtn" data-export-midi title="Save this note clip as a Standard MIDI File (120 BPM)">Export MIDI</button><span class="fw-piano-state" role="status"></span></div><canvas class="fw-piano-canvas" tabindex="0" aria-label="Notes: click to add, drag to move, drag an edge to resize, Delete to remove"></canvas>`;
  transport.before(panel);
  const canvas = panel.querySelector("canvas") as HTMLCanvasElement;
  const state = panel.querySelector<HTMLElement>(".fw-piano-state");
  const snapSelect = panel.querySelector<HTMLSelectElement>("[data-snap]") as HTMLSelectElement;

  // Several note clips edit together on one grid in session time (PT-17): each note keeps its owning clip (owner),
  // converted back into that clip's media frames when a gesture commits; `target` is the first, for the guards.
  type Target = { trackId: string; clipId: string; start: number; sourceIn: number; ratio: number; length: number };
  let target: { trackId: string; clipId: string } | null = null;
  let wanted: { trackId: string; clipId: string }[] = [];
  let targets: Target[] = [];
  let owner: number[] = [];
  let origin = 0;
  let notes: NoteEvent[] = [];
  let selected = new Set<number>();
  let rate = 48000;
  let low = 60;
  let rows = MIN_ROWS;
  let rowH = 10;
  let pxPerFrame = 0.01;
  let dragging = false;
  let userRowH = 0;
  let topPitch: number | null = null;

  const findClips = (ids: readonly string[]) => {
    const doc = engine.get("document");
    const found: { trackId: string; clipId: string }[] = [];
    for (const t of doc.tracks) for (const c of t.clips) if (ids.includes(c.id) && c.notes && c.notes.length) found.push({ trackId: t.id, clipId: c.id });
    return found;
  };
  const load = () => {
    const doc = engine.get("document");
    targets = [];
    owner = [];
    notes = [];
    let firstName = "notes";
    for (const w of wanted) {
      const clip = doc.tracks.find((t) => t.id === w.trackId)?.clips.find((c) => c.id === w.clipId);
      if (!clip || !clip.notes) continue;
      const ratio = doc.sampleRate / (doc.media[clip.mediaId]?.sampleRate ?? doc.sampleRate);
      if (!targets.length) firstName = doc.media[clip.mediaId]?.name.replace(/\.wav$/i, "") ?? "notes";
      const index = targets.push({ trackId: w.trackId, clipId: w.clipId, start: clip.start, sourceIn: clip.sourceIn, ratio, length: clip.length }) - 1;
      for (const n of clip.notes) {
        notes.push({ ...n, at: clip.start + (n.at - clip.sourceIn) * ratio, length: n.length * ratio });
        owner.push(index);
      }
    }
    rate = doc.sampleRate;
    target = targets.length ? { trackId: targets[0].trackId, clipId: targets[0].clipId } : null;
    origin = targets.length ? Math.min(...targets.map((t) => t.start)) : 0;
    if (!target) {
      setText(state, "Select a note clip to edit its notes");
      return;
    }
    setText(state, targets.length === 1 ? `${firstName} · ${notes.length} notes` : `${targets.length} clips · ${notes.length} notes`);
  };
  const snapFrames = () => Math.round(Number(snapSelect.value) * BEAT_SECONDS * rate);
  const snap = (frame: number) => {
    const s = snapFrames();
    return s > 0 ? Math.round(frame / s) * s : Math.round(frame);
  };

  const layout = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pitches = notes.map((n) => n.pitch);
    let lo = (pitches.length ? Math.min(...pitches) : 60) - 4;
    let hi = (pitches.length ? Math.max(...pitches) : 72) + 4;
    while (hi - lo + 1 < MIN_ROWS) {
      lo -= 1;
      if (hi - lo + 1 < MIN_ROWS) hi += 1;
    }
    const avail = Math.max(1, h - VEL_H);
    // fit to the notes until the user zooms (Ctrl or Cmd and the wheel) or scrolls (the wheel); Fit returns to it
    rowH = userRowH > 0 ? userRowH : Math.max(4, avail / (hi - lo + 1));
    rows = Math.max(1, Math.min(128, Math.floor(avail / rowH)));
    const top = Math.min(127, Math.max(rows - 1, topPitch ?? Math.min(127, Math.max(hi, lo + rows - 1))));
    low = Math.max(0, top - rows + 1);
    const end = Math.max(rate, ...notes.map((n) => n.at + n.length - origin)) + rate / 2;
    pxPerFrame = Math.max(1e-6, (w - KEY_W) / end);
    Object.assign(canvas.dataset, { keyW: String(KEY_W), low: String(low), rows: String(rows), rowH: String(rowH), pxPerFrame: String(pxPerFrame), velH: String(VEL_H), origin: String(origin) });
    return { w, h };
  };
  const yOf = (pitch: number) => (low + rows - 1 - pitch) * rowH;
  const xOf = (frame: number) => KEY_W + (frame - origin) * pxPerFrame;

  const draw = () => {
    if (panel.hidden) return;
    const { w, h } = layout();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(panel);
    const v = (name: string) => css.getPropertyValue(name).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = v("--surface-0");
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < rows; i++) {
      const pitch = low + rows - 1 - i;
      ctx.fillStyle = black(pitch) ? v("--surface-0") : v("--surface-1");
      ctx.fillRect(KEY_W, i * rowH, w - KEY_W, rowH);
      ctx.fillStyle = black(pitch) ? v("--bg-tertiary") : v("--surface-2");
      ctx.fillRect(0, i * rowH, KEY_W - 1, rowH - 0.5);
      if (pitch % 12 === 0) {
        ctx.fillStyle = v("--text-muted");
        ctx.font = `10px ${v("--font-mono") || "monospace"}`;
        ctx.fillText(noteName(pitch), 4, i * rowH + rowH - 2);
      }
    }
    const beat = BEAT_SECONDS * rate;
    for (let b = 0; xOf(b * beat) < w; b++) {
      ctx.fillStyle = b % 4 === 0 ? v("--line-2") : v("--line-0");
      ctx.fillRect(Math.round(xOf(b * beat)), 0, 1, h - VEL_H);
    }
    ctx.fillStyle = v("--surface-1");
    ctx.fillRect(0, h - VEL_H, w, VEL_H);
    ctx.fillStyle = v("--line-1");
    ctx.fillRect(0, h - VEL_H, w, 1);
    notes.forEach((n, i) => {
      const on = selected.has(i);
      ctx.globalAlpha = 0.45 + 0.55 * (n.velocity / 127);
      ctx.fillStyle = on ? v("--accent-color") : v("--fw-audio");
      ctx.fillRect(xOf(n.at), yOf(n.pitch) + 1, Math.max(3, n.length * pxPerFrame), Math.max(2, rowH - 2));
      ctx.globalAlpha = 1;
      const barH = ((VEL_H - 8) * n.velocity) / 127;
      ctx.fillRect(xOf(n.at), h - 4 - barH, 3, barH);
    });
  };

  const commit = async () => {
    if (!target) return;
    setText(state, "Rendering…");
    // a snapshot first: each render updates the document, which reloads this editor while the loop is still running
    const edited = notes.map((n) => ({ ...n }));
    const owners = [...owner];
    const clips = [...targets];
    try {
      for (let t = 0; t < clips.length; t++) {
        const tg = clips[t];
        const mine = edited.filter((_, i) => owners[i] === t).map((n) => ({ ...n, at: Math.max(0, Math.round((n.at - tg.start) / tg.ratio + tg.sourceIn)), length: Math.max(1, Math.round(n.length / tg.ratio)) }));
        const doc = engine.get("document");
        const clip = doc.tracks.find((x) => x.id === tg.trackId)?.clips.find((c) => c.id === tg.clipId);
        if (!clip || !mine.length || JSON.stringify(clip.notes) === JSON.stringify(mine)) continue;
        await renderNotes(engine, tg.trackId, tg.clipId, mine);
      }
    } catch (err) {
      setText(state, `Not rendered: ${err instanceof Error ? err.message : String(err)}`);
      load();
      draw();
    }
  };

  const hit = (x: number, y: number) => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const x0 = xOf(n.at);
      const x1 = x0 + Math.max(3, n.length * pxPerFrame);
      const y0 = yOf(n.pitch);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y0 + rowH) return { index: i, edge: x1 - x <= EDGE_PX };
    }
    return null;
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!target) return;
    canvas.focus();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const h = canvas.clientHeight;
    if (x < KEY_W) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    let changed = false;
    let move: (ev: PointerEvent) => void;
    if (y > h - VEL_H) {
      const index = notes.findIndex((n) => x >= xOf(n.at) && x <= xOf(n.at) + Math.max(3, n.length * pxPerFrame));
      if (index < 0) {
        dragging = false;
        return;
      }
      move = (ev) => {
        const vy = ev.clientY - r.top;
        notes[index] = { ...notes[index], velocity: Math.min(127, Math.max(1, Math.round(((h - 4 - vy) / (VEL_H - 8)) * 127))) };
        changed = true;
        draw();
      };
      move(e);
    } else {
      const found = hit(x, y);
      if (!found) {
        const length = snapFrames() || Math.round(BEAT_SECONDS * rate * 0.5);
        const at = Math.max(0, snap(origin + (x - KEY_W) / pxPerFrame));
        notes.push({ at, length, pitch: Math.min(127, Math.max(0, low + rows - 1 - Math.floor(y / rowH))), velocity: 100 });
        owner.push(Math.max(0, targets.findIndex((t) => at >= t.start && at < t.start + t.length)));
        selected = new Set([notes.length - 1]);
        changed = true;
        draw();
        move = () => {};
      } else {
        if (!e.shiftKey && !selected.has(found.index)) selected = new Set();
        selected.add(found.index);
        const start = notes.map((n) => ({ ...n }));
        const resizing = found.edge;
        move = (ev) => {
          const dFrames = (ev.clientX - r.left - x) / pxPerFrame;
          const dRows = Math.round((ev.clientY - r.top - y) / rowH);
          for (const i of selected) {
            const n = start[i];
            notes[i] = resizing
              ? { ...n, length: Math.max(snapFrames() || Math.round(rate / 100), snap(n.length + dFrames)) }
              : { ...n, at: Math.max(0, snap(n.at + dFrames)), pitch: Math.min(127, Math.max(0, n.pitch - dRows)) };
          }
          changed = true;
          draw();
        };
        draw();
      }
    }
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      dragging = false;
      if (changed) void commit();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });

  const zoom = (factor: number) => {
    userRowH = Math.min(28, Math.max(4, (userRowH || rowH) * factor));
    draw();
  };
  // the selected notes' starts (all notes' when none is selected) moved to the snap grid, one gesture
  const quantize = () => {
    const s = snapFrames();
    if (!target || s <= 0 || !notes.length) return;
    const which = selected.size ? selected : new Set(notes.map((_, i) => i));
    let changed = false;
    notes = notes.map((n, i) => {
      if (!which.has(i)) return n;
      const at = Math.round(n.at / s) * s;
      if (at !== n.at) changed = true;
      return { ...n, at };
    });
    draw();
    if (changed) void commit();
  };
  panel.querySelector('[data-zoom="out"]')?.addEventListener("click", () => zoom(1 / 1.25));
  panel.querySelector('[data-zoom="in"]')?.addEventListener("click", () => zoom(1.25));
  panel.querySelector('[data-zoom="fit"]')?.addEventListener("click", () => {
    userRowH = 0;
    topPitch = null;
    draw();
  });
  panel.querySelector("[data-quantize]")?.addEventListener("click", quantize);
  panel.querySelector("[data-export-midi]")?.addEventListener("click", () => {
    if (!target || !notes.length) return;
    const doc = engine.get("document");
    const clip = doc.tracks.find((t) => t.id === target?.trackId)?.clips.find((c) => c.id === target?.clipId);
    const name = `${(clip ? doc.media[clip.mediaId]?.name : undefined)?.replace(/\.wav$/i, "") ?? "notes"}.mid`;
    const url = URL.createObjectURL(new Blob([midiFile(notes.map((n) => ({ ...n, at: n.at - origin })), rate)], { type: "audio/midi" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setText(state, `Exported ${name}`);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      else {
        topPitch = Math.min(127, Math.max(rows - 1, (topPitch ?? low + rows - 1) + (e.deltaY < 0 ? 2 : -2)));
        draw();
      }
    },
    { passive: false },
  );

  canvas.addEventListener("keydown", (e) => {
    if (e.key === "q" || e.key === "Q") {
      e.preventDefault();
      e.stopPropagation();
      quantize();
      return;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    // the editor's Delete removes notes; it must never reach the lanes, which would delete the selected clip
    e.preventDefault();
    e.stopPropagation();
    if (selected.size && target) {
      owner = owner.filter((_, i) => !selected.has(i));
      notes = notes.filter((_, i) => !selected.has(i));
      selected = new Set();
      draw();
      if (notes.length) void commit();
      else setText(state, "A note clip keeps at least one note: delete the clip to remove them all");
    }
  });

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-pressed", String(!panel.hidden));
    draw();
  });
  host.addEventListener("fw-selection", (e) => {
    const ids = (e as CustomEvent<string[]>).detail ?? [];
    const found = findClips(ids);
    if (!found.length) return;
    wanted = found;
    selected = new Set();
    load();
    draw();
  });
  engine.subscribe("document", () => {
    if (dragging) return;
    load();
    draw();
  });
  new ResizeObserver(() => draw()).observe(canvas);
  load();
}
