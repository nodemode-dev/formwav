import type { Engine } from "../engine";
import type { Command, NoteEvent } from "../engine/document";
import { gridStepOf, parseGrid, snapToGrid } from "../engine/grid";
import { noteName } from "../engine/midi";
import { DEFAULT_SYLLABLE, singingOrder } from "../engine/lyrics";
import { durationSplit, lyricWords, notePhonemes, parsePhonemes, type Piece } from "../engine/pronounce";

/** L2: what the editor knows of each note's pronunciation, by its index in the editor. */
export type Sung = { phonemes: (string[] | null)[]; edited: boolean[]; guessed: boolean[]; pieces: Piece[][] };
import { midiFile, renderNoteMedia } from "../audio/notes";
import { setText } from "../vendor/nodemode/dom-stable";
import { fpsOf } from "./midi-input";

/**
 * The note editor (PT-17): the selected note clip's notes on a canvas, a keyboard column at the left, a pitch-by-time
 * grid with beat lines, the notes (opacity by velocity, the selected in the accent), and a velocity lane beneath.
 * Click empty grid to add a note, drag across it to select the notes in a band (Shift adds to the selection); drag a
 * note to move it, its right edge to resize it; drag a velocity bar; Delete removes the selection, Cmd or Ctrl A
 * selects every note, the arrow keys move it (a semitone up or down, an octave with Shift; a grid step either way).
 * A drag only redraws; letting go commits the gesture through the core's rendering (set-clip-notes), so each gesture
 * is one re-render and one undo step, and a run of arrow keys commits once they stop. S7: the grid, its lines and new
 * notes follow the session's tempo and meter. The canvas carries its geometry as data attributes (keyW, low, rows,
 * rowH, pxPerFrame, velH) for tests to aim at notes.
 */
const KEY_W = 44;
const VEL_H = 52;
const LYR_H = 20;
const MIN_ROWS = 24;
const EDGE_PX = 6;
const BAND_PX = 4;
const ARROW_COMMIT_MS = 600;

const black = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);

/** One note clip the editor holds: where it sits and how its media frames map onto the session's. */
export type NoteTarget = { trackId: string; clipId: string; start: number; sourceIn: number; ratio: number; length: number };

/** What the note editor offers the Event menu and the event list (S7): its notes in session frames, the clip each
 *  belongs to (an index into targets), the selection, and a way to replace them as one undo step. */
export interface NoteEditor {
  view(): { notes: readonly NoteEvent[]; owner: readonly number[]; selected: ReadonlySet<number>; targets: readonly NoteTarget[]; origin: number };
  apply(notes: NoteEvent[], owner: number[], label: string, selected?: ReadonlySet<number>, extra?: readonly Command[]): Promise<boolean>;
  select(indexes: ReadonlySet<number>): void;
  onChange(fn: () => void): void;
  panel: HTMLElement;
  setList(open: boolean): void;
  listOpen(): boolean;
  /** L1: edit the lyric of the selected note in place, and move every lyric from it one note later or earlier. */
  editLyric(): void;
  shiftLyrics(by: 1 | -1): void;
  /** L2: each note's phonemes (null while its word is being looked up), whether edited or guessed, and their timing;
   *  a note's pronunciation edited in place; a lyric or phonemes set from outside the canvas (the event list). */
  sung(): Sung;
  editPronunciation(): void;
  setLyric(index: number, text: string): void;
  setPhonemes(index: number, text: string): boolean;
}

export function mountPianoRoll(host: HTMLElement, engine: Engine): NoteEditor | null {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const transport = pane?.querySelector<HTMLElement>(".fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  if (!pane || !transport || !view) return null;
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
  panel.innerHTML = `<div class="fw-piano-head"><label class="fw-piano-opt">Snap <select data-snap aria-label="Snap"><option value="">Off</option><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16" selected>1/16</option><option value="1/32">1/32</option><option value="1/8t">1/8 T</option><option value="1/16t">1/16 T</option></select></label><button type="button" class="fw-ibtn" data-zoom="out" aria-label="Zoom out" title="Shorter rows (Ctrl or Cmd and the wheel)">−</button><button type="button" class="fw-ibtn" data-zoom="in" aria-label="Zoom in" title="Taller rows (Ctrl or Cmd and the wheel)">+</button><button type="button" class="fw-ibtn" data-zoom="fit" title="Fit the notes; the wheel scrolls pitch">Fit</button><button type="button" class="fw-ibtn" data-quantize aria-haspopup="dialog" title="Quantize the selected notes (all notes when none is selected) with a strength, swing and their ends; Q quantizes again as last set">Quantize…</button><button type="button" class="fw-ibtn" data-list aria-pressed="false" title="The notes as a list, each edited by its values (Event list)">List</button><button type="button" class="fw-ibtn" data-step aria-pressed="false" title="Step input: play notes on a MIDI keyboard or the computer keys (A W S E D F T G Y H U J K; Z and X change the octave); each lands at the step cursor, one grid step long, and the cursor moves on; Space adds a rest, Backspace takes the last step back">Step</button><button type="button" class="fw-ibtn" data-export-midi title="Save this note clip as a Standard MIDI File at the session's tempo and meter">Export MIDI</button><span class="fw-piano-state" role="status"></span></div><canvas class="fw-piano-canvas" tabindex="0" aria-label="Notes: click to add, drag across to select, drag a note to move, drag an edge to resize, Delete to remove"></canvas><input class="fw-piano-lyric" data-lyric type="text" hidden spellcheck="false" autocomplete="off" aria-label="Lyric" title="Type a syllable, or paste a whole line: one syllable lands on each note from here on. Tab and Shift Tab move between notes, Enter keeps it, Escape leaves it"><div class="fw-piano-list" role="region" aria-label="Event list" hidden><table><thead><tr><th scope="col">Start</th><th scope="col">Note</th><th scope="col">Length (ticks)</th><th scope="col">Velocity</th><th scope="col">Lyric</th><th scope="col" title="ARPAbet, vowels with a stress digit (T W IH1 NG); empty for the lyric's own">Phonemes</th><th scope="col" title="Each phoneme's start and length in milliseconds from the note's start">Timing (ms)</th><th scope="col" aria-label="Remove"></th></tr></thead><tbody></tbody></table></div>`;
  transport.before(panel);
  const canvas = panel.querySelector("canvas") as HTMLCanvasElement;
  const state = panel.querySelector<HTMLElement>(".fw-piano-state");
  const snapSelect = panel.querySelector<HTMLSelectElement>("[data-snap]") as HTMLSelectElement;

  // Several note clips edit together on one grid in session time (PT-17): each note keeps its owning clip (owner),
  // converted back into that clip's media frames when a gesture commits; `target` is the first, for the guards.
  let target: { trackId: string; clipId: string } | null = null;
  let wanted: { trackId: string; clipId: string }[] = [];
  let targets: NoteTarget[] = [];
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
  let band: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let arrowTimer = 0;
  let stepping = false;
  let stepAt = 0;
  let stepOctave = 60;
  let stepTimer = 0;
  let lastStep = { time: 0, at: 0 };
  let editing = -1;
  let editMode: "lyric" | "phonemes" = "lyric";
  const lyricInput = panel.querySelector<HTMLInputElement>("[data-lyric]") as HTMLInputElement;
  const syllable = () => engine.get("document").singSyllable ?? DEFAULT_SYLLABLE;
  // L2: words' phonemes from the engine (CMUdict, or derived, or guessed), asked once each and kept for the session
  const words = new Map<string, { phonemes: string[]; source: string }>();
  const asking = new Set<string>();
  let sungCache: Sung | null = null;
  const computeSung = (): Sung => {
    if (sungCache) return sungCache;
    const out: Sung = { phonemes: notes.map(() => null), edited: notes.map((n) => Boolean(n.phonemes?.length)), guessed: notes.map(() => false), pieces: notes.map(() => []) };
    const missing = new Set<string>();
    targets.forEach((_, t) => {
      const mine = notes.map((_, i) => i).filter((i) => owner[i] === t);
      const sub = mine.map((i) => notes[i]);
      const ph = notePhonemes(sub, syllable(), (w) => words.get(w)?.phonemes);
      for (const w of lyricWords(sub, syllable())) {
        const known = words.get(w.word);
        if (!known && w.word) missing.add(w.word);
        if (known?.source === "guess") for (const k of w.notes) out.guessed[mine[k]] = true;
      }
      const pieces = durationSplit(sub, ph, rate);
      mine.forEach((i, k) => {
        out.phonemes[i] = ph[k];
        out.pieces[i] = pieces[k];
      });
    });
    if (missing.size) void askWords([...missing]);
    sungCache = out;
    return out;
  };
  const askWords = async (list: string[]) => {
    const wanted = list.filter((w) => !asking.has(w) && !words.has(w)).slice(0, 2000);
    if (!wanted.length) return;
    wanted.forEach((w) => asking.add(w));
    try {
      const res = await fetch("/api/midi/phonemes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ words: wanted }) });
      const body = res.ok ? ((await res.json()) as { words: { word: string; phonemes: string[]; source: string }[] }) : { words: [] };
      for (const w of body.words) words.set(w.word, { phonemes: w.phonemes, source: w.source });
    } catch (err) {
      void err;
    } finally {
      for (const w of wanted) if (!words.has(w)) words.set(w, { phonemes: [], source: "none" });
      sungCache = null;
      draw();
      notify();
      wanted.forEach((w) => asking.delete(w));
    }
  };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  const findClips = (ids: readonly string[]) => {
    const doc = engine.get("document");
    const found: { trackId: string; clipId: string }[] = [];
    for (const t of doc.tracks) for (const c of t.clips) if (ids.includes(c.id) && c.notes) found.push({ trackId: t.id, clipId: c.id });
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
      setText(state, "No note clip");
      return;
    }
    setText(state, targets.length === 1 ? `${firstName} · ${notes.length} notes` : `${targets.length} clips · ${notes.length} notes`);
  };
  // S7: the grid is the session's, at its tempo and meter (engine/grid.ts); a step in samples, and a position snapped
  const grid = () => parseGrid(snapSelect.value);
  const snapFrames = () => {
    const g = grid();
    return g ? gridStepOf(engine.get("document"), g, fpsOf(engine.get("document"))) : 0;
  };
  const snap = (frame: number) => {
    const g = grid();
    const doc = engine.get("document");
    return g ? snapToGrid(doc, g, frame, fpsOf(doc)) : Math.round(frame);
  };
  const beatFrames = () => {
    const doc = engine.get("document");
    return (rate * 60) / (doc.tempo?.bpm ?? 120);
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
    const avail = Math.max(1, h - VEL_H - LYR_H);
    // fit to the notes until the user zooms (Ctrl or Cmd and the wheel) or scrolls (the wheel); Fit returns to it
    rowH = userRowH > 0 ? userRowH : Math.max(4, avail / (hi - lo + 1));
    rows = Math.max(1, Math.min(128, Math.floor(avail / rowH)));
    const fitTop = rows >= hi - lo + 1 ? Math.max(hi, lo + rows - 1) : Math.ceil((lo + hi) / 2 + (rows - 1) / 2);
    const top = Math.min(127, Math.max(rows - 1, topPitch ?? Math.min(127, fitTop)));
    low = Math.max(0, top - rows + 1);
    const end = Math.max(rate, ...notes.map((n) => n.at + n.length - origin), ...targets.map((t) => t.start + t.length - origin)) + rate / 2;
    pxPerFrame = Math.max(1e-6, (w - KEY_W) / end);
    Object.assign(canvas.dataset, { keyW: String(KEY_W), low: String(low), rows: String(rows), rowH: String(rowH), pxPerFrame: String(pxPerFrame), velH: String(VEL_H), lyrH: String(LYR_H), origin: String(origin) });
    return { w, h };
  };
  const yOf = (pitch: number) => (low + rows - 1 - pitch) * rowH;
  const xOf = (frame: number) => KEY_W + (frame - origin) * pxPerFrame;

  const draw = () => {
    if (panel.hidden) return;
    sungCache = null;
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
    const beat = beatFrames();
    const perBar = Math.max(1, engine.get("document").tempo?.beatsPerBar ?? 4);
    for (let b = Math.max(0, Math.floor(origin / beat)); xOf(b * beat) < w; b++) {
      ctx.fillStyle = b % perBar === 0 ? v("--line-2") : v("--line-0");
      ctx.fillRect(Math.round(xOf(b * beat)), 0, 1, h - VEL_H - LYR_H);
    }
    ctx.fillStyle = v("--surface-1");
    ctx.fillRect(0, h - VEL_H - LYR_H, w, VEL_H + LYR_H);
    ctx.fillStyle = v("--line-1");
    ctx.fillRect(0, h - VEL_H - LYR_H, w, 1);
    ctx.fillRect(0, h - VEL_H, w, 1);
    // L1: the lyric lane, what each note sings at its start whatever the zoom (the higher note of a chord), the
    // default syllable dimmed; the note being edited is left to the field over it
    const laneY = h - VEL_H - LYR_H / 2;
    ctx.font = `11px ${v("--font-sans") || "sans-serif"}`;
    ctx.textBaseline = "middle";
    let lastX = -Infinity;
    for (const i of singingOrder(notes)) {
      const n = notes[i];
      const x = xOf(n.at) + 2;
      if (x < KEY_W || x <= lastX || i === editing) continue;
      lastX = x;
      ctx.globalAlpha = n.lyric ? 1 : 0.45;
      ctx.fillStyle = selected.has(i) ? v("--accent-color") : v("--text-primary");
      ctx.fillText(n.lyric ?? syllable(), x, laneY, Math.max(8, n.length * pxPerFrame - 3));
    }
    ctx.globalAlpha = 1;
    const sungNow = computeSung();
    notes.forEach((n, i) => {
      const on = selected.has(i);
      // a note outside the pitch rows in view stays inside the grid, never over the lyric or velocity lanes
      ctx.save();
      ctx.beginPath();
      ctx.rect(KEY_W, 0, w - KEY_W, h - VEL_H - LYR_H);
      ctx.clip();
      ctx.globalAlpha = 0.45 + 0.55 * (n.velocity / 127);
      ctx.fillStyle = on ? v("--accent-color") : v("--fw-audio");
      ctx.fillRect(xOf(n.at), yOf(n.pitch) + 1, Math.max(3, n.length * pxPerFrame), Math.max(2, rowH - 2));
      ctx.globalAlpha = 1;
      // L1: what the note sings, the default syllable dimmed, clipped to the note; only where a row can hold text
      const noteW = n.length * pxPerFrame;
      if (rowH >= 12 && noteW >= 14 && i !== editing) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(xOf(n.at), yOf(n.pitch), noteW - 2, rowH);
        ctx.clip();
        ctx.globalAlpha = n.lyric ? 1 : 0.5;
        ctx.fillStyle = v("--text-on-accent");
        ctx.font = `${Math.min(12, Math.floor(rowH - 2))}px ${v("--font-sans") || "sans-serif"}`;
        ctx.textBaseline = "middle";
        ctx.fillText(n.lyric ?? syllable(), xOf(n.at) + 3, yOf(n.pitch) + rowH / 2);
        ctx.restore();
      }
      // L2: the phonemes above the note once rows are 14 px, edited ones in the accent, guessed ones dimmed
      const ph = sungNow.phonemes[i];
      if (rowH >= 14 && ph?.length && yOf(n.pitch) > 10) {
        ctx.globalAlpha = sungNow.guessed[i] && !sungNow.edited[i] ? 0.55 : 0.9;
        ctx.fillStyle = sungNow.edited[i] ? v("--accent-color") : v("--text-muted");
        ctx.font = `9px ${v("--font-mono") || "monospace"}`;
        ctx.textBaseline = "bottom";
        ctx.fillText(ph.join(" "), xOf(n.at) + 1, yOf(n.pitch), Math.max(10, noteW + 24));
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.fillStyle = on ? v("--accent-color") : v("--fw-audio");
      const barH = ((VEL_H - 8) * n.velocity) / 127;
      ctx.fillRect(xOf(n.at), h - 4 - barH, 3, barH);
    });
    if (stepping && target) {
      ctx.fillStyle = v("--accent-color");
      ctx.fillRect(Math.round(xOf(stepAt)) - 1, 0, 2, h - VEL_H - LYR_H);
    }
    if (band) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = v("--accent-color");
      ctx.fillRect(Math.min(band.x0, band.x1), Math.min(band.y0, band.y1), Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0));
      ctx.globalAlpha = 1;
    }
    if (editing >= notes.length) {
      editing = -1;
      lyricInput.hidden = true;
    } else if (editing >= 0) placeLyric();
  };

  /** The editor's notes back in each clip's media frames, every clip rendered again, then one batch: one undo step
   *  however many clips changed, labelled as the gesture was (S7). */
  const commit = async (label = "Edited notes", extra: readonly Command[] = []) => {
    if (!target) return false;
    setText(state, "Rendering…");
    // a snapshot first: the document can change while the renders run
    const edited = notes.map((n) => ({ ...n }));
    const owners = [...owner];
    const clips = [...targets];
    try {
      const commands: Command[] = [];
      for (let t = 0; t < clips.length; t++) {
        const tg = clips[t];
        const mine = edited.filter((_, i) => owners[i] === t).map((n) => ({ ...n, at: Math.max(0, Math.round((n.at - tg.start) / tg.ratio + tg.sourceIn)), length: Math.max(1, Math.round(n.length / tg.ratio)) }));
        const doc = engine.get("document");
        const clip = doc.tracks.find((x) => x.id === tg.trackId)?.clips.find((c) => c.id === tg.clipId);
        if (!clip || JSON.stringify(clip.notes) === JSON.stringify(mine)) continue;
        const media = await renderNoteMedia(engine, tg.trackId, tg.clipId, mine);
        commands.push({ type: "set-clip-notes", trackId: tg.trackId, clipId: tg.clipId, notes: mine, media });
      }
      commands.push(...extra);
      if (commands.length) engine.dispatch(commands.length === 1 && label === "Edited notes" ? commands[0] : { type: "batch", commands, label });
      else {
        load();
        draw();
      }
      return commands.length > 0;
    } catch (err) {
      setText(state, `Not rendered: ${err instanceof Error ? err.message : String(err)}`);
      load();
      draw();
      return false;
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

  // L1: the lyric field sits over the note being edited, out of the panel's flow, so nothing around it moves; the
  // canvas skips that note's text while it is open. A note's index here maps to its clip and its index in that clip.
  const inClip = (i: number) => {
    let k = 0;
    for (let j = 0; j < i; j++) if (owner[j] === owner[i]) k++;
    return { tg: targets[owner[i]], k };
  };
  const placeLyric = () => {
    const n = notes[editing];
    if (!n) return;
    const width = Math.max(72, n.length * pxPerFrame);
    const height = 24;
    lyricInput.style.left = `${canvas.offsetLeft + Math.min(xOf(n.at), canvas.clientWidth - width)}px`;
    lyricInput.style.top = `${canvas.offsetTop + canvas.clientHeight - VEL_H - LYR_H / 2 - height / 2}px`;
    lyricInput.style.width = `${width}px`;
    lyricInput.style.height = `${height}px`;
  };
  const openLyric = (i: number, mode: "lyric" | "phonemes" = "lyric") => {
    if (!target || !notes[i] || dragging) return;
    editing = i;
    editMode = mode;
    selected = new Set([i]);
    const derived = (computeSung().phonemes[i] ?? []).join(" ");
    lyricInput.value = mode === "lyric" ? (notes[i].lyric ?? "") : (notes[i].phonemes?.join(" ") ?? derived);
    lyricInput.placeholder = mode === "lyric" ? syllable() : derived;
    lyricInput.dataset.mode = mode;
    lyricInput.removeAttribute("aria-invalid");
    placeLyric();
    lyricInput.hidden = false;
    draw();
    notify();
    lyricInput.focus();
    lyricInput.select();
  };
  const setPhonemesAt = (i: number, text: string) => {
    const n = notes[i];
    const list = text.trim() ? parsePhonemes(text) : [];
    if (!n || list === null) return false;
    const now = computeSung().phonemes[i] ?? [];
    if (n.phonemes?.length ? list.join(" ") === n.phonemes.join(" ") : !list.length || list.join(" ") === now.join(" ")) return true;
    const { tg, k } = inClip(i);
    if (tg) engine.dispatch({ type: "set-note-phonemes", trackId: tg.trackId, clipId: tg.clipId, index: k, phonemes: list.length ? list : null });
    return true;
  };
  const setLyricAt = (i: number, text: string) => {
    const n = notes[i];
    if (!n || text.trim() === (n.lyric ?? "")) return;
    const { tg, k } = inClip(i);
    if (tg) engine.dispatch({ type: "set-note-lyrics", trackId: tg.trackId, clipId: tg.clipId, from: k, text: text.trim() });
  };
  const keepLyric = () => {
    if (!notes[editing] || !target) return true;
    if (editMode === "lyric") {
      setLyricAt(editing, lyricInput.value);
      return true;
    }
    const ok = setPhonemesAt(editing, lyricInput.value);
    if (!ok) lyricInput.setAttribute("aria-invalid", "true");
    return ok;
  };
  const closeLyric = (keep: boolean) => {
    if (editing < 0) return;
    if (keep) keepLyric();
    editing = -1;
    lyricInput.hidden = true;
    draw();
    canvas.focus();
  };
  const shiftFrom = (by: 1 | -1) => {
    const order = singingOrder(notes);
    const first = order.find((i) => selected.has(i));
    if (first === undefined || !target || dragging) return;
    const { tg, k } = inClip(first);
    if (tg) engine.dispatch({ type: "shift-lyrics", trackId: tg.trackId, clipId: tg.clipId, from: k, by });
  };
  lyricInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      if (keepLyric()) closeLyric(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeLyric(false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const order = singingOrder(notes);
      const next = order[order.indexOf(editing) + (e.shiftKey ? -1 : 1)];
      if (!keepLyric()) return;
      if (next === undefined) closeLyric(false);
      else openLyric(next, editMode);
    }
  });
  lyricInput.addEventListener("blur", () => {
    if (editing >= 0 && document.activeElement !== lyricInput) closeLyric(true);
  });
  const laneNote = (x: number) => {
    const order = singingOrder(notes);
    let found = -1;
    for (const i of order) if (xOf(notes[i].at) <= x && x <= xOf(notes[i].at) + Math.max(3, notes[i].length * pxPerFrame) && found < 0) found = i;
    return found;
  };
  canvas.addEventListener("dblclick", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const h = canvas.clientHeight;
    const index = y > h - VEL_H - LYR_H && y <= h - VEL_H ? laneNote(x) : (hit(x, y)?.index ?? -1);
    if (index >= 0) openLyric(index, e.shiftKey ? "phonemes" : "lyric");
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (!target) return;
    canvas.focus();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const h = canvas.clientHeight;
    if (x < KEY_W) return;
    if (y > h - VEL_H - LYR_H && y <= h - VEL_H) {
      // the lyric lane selects the note it names (a double-click edits it), it never adds one
      const index = laneNote(x);
      selected = index < 0 ? new Set() : new Set([index]);
      draw();
      notify();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    let changed = false;
    let added: (() => void) | null = null;
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
        // S7: a press on empty grid adds a note where it lets go unmoved; dragged, it selects the notes in a band
        band = null;
        const before = e.shiftKey ? new Set(selected) : new Set<number>();
        move = (ev) => {
          const bx = ev.clientX - r.left;
          const by = Math.min(h - VEL_H - LYR_H, ev.clientY - r.top);
          if (!band && Math.hypot(bx - x, by - y) < BAND_PX) return;
          band = { x0: x, y0: y, x1: bx, y1: by };
          const [left, right, top, bottom] = [Math.min(x, bx), Math.max(x, bx), Math.min(y, by), Math.max(y, by)];
          selected = new Set(before);
          notes.forEach((n, i) => {
            const nx = xOf(n.at);
            const ny = yOf(n.pitch);
            if (nx <= right && nx + Math.max(3, n.length * pxPerFrame) >= left && ny <= bottom && ny + rowH >= top) selected.add(i);
          });
          draw();
        };
        added = () => {
          if (band) {
            band = null;
            draw();
            notify();
            return;
          }
          const length = snapFrames() || Math.round(beatFrames() / 2);
          const at = Math.max(0, snap(origin + (x - KEY_W) / pxPerFrame));
          notes.push({ at, length, pitch: Math.min(127, Math.max(0, low + rows - 1 - Math.floor(y / rowH))), velocity: 100 });
          owner.push(Math.max(0, targets.findIndex((t) => at >= t.start && at < t.start + t.length)));
          selected = new Set([notes.length - 1]);
          changed = true;
          draw();
        };
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
      added?.();
      if (changed) void commit();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });

  const zoom = (factor: number) => {
    userRowH = Math.min(28, Math.max(4, (userRowH || rowH) * factor));
    draw();
  };
  // S7: Quantize asks for its grid, strength, swing and ends (the Event menu's dialog); Q quantizes again as last set
  const quantize = (ask: boolean) => host.dispatchEvent(new CustomEvent("fw-note-quantize", { detail: { ask } }));
  panel.querySelector('[data-zoom="out"]')?.addEventListener("click", () => zoom(1 / 1.25));
  panel.querySelector('[data-zoom="in"]')?.addEventListener("click", () => zoom(1.25));
  panel.querySelector('[data-zoom="fit"]')?.addEventListener("click", () => {
    userRowH = 0;
    topPitch = null;
    draw();
  });
  panel.querySelector("[data-quantize]")?.addEventListener("click", () => quantize(true));
  const listButton = panel.querySelector<HTMLButtonElement>("[data-list]");
  const list = panel.querySelector<HTMLElement>(".fw-piano-list") as HTMLElement;
  // S7: the event list takes the canvas's place in the panel, the same row, so nothing around it moves
  const setList = (open: boolean) => {
    if (list.hidden === !open) return;
    list.hidden = !open;
    canvas.hidden = open;
    listButton?.setAttribute("aria-pressed", String(open));
    if (!open) draw();
    notify();
  };
  listButton?.addEventListener("click", () => setList(Boolean(list.hidden)));
  panel.querySelector("[data-export-midi]")?.addEventListener("click", () => {
    if (!target || !notes.length) return;
    const doc = engine.get("document");
    const clip = doc.tracks.find((t) => t.id === target?.trackId)?.clips.find((c) => c.id === target?.clipId);
    const name = `${(clip ? doc.media[clip.mediaId]?.name : undefined)?.replace(/\.wav$/i, "") ?? "notes"}.mid`;
    const tempo = doc.tempo ?? { bpm: 120, beatsPerBar: 4 };
    const url = URL.createObjectURL(new Blob([midiFile(notes.map((n) => ({ ...n, at: n.at - origin })), rate, tempo.bpm, 480, tempo.beatsPerBar)], { type: "audio/midi" }));
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

  // S7: a run of arrow keys moves the selection at once and commits once the keys stop, as one undo step
  const arrows = (e: KeyboardEvent) => {
    const doc = engine.get("document");
    const step = snapFrames() || gridStepOf(doc, { kind: "note", quarters: 0.25, dotted: false, triplet: false }, fpsOf(doc));
    const semis = e.key === "ArrowUp" ? (e.shiftKey ? 12 : 1) : e.key === "ArrowDown" ? (e.shiftKey ? -12 : -1) : 0;
    const frames = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const moved = [...selected].map((i) => ({ i, at: Math.round(notes[i].at + frames), pitch: notes[i].pitch + semis }));
    if (!moved.length || moved.some((m) => m.at < 0 || m.pitch < 0 || m.pitch > 127)) return;
    for (const m of moved) notes[m.i] = { ...notes[m.i], at: m.at, pitch: m.pitch };
    dragging = true;
    draw();
    notify();
    window.clearTimeout(arrowTimer);
    arrowTimer = window.setTimeout(() => {
      dragging = false;
      void commit(semis ? "Transposed notes" : "Moved notes");
    }, ARROW_COMMIT_MS);
  };
  // S8: step input; notes played on a MIDI keyboard within 60 ms of each other make one chord at the same step
  const stepLength = () => snapFrames() || gridStepOf(engine.get("document"), { kind: "note", quarters: 0.25, dotted: false, triplet: false }, fpsOf(engine.get("document")));
  const stepCommit = () => {
    window.clearTimeout(stepTimer);
    stepTimer = window.setTimeout(() => void commit("Step input"), ARROW_COMMIT_MS * 2);
  };
  const addStep = (pitch: number, velocity: number, played = false) => {
    if (!target || pitch < 0 || pitch > 127) return;
    const now = performance.now();
    const chord = played && now - lastStep.time < 60;
    const at = chord ? lastStep.at : stepAt;
    const length = stepLength();
    notes.push({ at, length: Math.max(1, Math.round(length)), pitch, velocity: Math.min(127, Math.max(1, velocity)) });
    owner.push(0);
    lastStep = { time: now, at };
    if (!chord) stepAt = Math.round(at + length);
    draw();
    notify();
    stepCommit();
  };
  const STEP_KEYS = "awsedftgyhujk";
  const stepKey = (e: KeyboardEvent): boolean => {
    if (e.metaKey || e.ctrlKey || e.altKey || !target) return false;
    const k = e.key.toLowerCase();
    const index = STEP_KEYS.indexOf(k);
    if (index >= 0 && k.length === 1) addStep(stepOctave + index, 100);
    else if (k === "z" || k === "x") stepOctave = Math.min(108, Math.max(12, stepOctave + (k === "z" ? -12 : 12)));
    else if (e.key === " ") {
      stepAt = Math.round(stepAt + stepLength());
      lastStep = { time: 0, at: stepAt };
      draw();
    } else if (e.key === "Backspace") {
      const back = Math.max(origin, Math.round(stepAt - stepLength()));
      const keep = notes.map((n) => Math.abs(n.at - back) > 1);
      owner = owner.filter((_, i) => keep[i]);
      notes = notes.filter((_, i) => keep[i]);
      selected = new Set();
      stepAt = back;
      lastStep = { time: 0, at: stepAt };
      draw();
      stepCommit();
    } else return false;
    e.preventDefault();
    e.stopPropagation();
    setText(state, `Step input · octave ${Math.floor(stepOctave / 12) - 1} · bar ${Math.floor((stepAt - origin) / (beatFrames() * Math.max(1, engine.get("document").tempo?.beatsPerBar ?? 4))) + 1}`);
    return true;
  };
  const stepButton = panel.querySelector<HTMLButtonElement>("[data-step]");
  stepButton?.addEventListener("click", () => {
    stepping = !stepping;
    stepButton.setAttribute("aria-pressed", String(stepping));
    if (stepping) {
      const end = Math.max(origin, ...notes.map((n) => n.at + n.length));
      stepAt = Math.max(origin, snap(notes.length ? end : engine.get("transport").positionSamples));
      lastStep = { time: 0, at: stepAt };
      canvas.focus();
      setText(state, target ? "Step input: play notes, Space for a rest, Backspace to step back" : "Step input needs a note clip: Event > New note clip");
    } else {
      window.clearTimeout(stepTimer);
      void commit("Step input");
    }
    draw();
  });
  document.addEventListener("fw-midi-note", (e) => {
    if (!stepping || panel.hidden) return;
    const d = (e as CustomEvent<{ pitch: number; velocity: number }>).detail;
    addStep(d.pitch, d.velocity, true);
  });
  canvas.addEventListener("keydown", (e) => {
    if (stepping && stepKey(e)) return;
    if (e.code === "KeyE" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const first = singingOrder(notes).find((i) => selected.has(i));
      if (first !== undefined) openLyric(first, e.altKey ? "phonemes" : "lyric");
      return;
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "BracketRight" || e.code === "BracketLeft")) {
      e.preventDefault();
      e.stopPropagation();
      shiftFrom(e.code === "BracketRight" ? 1 : -1);
      return;
    }
    if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      selected = new Set(notes.map((_, i) => i));
      draw();
      notify();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      e.stopPropagation();
      if (target && selected.size) arrows(e);
      return;
    }
    if ((e.key === "q" || e.key === "Q") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      quantize(false);
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
      void commit("Deleted notes");
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
    notify();
  });
  engine.subscribe("document", () => {
    if (dragging) return;
    load();
    selected = new Set([...selected].filter((i) => i < notes.length));
    draw();
    notify();
  });
  new ResizeObserver(() => draw()).observe(canvas);
  load();
  return {
    view: () => ({ notes, owner, selected, targets, origin }),
    apply: async (next, owners, label, chosen, extra) => {
      if (!target) return false;
      notes = next.map((n) => ({ ...n }));
      owner = [...owners];
      selected = new Set(chosen ?? []);
      draw();
      notify();
      return commit(label, extra);
    },
    select: (indexes) => {
      selected = new Set(indexes);
      draw();
      notify();
    },
    onChange: (fn) => listeners.add(fn),
    panel,
    setList,
    listOpen: () => !list.hidden,
    editLyric: () => {
      const first = singingOrder(notes).find((i) => selected.has(i)) ?? singingOrder(notes)[0];
      if (first !== undefined) openLyric(first);
    },
    shiftLyrics: (by) => shiftFrom(by),
    sung: () => computeSung(),
    editPronunciation: () => {
      const first = singingOrder(notes).find((i) => selected.has(i)) ?? singingOrder(notes)[0];
      if (first !== undefined) openLyric(first, "phonemes");
    },
    setLyric: (index, text) => setLyricAt(index, text),
    setPhonemes: (index, text) => setPhonemesAt(index, text),
  };
}
