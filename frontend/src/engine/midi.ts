/**
 * PLAN_v13 S7, MIDI editing as pure functions of notes: quantize to a note value with strength, swing and triplets,
 * velocity and duration operations, duplicates found, notes picked out to split onto a track, chords named, and the
 * note names the editor's list reads and writes. Notes carry frames on one timeline (the note editor's: session
 * frames); `pick` names the indexes an operation touches, every note when it is null or empty. Nothing is changed in
 * place: each function returns new notes, or the indexes it chose.
 */
import type { NoteEvent, SessionDoc } from "./document";
import { gridStepOf, lineAtOrBefore, nextLine, type GridValue } from "./grid";
import { barsBetween, barStartTick, tempoMap, tickToSample } from "./tempo";

/** S11: the chords of the session's playing note clips, bar by bar (each listed where it changes), for the Chords
 *  ruler. */
export function chordsPerBar(doc: SessionDoc): { at: number; name: string }[] {
  const notes: NoteEvent[] = [];
  for (const t of doc.tracks) {
    if (t.mute || t.inactive) continue;
    for (const c of t.clips) for (const n of c.notes ?? []) if (n.at < c.length) notes.push({ ...n, at: c.start + n.at, length: Math.min(n.length, c.length - n.at) });
  }
  if (!notes.length) return [];
  return chordsByBar(doc, notes, Math.min(...notes.map((n) => n.at)), Math.max(...notes.map((n) => n.at + n.length)));
}

export type Pick = ReadonlySet<number> | null;

const takes = (pick: Pick) => (i: number) => !pick || pick.size === 0 || pick.has(i);
const clampVelocity = (v: number) => Math.min(127, Math.max(1, Math.round(v)));

/** Samples in one bar at the session's tempo and meter (120 and 4 when it has none). */
function barOf(doc: SessionDoc): number {
  const { bpm, beatsPerBar } = doc.tempo ?? { bpm: 120, beatsPerBar: 4 };
  return ((doc.sampleRate * 60) / bpm) * beatsPerBar;
}

/** A grid line moved by the swing: the second line of each pair, counted from the bar line before it for a note
 *  value and from the session's start otherwise, goes later by the swing times a third of a step, so a swing of 1
 *  puts it where the second note of a triplet falls. */
function swung(doc: SessionDoc, grid: GridValue, line: number, fps: number, swing: number): number {
  if (swing <= 0) return line;
  const step = gridStepOf(doc, grid, fps);
  const bar = barOf(doc);
  const from = grid.kind === "note" ? Math.floor(line / bar + 1e-6) * bar : 0;
  const index = Math.round((line - from) / step);
  return index % 2 === 1 ? line + (swing * step) / 3 : line;
}

/** The (swung) grid line nearest `pos`: the lines either side of it and the one before those, since a swung line can
 *  move past the position. */
export function quantizeTarget(doc: SessionDoc, grid: GridValue, pos: number, fps: number, swing = 0): number {
  const at = lineAtOrBefore(doc, grid, pos, fps);
  const step = gridStepOf(doc, grid, fps);
  const candidates = [lineAtOrBefore(doc, grid, at - step / 2, fps), at, nextLine(doc, grid, at, fps)].map((l) => swung(doc, grid, l, fps, swing));
  return candidates.reduce((best, c) => (Math.abs(c - pos) < Math.abs(best - pos) ? c : best));
}

export interface QuantizeOptions {
  grid: GridValue;
  /** 0 to 1: how far each start moves toward its line */
  strength: number;
  /** 0 to 1: how far every second line moves toward the triplet position */
  swing: number;
  /** the ends quantized too (a note whose quantized end would not follow its start keeps its length) */
  ends: boolean;
}

/** The picked notes' starts (and ends) moved toward the nearest (swung) grid line by the strength. */
export function quantizeNotes(doc: SessionDoc, notes: readonly NoteEvent[], pick: Pick, opts: QuantizeOptions, fps: number): NoteEvent[] {
  const strength = Math.min(1, Math.max(0, opts.strength));
  const swing = Math.min(1, Math.max(0, opts.swing));
  const pull = (pos: number) => pos + (quantizeTarget(doc, opts.grid, pos, fps, swing) - pos) * strength;
  const take = takes(pick);
  return notes.map((n, i) => {
    if (!take(i)) return n;
    const at = Math.max(0, Math.round(pull(n.at)));
    if (!opts.ends) return { ...n, at };
    const end = Math.round(pull(n.at + n.length));
    return { ...n, at, length: end > at ? end - at : n.length };
  });
}

/** A small seeded generator (xorshift32): the same seed gives the same humanizing. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

export type VelocityOp =
  | { kind: "set"; value: number }
  | { kind: "scale"; percent: number; offset: number }
  | { kind: "limit"; min: number; max: number }
  | { kind: "ramp"; from: number; to: number }
  | { kind: "humanize"; amount: number; seed: number };

/** The picked notes' velocities set, scaled (then offset), held between two values, ramped from the first start to the
 *  last (notes starting together get one value) or moved at random by up to the amount either way; always 1 to 127. */
export function changeVelocity(notes: readonly NoteEvent[], pick: Pick, op: VelocityOp): NoteEvent[] {
  const take = takes(pick);
  const chosen = notes.map((_, i) => i).filter(take);
  const starts = chosen.map((i) => notes[i].at);
  const first = Math.min(...starts);
  const span = Math.max(...starts) - first;
  const roll = op.kind === "humanize" ? random(op.seed) : null;
  return notes.map((n, i) => {
    if (!take(i)) return n;
    let v = n.velocity;
    if (op.kind === "set") v = op.value;
    else if (op.kind === "scale") v = (n.velocity * op.percent) / 100 + op.offset;
    else if (op.kind === "limit") v = Math.min(Math.max(op.min, op.max), Math.max(Math.min(op.min, op.max), n.velocity));
    else if (op.kind === "ramp") v = op.from + (op.to - op.from) * (span > 0 ? (n.at - first) / span : 0);
    else if (roll) v = n.velocity + (roll() * 2 - 1) * op.amount;
    return { ...n, velocity: clampVelocity(v) };
  });
}

export type DurationOp =
  | { kind: "set"; frames: number }
  | { kind: "scale"; percent: number }
  | { kind: "limit"; min: number; max: number }
  | { kind: "legato"; gap: number }
  | { kind: "overlap" }
  | { kind: "humanize"; percent: number; seed: number };

/** The picked notes' lengths set, scaled, held between two lengths, made legato (each runs to the next later start
 *  among the picked notes, less the gap; the last keep theirs), cut where the next note of the same pitch begins
 *  (overlap), or moved at random by up to a percentage either way; never shorter than a frame. */
export function changeDuration(notes: readonly NoteEvent[], pick: Pick, op: DurationOp): NoteEvent[] {
  const take = takes(pick);
  const chosenStarts = [...new Set(notes.filter((_, i) => take(i)).map((n) => n.at))].sort((a, b) => a - b);
  const roll = op.kind === "humanize" ? random(op.seed) : null;
  return notes.map((n, i) => {
    if (!take(i)) return n;
    let length = n.length;
    if (op.kind === "set") length = op.frames;
    else if (op.kind === "scale") length = (n.length * op.percent) / 100;
    else if (op.kind === "limit") length = Math.min(Math.max(op.min, op.max), Math.max(Math.min(op.min, op.max), n.length));
    else if (op.kind === "legato") {
      const next = chosenStarts.find((s) => s > n.at);
      if (next !== undefined) length = next - n.at - Math.max(0, op.gap);
    } else if (op.kind === "overlap") {
      const next = notes.filter((o) => o.pitch === n.pitch && o.at > n.at).reduce((best, o) => Math.min(best, o.at), Infinity);
      if (next < n.at + n.length) length = next - n.at;
    } else if (roll) length = n.length * (1 + ((roll() * 2 - 1) * op.percent) / 100);
    return { ...n, length: Math.max(1, Math.round(length)) };
  });
}

/** Duplicate notes among the picked: the same pitch starting within `tolerance` frames of another; each group keeps
 *  its longest note (the louder when two are as long), and the indexes of the rest are returned. */
export function duplicateNotes(notes: readonly NoteEvent[], pick: Pick, tolerance = 0): number[] {
  const take = takes(pick);
  const order = notes
    .map((_, i) => i)
    .filter(take)
    .sort((a, b) => notes[a].pitch - notes[b].pitch || notes[a].at - notes[b].at);
  const drop: number[] = [];
  let group: number[] = [];
  const close = () => {
    if (group.length > 1) {
      const keep = group.reduce((best, i) => (notes[i].length > notes[best].length || (notes[i].length === notes[best].length && notes[i].velocity > notes[best].velocity) ? i : best));
      drop.push(...group.filter((i) => i !== keep));
    }
    group = [];
  };
  for (const i of order) {
    const last = group[group.length - 1];
    if (last !== undefined && (notes[i].pitch !== notes[last].pitch || notes[i].at - notes[group[0]].at > tolerance)) close();
    group.push(i);
  }
  close();
  return drop.sort((a, b) => a - b);
}

export type SplitRule = { kind: "range"; low: number; high: number } | { kind: "top" } | { kind: "bottom" };

/** The picked notes a split takes to a new track: those within a pitch range, or the highest (or lowest) of each group
 *  of notes starting within `together` frames of the group's first (a lone note is its own highest and lowest). */
export function splitNotes(notes: readonly NoteEvent[], pick: Pick, rule: SplitRule, together = 0): number[] {
  const chosen = notes.map((_, i) => i).filter(takes(pick));
  if (rule.kind === "range") {
    const [low, high] = [Math.min(rule.low, rule.high), Math.max(rule.low, rule.high)];
    return chosen.filter((i) => notes[i].pitch >= low && notes[i].pitch <= high);
  }
  const order = [...chosen].sort((a, b) => notes[a].at - notes[b].at);
  const out: number[] = [];
  for (let k = 0; k < order.length; ) {
    let end = k + 1;
    while (end < order.length && notes[order[end]].at - notes[order[k]].at <= together) end++;
    const group = order.slice(k, end);
    out.push(group.reduce((best, i) => ((rule.kind === "top" ? notes[i].pitch > notes[best].pitch : notes[i].pitch < notes[best].pitch) ? i : best)));
    k = end;
  }
  return out.sort((a, b) => a - b);
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** A pitch's name with its octave, middle C (60) being C4. */
export function noteName(pitch: number): string {
  return `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** A note typed by name (C4, F#3, Bb2, e-1) or by number (0 to 127); null when it reads as neither. */
export function parseNoteName(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n <= 127 ? n : null;
  }
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(t);
  if (!m) return null;
  const base = NAMES.indexOf(m[1].toUpperCase());
  const pitch = base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

/** Chords by their intervals over the root, the plainest first (an exact match is looked for in this order). */
const CHORDS: readonly [string, readonly number[]][] = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["sus4", [0, 5, 7]],
  ["sus2", [0, 2, 7]],
  ["7", [0, 4, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
  ["6", [0, 4, 7, 9]],
  ["m6", [0, 3, 7, 9]],
  ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["mMaj7", [0, 3, 7, 11]],
  ["7sus4", [0, 5, 7, 10]],
  ["add9", [0, 2, 4, 7]],
  ["madd9", [0, 2, 3, 7]],
  ["9", [0, 2, 4, 7, 10]],
  ["maj9", [0, 2, 4, 7, 11]],
  ["m9", [0, 2, 3, 7, 10]],
  ["5", [0, 7]],
];

/** The chord a set of pitches spells: its root and kind, over its lowest note when that is not the root (C/E). Every
 *  pitch class must belong to the chord; when two readings fit (C6 and Am7 share their notes) the one rooted on the
 *  lowest note wins, then the plainer. Null for one pitch class or a set that spells no chord here. */
export function chordName(pitches: readonly number[]): string | null {
  if (!pitches.length) return null;
  const classes = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
  const bass = ((Math.min(...pitches) % 12) + 12) % 12;
  let best: { root: number; rank: number; suffix: string } | null = null;
  for (const root of classes) {
    for (let rank = 0; rank < CHORDS.length; rank++) {
      const [suffix, intervals] = CHORDS[rank];
      if (intervals.length !== classes.size || !intervals.every((iv) => classes.has((root + iv) % 12))) continue;
      const onBass = root === bass;
      if (!best || (onBass && best.root !== bass) || (onBass === (best.root === bass) && rank < best.rank)) best = { root, rank, suffix };
    }
  }
  if (!best) return null;
  return `${NAMES[best.root]}${best.suffix}${best.root === bass ? "" : `/${NAMES[bass]}`}`;
}

/** The chord of each bar the notes sound in, from `from` to `to`: the pitch classes sounding for at least a quarter of
 *  the bar, named over the lowest of their notes; a bar is listed only where its chord differs from the bar before. */
export function chordsByBar(doc: SessionDoc, notes: readonly NoteEvent[], from: number, to: number): { at: number; name: string }[] {
  const out: { at: number; name: string }[] = [];
  let last: string | null = null;
  // S11: the bars as the tempo and meter map lays them (one length at one tempo and meter)
  const map = tempoMap(doc);
  const lines = barsBetween(map, from, to).filter((x) => x.at < to);
  for (const line of lines) {
    const a = line.at;
    const b = tickToSample(map, barStartTick(map, line.bar + 1));
    const bar = b - a;
    const heard = new Map<number, number>();
    const pitches = new Map<number, number>();
    for (const n of notes) {
      const overlap = Math.min(b, n.at + n.length) - Math.max(a, n.at);
      if (overlap <= 0) continue;
      const pc = ((n.pitch % 12) + 12) % 12;
      heard.set(pc, (heard.get(pc) ?? 0) + overlap);
      pitches.set(pc, Math.min(pitches.get(pc) ?? 128, n.pitch));
    }
    const kept = [...heard].filter(([, w]) => w >= bar / 4).map(([pc]) => pitches.get(pc) as number);
    const name = chordName(kept);
    if (name && name !== last) out.push({ at: Math.round(a), name });
    last = name ?? last;
  }
  return out;
}
