/**
 * PLAN_v13 S5, the Grid and Nudge values: note values (plain, dotted or triplet) at the session's one tempo and meter,
 * whole bars, seconds, frames and samples. A note value's lines are counted from the bar line before them, so a value
 * that does not divide the bar (a dotted quarter in 4/4) starts again on every downbeat; the rest count from the
 * session's start. Positions are session samples.
 */
import type { SessionDoc } from "./document";

export type GridValue =
  | { kind: "note"; quarters: number | "bar"; dotted: boolean; triplet: boolean }
  | { kind: "seconds"; seconds: number }
  | { kind: "frames"; frames: number }
  | { kind: "samples"; samples: number };

export interface GridChoice {
  id: string;
  label: string;
  group: string;
}

const DIVISIONS = [2, 4, 8, 16, 32, 64];
const noteLabel = (d: number) => `1/${d} note`;

/** Every value the Grid and Nudge menus offer, grouped as they list them. */
export const GRID_CHOICES: readonly GridChoice[] = [
  { id: "bar", label: "1 bar", group: "Bars and beats" },
  ...DIVISIONS.map((d) => ({ id: `1/${d}`, label: noteLabel(d), group: "Bars and beats" })),
  ...DIVISIONS.slice(0, 5).map((d) => ({ id: `1/${d}.`, label: `${noteLabel(d)}, dotted`, group: "Dotted" })),
  ...DIVISIONS.slice(0, 5).map((d) => ({ id: `1/${d}t`, label: `${noteLabel(d)}, triplet`, group: "Triplets" })),
  ...["10", "5", "1", "0.5", "0.1", "0.01", "0.001"].map((s) => ({ id: `${s}s`, label: `${s} s`, group: "Time" })),
  { id: "1f", label: "1 frame", group: "Timecode" },
  ...["1000", "100", "10", "1"].map((n) => ({ id: `${n}smp`, label: `${n} samples`, group: "Samples" })),
];

/** The nudge when the session has not chosen one (a tenth of a second, as Pro Tools ships). */
export const NUDGE_DEFAULT = "0.1s";

/** A short form of a value for the footer: 1/16, 1/8T, 1/4., 1 bar, 0.1 s, 1 fr, 100 smp. */
export function gridShort(id: string): string {
  const g = parseGrid(id);
  if (!g) return id;
  switch (g.kind) {
    case "seconds":
      return `${g.seconds} s`;
    case "frames":
      return `${g.frames} fr`;
    case "samples":
      return `${g.samples} smp`;
    default:
      return id.endsWith("t") ? `${id.slice(0, -1)}T` : id;
  }
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function parseGrid(id: string | undefined): GridValue | null {
  if (!id) return null;
  const time = id.match(/^(\d+(?:\.\d+)?)s$/);
  if (time) return { kind: "seconds", seconds: clampTo(Number(time[1]), 0.00001, 3600) };
  const frames = id.match(/^(\d+)f$/);
  if (frames) return { kind: "frames", frames: clampTo(Number(frames[1]), 1, 100000) };
  const samples = id.match(/^(\d+)smp$/);
  if (samples) return { kind: "samples", samples: Math.max(1, Number(samples[1])) };
  if (id === "bar") return { kind: "note", quarters: "bar", dotted: false, triplet: false };
  const note = id.match(/^1\/(\d+)([.t]?)$/);
  if (!note || ![1, ...DIVISIONS].includes(Number(note[1]))) return null;
  return { kind: "note", quarters: 4 / Number(note[1]), dotted: note[2] === ".", triplet: note[2] === "t" };
}

/** Samples in one quarter note and in one bar, at the session's tempo and meter (120 and 4 when it has none). */
function meterOf(doc: SessionDoc): { quarter: number; bar: number } {
  const { bpm, beatsPerBar } = doc.tempo ?? { bpm: 120, beatsPerBar: 4 };
  const quarter = (doc.sampleRate * 60) / bpm;
  return { quarter, bar: quarter * beatsPerBar };
}

/** A value's step in samples (fractional for most): `fps` is the frame rate a frame is counted at. */
export function gridStepOf(doc: SessionDoc, g: GridValue, fps: number): number {
  switch (g.kind) {
    case "seconds":
      return Math.max(1, g.seconds * doc.sampleRate);
    case "frames":
      return Math.max(1, (g.frames / fps) * doc.sampleRate);
    case "samples":
      return g.samples;
    default: {
      const { quarter, bar } = meterOf(doc);
      const plain = g.quarters === "bar" ? bar : g.quarters * quarter;
      const shaped = plain * (g.dotted ? 3 / 2 : 1) * (g.triplet ? 2 / 3 : 1);
      return Math.max(1, shaped);
    }
  }
}

const SLACK = 1e-6;

/** Where a value's lines are counted from for a position: the bar line at or before it for a note value, else 0. */
function origin(doc: SessionDoc, g: GridValue, pos: number): number {
  if (g.kind !== "note") return 0;
  const { bar } = meterOf(doc);
  return Math.floor(pos / bar + SLACK) * bar;
}

/** The grid line at or before `pos` (not rounded). */
export function lineAtOrBefore(doc: SessionDoc, g: GridValue, pos: number, fps: number): number {
  const step = gridStepOf(doc, g, fps);
  const from = origin(doc, g, pos);
  return from + Math.floor((pos - from) / step + SLACK) * step;
}

/** The first line after `line`: one step on, or the next bar line when that comes first (for a note value). */
export function nextLine(doc: SessionDoc, g: GridValue, line: number, fps: number): number {
  const ahead = line + gridStepOf(doc, g, fps);
  if (g.kind !== "note") return ahead;
  const { bar } = meterOf(doc);
  const downbeat = (Math.floor(line / bar + SLACK) + 1) * bar;
  return downbeat < ahead - SLACK ? downbeat : ahead;
}

/** The nearest line to `pos`, in whole samples (a tie goes to the earlier line). */
export function snapToGrid(doc: SessionDoc, g: GridValue, pos: number, fps: number): number {
  const before = lineAtOrBefore(doc, g, pos, fps);
  const after = nextLine(doc, g, before, fps);
  const nearest = after - pos < pos - before ? after : before;
  return Math.max(0, Math.round(nearest));
}

/** The lines from `start` to `end` (both included), in whole samples, at most `max` of them. */
export function gridLines(doc: SessionDoc, g: GridValue, start: number, end: number, fps: number, max = 4096): number[] {
  const lines: number[] = [];
  for (let at = lineAtOrBefore(doc, g, start, fps); at <= end + SLACK && lines.length < max; ) {
    if (at >= start - SLACK) lines.push(Math.round(at));
    const next = nextLine(doc, g, at, fps);
    if (!(next > at)) break;
    at = next;
  }
  return lines;
}
