import { renderPlainNotes } from "../audio/notes";
import type { Engine } from "../engine";
import type { Command, NoteEvent } from "../engine/document";
import { parseGrid } from "../engine/grid";
import { bpmAt, sampleToTick, scaleTempo, tempoCurve, tempoMap, type CurveShape } from "../engine/tempo";
import { changeDuration, changeVelocity, chordsByBar, duplicateNotes, noteName, parseNoteName, quantizeNotes, splitNotes, type DurationOp, type QuantizeOptions, type SplitRule, type VelocityOp } from "../engine/midi";
import { formatPosition, parsePosition, TICKS_PER_QUARTER, timeContext } from "../engine/timebase";
import { icon } from "../vendor/formvis/icons";
import { setText } from "../vendor/nodemode/dom-stable";
import { fpsOf, INPUT_QUANTIZE_KEY, inputQuantize } from "./midi-input";
import type { NoteEditor } from "./piano-roll";

/**
 * PLAN_v13 S7: the Event menu (Pro Tools' MIDI operations) and the note editor's event list. Each operation works on
 * the note editor's selected notes, or on all its notes when none is selected, through the editor (one re-render and
 * one undo step with its own words in History); the values an operation asks for come from the editing module's
 * small dialog (an fw-ask event), and each asks again with its last values.
 */
type Field = { key: string; label: string; value: number | string | null; min?: number; max?: number; step?: number; unit?: string; options?: [string, string][]; text?: boolean };
type Values = Record<string, number | string | null>;

const GRIDS: [string, string][] = [
  ["1/4", "1/4"],
  ["1/8", "1/8"],
  ["1/16", "1/16"],
  ["1/32", "1/32"],
  ["1/4t", "1/4 triplet"],
  ["1/8t", "1/8 triplet"],
  ["1/16t", "1/16 triplet"],
];

const ITEMS: [string, string, string?][] = [
  ["new", "New note clip"],
  ["quantize", "Quantize…", "Q"],
  ["velocity", "Change velocity…"],
  ["duration", "Change duration…"],
  ["transpose", "Transpose…"],
  ["all", "Select all notes", "⌘A"],
  ["duplicates", "Remove duplicate notes"],
  ["split", "Split notes to a new track…"],
  ["chords", "Name chords as markers"],
  ["ramp", "Tempo ramp across the selection…"],
  ["scale", "Scale the tempo across the selection…"],
  ["stretch", "Stretch the selection's tempo…"],
];

export function mountNoteEvents(host: HTMLElement, engine: Engine, editor: NoteEditor | null): void {
  const pop = host.querySelector<HTMLElement>(".fw-event-pop");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  if (!pop || !editor) return;
  const say = (text: string) => setText(notice, text);
  pop.innerHTML =
    ITEMS.map(([id, label, key]) => `<button class="fw-ibtn" type="button" role="menuitem" data-ev="${id}"><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ""}</button>`).join("") +
    `<span class="fw-menu-sep" role="separator"></span><button class="fw-ibtn" type="button" role="menuitemcheckbox" aria-checked="false" data-ev="list"><span class="fw-check" aria-hidden="true"></span><span>Event list</span></button>`;
  const listItem = pop.querySelector<HTMLElement>('[data-ev="list"]');

  const ask = (title: string, note: string, fields: Field[], ok: string) =>
    new Promise<Values | null>((done) => host.dispatchEvent(new CustomEvent("fw-ask", { detail: { title, note, fields, ok, done } })));
  const num = (v: Values, key: string, fallback: number) => (typeof v[key] === "number" ? (v[key] as number) : fallback);

  /** The notes an operation works on: the selection, or every note; nothing when no note clip is in the editor. */
  const scope = () => {
    const v = editor.view();
    if (!v.targets.length) {
      say("Select a note clip first (Event > New note clip makes one)");
      return null;
    }
    return { ...v, pick: v.selected.size ? new Set(v.selected) : null };
  };
  const tickFrames = () => {
    const doc = engine.get("document");
    return (doc.sampleRate * 60) / (doc.tempo?.bpm ?? 120) / TICKS_PER_QUARTER;
  };
  const apply = async (next: NoteEvent[], owner: number[], label: string, selected: ReadonlySet<number> | null, extra?: Command[]) => {
    if (await editor.apply(next, owner, label, selected ?? undefined, extra)) say(label);
  };
  const changedCount = (a: readonly NoteEvent[], b: readonly NoteEvent[]) => a.filter((n, i) => JSON.stringify(n) !== JSON.stringify(b[i])).length;

  // Quantize: the dialog's grid, strength, swing and ends, kept for Q; its last field sets input quantize for MIDI takes
  let lastQuantize: QuantizeOptions | null = null;
  const snapValue = () => editor.panel.querySelector<HTMLSelectElement>("[data-snap]")?.value || "1/16";
  const quantize = async (askFirst: boolean) => {
    const s = scope();
    if (!s) return;
    let opts = lastQuantize ?? { grid: parseGrid(snapValue()) ?? { kind: "note" as const, quarters: 0.25, dotted: false, triplet: false }, strength: 1, swing: 0, ends: false };
    if (askFirst || !lastQuantize) {
      const v = await ask(
        "Quantize",
        "Moves each note's start toward the nearest line of the grid by the strength; swing moves every second line later, all the way to the triplet position at 100%.",
        [
          { key: "grid", label: "Grid", value: snapValue(), options: GRIDS },
          { key: "strength", label: "Strength", value: 100, min: 0, max: 100, step: 1, unit: "%" },
          { key: "swing", label: "Swing", value: 0, min: 0, max: 100, step: 1, unit: "%" },
          { key: "ends", label: "Notes", value: "starts", options: [["starts", "Starts only"], ["ends", "Starts and ends"]] },
          { key: "takes", label: "MIDI takes", value: inputQuantize() ? "quantized" : "played", options: [["played", "Kept as played"], ["quantized", "Quantized like this"]] },
        ],
        "Quantize",
      );
      if (!v) return;
      const grid = parseGrid(typeof v.grid === "string" ? v.grid : "") ?? opts.grid;
      opts = { grid, strength: Math.min(100, Math.max(0, num(v, "strength", 100))) / 100, swing: Math.min(100, Math.max(0, num(v, "swing", 0))) / 100, ends: v.ends === "ends" };
      try {
        if (v.takes === "quantized") localStorage.setItem(INPUT_QUANTIZE_KEY, JSON.stringify({ grid: v.grid, strength: opts.strength, swing: opts.swing, ends: opts.ends }));
        else localStorage.removeItem(INPUT_QUANTIZE_KEY);
      } catch {
        say("Input quantize is not kept in this browser");
      }
    }
    lastQuantize = opts;
    const doc = engine.get("document");
    const next = quantizeNotes(doc, s.notes, s.pick, opts, fpsOf(doc));
    const moved = changedCount(next, s.notes);
    if (!moved) say("The notes already sit on that grid");
    else await apply(next, [...s.owner], `Quantized ${moved} note${moved === 1 ? "" : "s"}`, s.pick);
  };

  const velocity = async () => {
    const s = scope();
    if (!s) return;
    const v = await ask(
      "Change velocity",
      "Set: every velocity to the first value. Scale: by the first value in percent, then the second added. Limit: held between the two. Ramp: from the first to the second across the notes' starts. Humanize: each moved at random by up to the first value either way.",
      [
        { key: "mode", label: "Change", value: "set", options: [["set", "Set"], ["scale", "Scale"], ["limit", "Limit"], ["ramp", "Ramp"], ["humanize", "Humanize"]] },
        { key: "a", label: "First value", value: 100, min: 0, max: 400, step: 1 },
        { key: "b", label: "Second value", value: 0, min: -127, max: 127, step: 1 },
      ],
      "Change",
    );
    if (!v) return;
    const a = num(v, "a", 100);
    const b = num(v, "b", 0);
    const op: VelocityOp =
      v.mode === "scale"
        ? { kind: "scale", percent: a, offset: b }
        : v.mode === "limit"
          ? { kind: "limit", min: a, max: b }
          : v.mode === "ramp"
            ? { kind: "ramp", from: a, to: b }
            : v.mode === "humanize"
              ? { kind: "humanize", amount: a, seed: Date.now() }
              : { kind: "set", value: a };
    const next = changeVelocity(s.notes, s.pick, op);
    await apply(next, [...s.owner], `Changed the velocity of ${changedCount(next, s.notes)} notes`, s.pick);
  };

  const duration = async () => {
    const s = scope();
    if (!s) return;
    const v = await ask(
      "Change duration",
      "Lengths in ticks, 960 to a quarter note at the session's tempo. Set: to the first value. Scale: by the first in percent. Limit: between the two. Legato: each note runs to the next start, less the first value. Overlaps: a note ends where the next of its pitch begins. Humanize: up to the first value in percent either way.",
      [
        { key: "mode", label: "Change", value: "set", options: [["set", "Set"], ["scale", "Scale"], ["limit", "Limit"], ["legato", "Legato"], ["overlap", "Remove overlaps"], ["humanize", "Humanize"]] },
        { key: "a", label: "First value", value: 480, min: 0, step: 1 },
        { key: "b", label: "Second value", value: 960, min: 0, step: 1 },
      ],
      "Change",
    );
    if (!v) return;
    const t = tickFrames();
    const a = num(v, "a", 480);
    const b = num(v, "b", 960);
    const op: DurationOp =
      v.mode === "scale"
        ? { kind: "scale", percent: a }
        : v.mode === "limit"
          ? { kind: "limit", min: a * t, max: b * t }
          : v.mode === "legato"
            ? { kind: "legato", gap: a * t }
            : v.mode === "overlap"
              ? { kind: "overlap" }
              : v.mode === "humanize"
                ? { kind: "humanize", percent: a, seed: Date.now() }
                : { kind: "set", frames: Math.max(1, a * t) };
    const next = changeDuration(s.notes, s.pick, op);
    await apply(next, [...s.owner], `Changed the duration of ${changedCount(next, s.notes)} notes`, s.pick);
  };

  const transpose = async () => {
    const s = scope();
    if (!s) return;
    const v = await ask("Transpose", "Moves the notes up (or down, below zero) by semitones.", [{ key: "semitones", label: "Semitones", value: 12, min: -48, max: 48, step: 1 }], "Transpose");
    if (!v) return;
    const by = Math.round(num(v, "semitones", 0));
    const next = s.notes.map((n, i) => (!s.pick || s.pick.has(i) ? { ...n, pitch: n.pitch + by } : n));
    if (next.some((n) => n.pitch < 0 || n.pitch > 127)) say("That moves a note past the keyboard's ends (0 to 127)");
    else if (by) await apply(next, [...s.owner], `Transposed notes by ${by} semitone${Math.abs(by) === 1 ? "" : "s"}`, s.pick);
  };

  const duplicates = async () => {
    const s = scope();
    if (!s) return;
    const drop = new Set(duplicateNotes(s.notes, s.pick, Math.round(engine.get("document").sampleRate / 1000)));
    if (!drop.size) return say("No duplicate notes");
    await apply(
      s.notes.filter((_, i) => !drop.has(i)),
      s.owner.filter((_, i) => !drop.has(i)),
      `Removed ${drop.size} duplicate note${drop.size === 1 ? "" : "s"}`,
      null,
    );
  };

  const split = async () => {
    const s = scope();
    if (!s) return;
    const v = await ask(
      "Split notes to a new track",
      "Moves the notes that match onto a new note track, played by the session's synth: those in a pitch range (by name, C4 being middle C, or number), or the top or bottom note of each chord.",
      [
        { key: "rule", label: "Notes", value: "range", options: [["range", "In a pitch range"], ["top", "Top note of each chord"], ["bottom", "Bottom note of each chord"]] },
        { key: "low", label: "From", value: "C4", text: true },
        { key: "high", label: "To", value: "B4", text: true },
      ],
      "Split",
    );
    if (!v) return;
    const low = parseNoteName(String(v.low ?? ""));
    const high = parseNoteName(String(v.high ?? ""));
    if (v.rule === "range" && (low === null || high === null)) return say("Name the range's notes as C4 or F#3, or give their numbers");
    const rule: SplitRule = v.rule === "top" ? { kind: "top" } : v.rule === "bottom" ? { kind: "bottom" } : { kind: "range", low: low ?? 0, high: high ?? 127 };
    const doc = engine.get("document");
    const moving = new Set(splitNotes(s.notes, s.pick, rule, Math.round(doc.sampleRate * 0.03)));
    if (!moving.size) return say("No note matches");
    const taken = s.notes.filter((_, i) => moving.has(i));
    const at = Math.min(...taken.map((n) => n.at));
    const end = Math.max(...taken.map((n) => n.at + n.length));
    const source = doc.tracks.find((t) => t.id === s.targets[0].trackId);
    const name = `${source?.name ?? "Notes"} split`;
    try {
      const media = await renderPlainNotes(engine, taken.map((n) => ({ ...n, at: n.at - at })), doc.sampleRate, (end - at) / doc.sampleRate, name);
      await apply(
        s.notes.filter((_, i) => !moving.has(i)),
        s.owner.filter((_, i) => !moving.has(i)),
        `Split ${moving.size} note${moving.size === 1 ? "" : "s"} to a new track`,
        null,
        [{ type: "import-media", media, at, notes: taken.map((n) => ({ ...n, at: n.at - at })) }],
      );
    } catch (err) {
      say(`Not split: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const chords = () => {
    const s = scope();
    if (!s) return;
    const doc = engine.get("document");
    const from = s.notes.length ? Math.min(...s.notes.map((n) => n.at)) : s.origin;
    const to = Math.max(...s.notes.map((n) => n.at + n.length), from);
    const found = chordsByBar(doc, s.pick ? s.notes.filter((_, i) => s.pick?.has(i)) : s.notes, from, to);
    if (!found.length) return say("No chord found: a bar needs three notes that spell one (or a root and its fifth)");
    engine.dispatch({ type: "batch", commands: found.map((c) => ({ type: "add-marker", at: c.at, label: c.name })), label: `Named ${found.length} chord${found.length === 1 ? "" : "s"} as markers` });
    say(`Named ${found.length} chord${found.length === 1 ? "" : "s"}: ${found.map((c) => c.name).join(", ")}`);
  };

  // New note clip: an empty one over the range drawn, or a bar long at the playhead, on the track picked last (or a new
  // track); it is selected and opened in the note editor
  let range: { trackId: string; start: number; end: number } | null = null;
  let picked: string | null = null;
  host.addEventListener("fw-range", (e) => {
    const d = (e as CustomEvent<{ trackId: string; start: number; end: number } | null>).detail;
    range = d && d.end > d.start ? d : null;
  });
  host.addEventListener("fw-track", (e) => {
    picked = (e as CustomEvent<string>).detail;
  });

  // S11: tempo operations over the range drawn (else the loop), in ticks from its start to its end: a ramp written as
  // steps, every tempo scaled, or the span stretched (its length times the factor, so its tempos divided by it)
  const tempoSpan = () => {
    const doc = engine.get("document");
    const span = range ?? (doc.loop && doc.loop.end > doc.loop.start ? doc.loop : null);
    if (!span) {
      say("Draw a range or set a loop over the bars to change");
      return null;
    }
    const map = tempoMap(doc);
    return { doc, map, from: Math.round(sampleToTick(map, span.start)), to: Math.round(sampleToTick(map, span.end)) };
  };
  const ramp = async () => {
    const s = tempoSpan();
    if (!s) return;
    const v = await ask("Tempo ramp", "The tempo moves from the first value to the second across the selection, in steps; what follows keeps its tempo.", [
      { key: "start", label: "From", value: bpmAt(s.map, s.from), min: 20, max: 300, step: 0.1, unit: "BPM" },
      { key: "end", label: "To", value: bpmAt(s.map, s.from), min: 20, max: 300, step: 0.1, unit: "BPM" },
      { key: "shape", label: "Curve", value: "linear", options: [["linear", "Linear"], ["parabolic", "Parabolic"], ["s-curve", "S-curve"]] },
      { key: "every", label: "Steps", value: "960", options: [["960", "1/4"], ["480", "1/8"], ["240", "1/16"]] },
    ], "Ramp");
    if (!v) return;
    const shape = String(v.shape) as CurveShape;
    engine.dispatch({ type: "set-tempo-map", changes: tempoCurve(s.doc, s.from, s.to, num(v, "start", 120), num(v, "end", 120), shape, Number(v.every) || 960), label: "Ramped the tempo" });
    say(`Ramped the tempo from ${num(v, "start", 120)} to ${num(v, "end", 120)} BPM`);
  };
  const scale = async (stretch: boolean) => {
    const s = tempoSpan();
    if (!s) return;
    const v = await ask(stretch ? "Stretch the tempo" : "Scale the tempo", stretch ? "The selection lasts this many times as long (2 halves its tempos); what follows keeps its tempo." : "Every tempo in the selection times this percentage; what follows keeps its tempo.", [
      stretch ? { key: "by", label: "Length", value: 2, min: 0.1, max: 10, step: 0.01, unit: "×" } : { key: "by", label: "Tempo", value: 100, min: 10, max: 1000, step: 0.1, unit: "%" },
    ], stretch ? "Stretch" : "Scale");
    const by = v ? num(v, "by", 0) : 0;
    if (!(by > 0)) return;
    const factor = stretch ? 1 / by : by / 100;
    engine.dispatch({ type: "set-tempo-map", changes: scaleTempo(s.doc, s.from, s.to, factor), label: stretch ? "Stretched the tempo" : "Scaled the tempo" });
    say(stretch ? `Stretched the selection ${by} times` : `Scaled the tempo to ${by}%`);
  };
  host.addEventListener("fw-selection", (e) => {
    const ids = (e as CustomEvent<string[]>).detail ?? [];
    const owner = engine.get("document").tracks.find((t) => t.clips.some((c) => ids.includes(c.id)));
    if (owner) picked = owner.id;
  });
  const openEditor = () => {
    if (!editor.panel.hidden) return;
    const item = host.querySelector<HTMLElement>('.fw-dock-more [data-panel="notes"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray .fw-mode[data-piano]");
    item?.click();
  };
  const newClip = async () => {
    const doc = engine.get("document");
    const tempo = doc.tempo ?? { bpm: 120, beatsPerBar: 4 };
    const trackId = range?.trackId ?? (doc.tracks.some((t) => t.id === picked) ? picked : null);
    const at = range ? range.start : engine.get("transport").positionSamples;
    const length = range ? range.end - range.start : Math.round(((doc.sampleRate * 60) / tempo.bpm) * tempo.beatsPerBar);
    try {
      const media = await renderPlainNotes(engine, [], doc.sampleRate, length / doc.sampleRate, "Notes");
      const before = new Set(engine.get("document").tracks.flatMap((t) => t.clips.map((c) => c.id)));
      engine.dispatch({ type: "batch", commands: [{ type: "import-media", media, at, ...(trackId ? { trackId } : {}), notes: [] }], label: "New note clip" });
      const made = engine.get("document").tracks.flatMap((t) => t.clips.map((c) => c.id)).filter((id) => !before.has(id));
      host.dispatchEvent(new CustomEvent("fw-select-clips", { detail: made }));
      openEditor();
      say("New note clip: click its grid to add notes");
    } catch (err) {
      say(`No note clip made: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  pop.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-ev]")?.dataset.ev;
    if (id === "new") void newClip();
    else if (id === "quantize") void quantize(true);
    else if (id === "velocity") void velocity();
    else if (id === "duration") void duration();
    else if (id === "transpose") void transpose();
    else if (id === "all") {
      if (scope()) {
        editor.select(new Set(editor.view().notes.map((_, i) => i)));
        openEditor();
      }
    } else if (id === "duplicates") void duplicates();
    else if (id === "split") void split();
    else if (id === "chords") chords();
    else if (id === "ramp") void ramp();
    else if (id === "scale") void scale(false);
    else if (id === "stretch") void scale(true);
    else if (id === "list") {
      const open = !editor.listOpen();
      if (open) openEditor();
      editor.setList(open);
    }
  });
  host.addEventListener("fw-note-quantize", (e) => void quantize(Boolean((e as CustomEvent<{ ask: boolean }>).detail?.ask)));

  // The event list: one row a note in time order, patched in place (rows made once and reused, values set only where
  // they changed and never in the field being typed in)
  const body = editor.panel.querySelector<HTMLElement>(".fw-piano-list tbody") as HTMLElement;
  const rows: HTMLTableRowElement[] = [];
  let order: number[] = [];
  const makeRow = () => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="text" data-f="start" aria-label="Start" spellcheck="false"></td><td><input type="text" data-f="pitch" aria-label="Note" spellcheck="false"></td><td><input type="number" data-f="length" min="1" step="1" aria-label="Length in ticks"></td><td><input type="number" data-f="velocity" min="1" max="127" step="1" aria-label="Velocity"></td><td><button type="button" class="fw-ibtn fw-icon-btn" data-f="remove" aria-label="Remove this note" title="Remove this note">${icon("close", 14)}</button></td>`;
    return tr;
  };
  const refresh = (force = false) => {
    if (!editor.listOpen()) return;
    const v = editor.view();
    const ctx = timeContext(engine.get("document"));
    const t = tickFrames();
    order = v.notes.map((_, i) => i).sort((a, b) => v.notes[a].at - v.notes[b].at || v.notes[a].pitch - v.notes[b].pitch);
    order.forEach((i, k) => {
      let tr = rows[k];
      if (!tr) {
        tr = makeRow();
        rows.push(tr);
        body.append(tr);
      }
      const n = v.notes[i];
      if (tr.dataset.i !== String(i)) tr.dataset.i = String(i);
      const on = String(v.selected.has(i));
      if (tr.getAttribute("aria-selected") !== on) tr.setAttribute("aria-selected", on);
      const values: Record<string, string> = { start: formatPosition(n.at, "bars_beats", ctx), pitch: noteName(n.pitch), length: String(Math.max(1, Math.round(n.length / t))), velocity: String(n.velocity) };
      for (const input of tr.querySelectorAll<HTMLInputElement>("input[data-f]")) {
        const text = values[input.dataset.f ?? ""];
        if (input.value !== text && (force || document.activeElement !== input)) input.value = text;
      }
    });
    while (rows.length > order.length) rows.pop()?.remove();
  };
  editor.onChange(() => {
    refresh();
    if (listItem && listItem.getAttribute("aria-checked") !== String(editor.listOpen())) listItem.setAttribute("aria-checked", String(editor.listOpen()));
  });
  body.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const i = Number(input.closest<HTMLElement>("tr")?.dataset.i);
    const v = editor.view();
    const n = v.notes[i];
    if (!n || !input.dataset.f) return;
    const next = v.notes.map((x) => ({ ...x }));
    let label = "";
    if (input.dataset.f === "start") {
      const at = parsePosition(input.value, "bars_beats", timeContext(engine.get("document")));
      if (at !== null && at >= 0) [next[i].at, label] = [at, "Moved a note"];
    } else if (input.dataset.f === "pitch") {
      const pitch = parseNoteName(input.value);
      if (pitch !== null) [next[i].pitch, label] = [pitch, "Changed a note's pitch"];
    } else if (input.dataset.f === "length") {
      const ticks = Number(input.value);
      if (Number.isFinite(ticks) && ticks >= 1) [next[i].length, label] = [Math.round(ticks * tickFrames()), "Changed a note's length"];
    } else if (input.dataset.f === "velocity") {
      const vel = Number(input.value);
      if (Number.isFinite(vel) && vel >= 1 && vel <= 127) [next[i].velocity, label] = [Math.round(vel), "Changed a note's velocity"];
    }
    if (!label) {
      say("That value does not read as one: the list puts it back");
      refresh(true);
      return;
    }
    void editor.apply(next, [...v.owner], label, v.selected).then(() => refresh(true));
  });
  body.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const i = Number(el.closest<HTMLElement>("tr")?.dataset.i);
    const v = editor.view();
    if (!Number.isFinite(i) || !v.notes[i]) return;
    if (el.closest('[data-f="remove"]')) {
      void editor.apply(
        v.notes.filter((_, j) => j !== i),
        v.owner.filter((_, j) => j !== i),
        "Deleted a note",
      );
    } else if (!v.selected.has(i)) editor.select(new Set([i]));
  });
}
