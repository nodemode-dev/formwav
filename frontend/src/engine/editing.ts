/**
 * PLAN_v13 S4's editing commands as pure functions of the session: each returns one command, a labelled batch that is
 * one undo step, or null when there is nothing to do. The interface dispatches what they return (ui/editing.ts).
 */
import { applyCommand, copyLane, insertLane, mapLanes, memoryNumbers, pasteLane, sessionLength, type AutoPoint, type Clip, type Command, type FadeShape, type MediaRef, type SessionDoc } from "./document";

export interface EditRange {
  trackId: string;
  start: number;
  end: number;
}

/** What an edit acts on, as the lanes hold it: a range on one track, or selected clips. */
export interface EditTarget {
  range: EditRange | null;
  clipIds: readonly string[];
}

type Piece = { trackId: string; clip: Omit<Clip, "id"> };

const rate = (doc: SessionDoc, c: Clip) => {
  const m = doc.media[c.mediaId];
  return m ? m.sampleRate / doc.sampleRate : 1;
};

const batch = (label: string, commands: Command[], whole = false): Command | null => (commands.length ? { type: "batch", label, commands, ...(whole ? { whole } : {}) } : null);

/** The part of a clip between a and b as a clip of its own (the cut split-clip makes at each end). */
export function clipPiece(doc: SessionDoc, c: Clip, a: number, b: number): Omit<Clip, "id"> {
  const from = Math.max(a, c.start);
  const to = Math.min(b, c.start + c.length);
  const offset = Math.round((from - c.start) * rate(doc, c));
  const { id: _id, groupId: _group, launched: _launched, ...rest } = c;
  const fadeIn = from === c.start ? Math.min(c.fadeIn ?? 0, to - from) : 0;
  return {
    ...rest,
    start: from,
    length: to - from,
    sourceIn: c.sourceIn + offset,
    fadeIn,
    fadeOut: to === c.start + c.length ? Math.min(c.fadeOut ?? 0, to - from - fadeIn) : 0,
    ...(c.takes ? { takes: c.takes.map((o) => o + offset) } : {}),
  };
}

/** The tracks and time an edit covers, with the audio in it: the range's track and bounds, or the selected clips'
 *  tracks from the first start to the last end; null with neither. */
export function editSpan(doc: SessionDoc, target: EditTarget): { trackIds: string[]; start: number; end: number; pieces: Piece[] } | null {
  const r = target.range;
  if (r && r.end > r.start) {
    const track = doc.tracks.find((t) => t.id === r.trackId);
    if (!track) return null;
    const pieces = track.clips.filter((c) => c.start < r.end && c.start + c.length > r.start).map((c) => ({ trackId: track.id, clip: clipPiece(doc, c, r.start, r.end) }));
    return { trackIds: [track.id], start: r.start, end: r.end, pieces };
  }
  const ids = new Set(target.clipIds);
  const chosen = doc.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((clip) => ({ trackId: t.id, clip })));
  if (!chosen.length) return null;
  return {
    trackIds: [...new Set(chosen.map((x) => x.trackId))],
    start: Math.min(...chosen.map((x) => x.clip.start)),
    end: Math.max(...chosen.map((x) => x.clip.start + x.clip.length)),
    pieces: chosen.map(({ trackId, clip }) => ({ trackId, clip: clipPiece(doc, clip, clip.start, clip.start + clip.length) })),
  };
}

/** Pro Tools' Duplicate (one copy) and Repeat: copies of the span end to end after it, its automation with them; over
 *  what lies there, or with Shuffle on opening time for them first. */
export function repeatSpan(doc: SessionDoc, target: EditTarget, count: number, shuffle: boolean): Command | null {
  const span = editSpan(doc, target);
  const n = Math.round(count);
  if (!span || !span.pieces.length || n < 1 || n > 999) return null;
  const len = span.end - span.start;
  const total = len * n;
  const commands: Command[] = shuffle
    ? [{ type: "insert-time", trackIds: span.trackIds, at: span.end, length: total, follow: "tracks" }]
    : span.trackIds.map((trackId) => ({ type: "clear-range", trackId, start: span.end, end: span.end + total, ripple: false }));
  for (let k = 1; k <= n; k++) for (const p of span.pieces) commands.push({ type: "paste-clip", trackId: p.trackId, clip: { ...p.clip, start: p.clip.start + k * len } });
  for (const trackId of span.trackIds) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const lane = (points: readonly AutoPoint[], gain: boolean) => copyLane(shuffle ? insertLane(points, span.end, total, gain) : points, span.start, span.end, n, gain);
    const copied = mapLanes(track, lane);
    if (copied === track) continue;
    for (const param of ["volume", "pan"] as const) {
      const points = copied.automation?.[param];
      if (points && points !== track.automation?.[param]) commands.push({ type: "set-automation", trackId, param, points: [...points] });
    }
    copied.fx?.forEach((f, fxIndex) => {
      const before = track.fx?.[fxIndex];
      if (!("automation" in f) || !f.automation || !before || !("automation" in before)) return;
      for (const param of ["freq", "gain", "q"] as const) {
        const points = f.automation[param];
        if (points && points !== before.automation?.[param]) commands.push({ type: "set-fx-automation", trackId, fxIndex, param, points: [...points] });
      }
    });
  }
  return batch(n === 1 ? (target.range ? "Duplicated a range" : "Duplicated clips") : `Repeated ${target.range ? "a range" : "clips"} ${n} times`, commands, true);
}

/** Pro Tools' Shift: the selected clips moved later by `by` samples (earlier when negative), stopped at the start. */
export function shiftClips(doc: SessionDoc, clipIds: readonly string[], by: number): Command | null {
  const ids = new Set(clipIds);
  const chosen = doc.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((clip) => ({ trackId: t.id, clip })));
  if (!chosen.length) return null;
  const delta = Math.max(-Math.min(...chosen.map((x) => x.clip.start)), Math.round(by));
  if (!delta) return null;
  return batch(delta > 0 ? "Shifted clips later" : "Shifted clips earlier", chosen.map(({ trackId, clip }) => ({ type: "move-clip", trackId, clipId: clip.id, start: clip.start + delta })));
}

/** Insert Silence: the span's length of silence opened at its start on its tracks, their automation moving too. */
export function insertSilence(doc: SessionDoc, target: EditTarget): Command | null {
  const span = editSpan(doc, target);
  if (!span) return null;
  return batch("Inserted silence", [{ type: "insert-time", trackIds: span.trackIds, at: span.start, length: span.end - span.start, follow: "tracks" }]);
}

/** Time Operations' Insert Time and Cut Time: on every track, with the markers, regions, the loop and automation. */
export function timeOperation(doc: SessionDoc, kind: "insert" | "cut", start: number, end: number): Command | null {
  const a = Math.max(0, Math.round(Math.min(start, end)));
  const b = Math.round(Math.max(start, end));
  if (b <= a || !doc.tracks.length) return null;
  const trackIds = doc.tracks.map((t) => t.id);
  return kind === "insert"
    ? batch("Inserted time across the session", [{ type: "insert-time", trackIds, at: a, length: b - a, follow: "session" }])
    : batch("Cut time across the session", [{ type: "clear-ranges", trackIds, ranges: [{ start: a, end: b }], ripple: true, follow: "session" }]);
}

const bounds = (doc: SessionDoc, trackId: string, c: Clip, from: number, to: number): Command | null => {
  if (to - from < 1 || (from === c.start && to === c.start + c.length)) return null;
  return { type: "set-clip-bounds", trackId, clipId: c.id, start: from, sourceIn: c.sourceIn + Math.round((from - c.start) * rate(doc, c)), length: to - from };
};

const only = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);

/** Trim to Selection: clips on the range's track that cross its edges keep only what lies inside it. */
export function trimToRange(doc: SessionDoc, range: EditRange): Command | null {
  const track = doc.tracks.find((t) => t.id === range.trackId);
  const cuts = (track?.clips ?? []).filter((c) => c.start < range.end && c.start + c.length > range.start).map((c) => bounds(doc, range.trackId, c, Math.max(c.start, range.start), Math.min(c.start + c.length, range.end)));
  return batch("Trimmed to the selection", only(cuts));
}

/** The clips an edit at the playhead acts on: the selected ones, or else those on the range's track. */
function underPlayhead(doc: SessionDoc, target: EditTarget, at: number): { trackId: string; clip: Clip }[] {
  const ids = new Set(target.clipIds);
  const all = doc.tracks.flatMap((t) => t.clips.map((clip) => ({ trackId: t.id, clip })));
  const picked = ids.size ? all.filter((x) => ids.has(x.clip.id)) : target.range ? all.filter((x) => x.trackId === target.range?.trackId) : [];
  return picked.filter((x) => x.clip.start < at && at < x.clip.start + x.clip.length);
}

/** Trim Start or End to Insertion: the clips under the playhead lose what lies before it, or after it. */
export function trimToPlayhead(doc: SessionDoc, target: EditTarget, at: number, edge: "start" | "end"): Command | null {
  const cuts = underPlayhead(doc, target, Math.round(at)).map(({ trackId, clip }) => (edge === "start" ? bounds(doc, trackId, clip, Math.round(at), clip.start + clip.length) : bounds(doc, trackId, clip, clip.start, Math.round(at))));
  return batch(edge === "start" ? "Trimmed a start to the playhead" : "Trimmed an end to the playhead", only(cuts));
}

/** Where a clip's whole file would lie at its place: from its first sample to its last, in session samples. */
function fileSpan(doc: SessionDoc, c: Clip): { from: number; to: number } | null {
  const media = doc.media[c.mediaId];
  if (!media) return null;
  const from = c.start - Math.round(c.sourceIn / rate(doc, c));
  return { from, to: from + sessionLength(media, doc.sampleRate) };
}

/** The longest a clip reading its file from `sourceIn` can be, counted as set-clip-bounds counts it. */
const reach = (doc: SessionDoc, c: Clip, sourceIn: number): number => {
  const media = doc.media[c.mediaId];
  return media ? sessionLength(media, doc.sampleRate) - Math.round((sourceIn * doc.sampleRate) / media.sampleRate) : 0;
};

/** Trim to File Boundaries: each selected clip opened out to its whole file (from the session start at the earliest). */
export function trimToFile(doc: SessionDoc, clipIds: readonly string[]): Command | null {
  const ids = new Set(clipIds);
  const cuts = doc.tracks.flatMap((t) =>
    t.clips
      .filter((c) => ids.has(c.id))
      .map((c) => {
        const file = fileSpan(doc, c);
        if (!file) return null;
        const from = Math.max(0, file.from);
        const sourceIn = Math.round((from - file.from) * rate(doc, c));
        const length = Math.min(file.to - from, reach(doc, c, sourceIn));
        return from === c.start && length === c.length ? null : ({ type: "set-clip-bounds", trackId: t.id, clipId: c.id, start: from, sourceIn, length } as Command);
      }),
  );
  return batch("Trimmed to the file's edges", only(cuts));
}

/** Trim to Fill Selection: clips on the range's track that meet it take its edges, as far as their files reach. */
export function trimToFill(doc: SessionDoc, range: EditRange): Command | null {
  const track = doc.tracks.find((t) => t.id === range.trackId);
  const cuts = (track?.clips ?? [])
    .filter((c) => c.start < range.end && c.start + c.length > range.start)
    .map((c) => {
      const file = fileSpan(doc, c);
      if (!file) return null;
      const from = Math.max(range.start, file.from, 0);
      const sourceIn = Math.max(0, c.sourceIn + Math.round((from - c.start) * rate(doc, c)));
      const length = Math.min(Math.min(range.end, file.to) - from, reach(doc, c, sourceIn));
      if (length < 1 || (from === c.start && length === c.length)) return null;
      return { type: "set-clip-bounds", trackId: range.trackId, clipId: c.id, start: from, sourceIn, length } as Command;
    });
  return batch("Trimmed to fill the selection", only(cuts));
}

const sameKeys = (c: Clip) => {
  const { id: _i, start: _s, length: _l, sourceIn: _in, fadeIn: _fi, fadeOut: _fo, takes: _t, ...rest } = c;
  return JSON.stringify(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** Whether b carries on from a exactly as a split leaves them: end to start with no fade at the join, the same file
 *  read on, all else equal; so the two healed play as they did. */
export function continues(doc: SessionDoc, a: Clip, b: Clip): boolean {
  if (a.start + a.length !== b.start || a.mediaId !== b.mediaId || (a.fadeOut ?? 0) !== 0 || (b.fadeIn ?? 0) !== 0) return false;
  // in the file's own samples; a file at another rate than the session's rounds each split by up to a sample
  const step = a.length * rate(doc, a);
  const near = (x: number | undefined, y: number) => x !== undefined && Math.abs(x - y) <= 1;
  if (!near(b.sourceIn, a.sourceIn + step)) return false;
  if ((a.takes?.length ?? 0) !== (b.takes?.length ?? 0) || a.takes?.some((o, i) => !near(b.takes?.[i], o + step))) return false;
  return sameKeys(a) === sameKeys(b);
}

/** Heal Separation: neighbouring clips that carry on one from the other become one again; with a range, those whose
 *  join lies in it, with clips selected, pairs both selected, else the join at the playhead. */
export function healSeparations(doc: SessionDoc, target: EditTarget, at: number): Command | null {
  const ids = new Set(target.clipIds);
  const commands: Command[] = [];
  for (const t of doc.tracks) {
    if (target.range && t.id !== target.range.trackId) continue;
    const inScope = (a: Clip, b: Clip) => (target.range ? b.start >= target.range.start && b.start <= target.range.end : ids.size ? ids.has(a.id) && ids.has(b.id) : Math.abs(b.start - at) <= 1);
    const clips = [...t.clips].sort((x, y) => x.start - y.start);
    for (let i = 0; i < clips.length; ) {
      const head = clips[i];
      let tail = head;
      let length = head.length;
      let j = i + 1;
      while (j < clips.length && continues(doc, tail, clips[j]) && inScope(tail, clips[j])) {
        tail = clips[j];
        length += tail.length;
        commands.push({ type: "remove-clip", trackId: t.id, clipId: tail.id });
        j++;
      }
      if (tail !== head) {
        commands.push({ type: "set-clip-bounds", trackId: t.id, clipId: head.id, start: head.start, sourceIn: head.sourceIn, length });
        if ((tail.fadeOut ?? 0) !== 0) commands.push({ type: "set-clip-fades", trackId: t.id, clipId: head.id, fadeIn: head.fadeIn ?? 0, fadeOut: tail.fadeOut ?? 0, ...(head.fadeShape ? { shape: head.fadeShape } : {}) });
      }
      i = j;
    }
  }
  return batch("Healed a separation", commands);
}

/** Separate on Grid: clips split at each grid line, `step` samples apart from the session start (or the lines a grid
 *  value gives between two positions), inside the range or inside each selected clip; null for no line or a grid finer
 *  than a sample or of more than 2000 lines. */
export function separateOnGrid(doc: SessionDoc, target: EditTarget, step: number | ((from: number, to: number) => number[])): Command | null {
  if (typeof step === "number" && !(step >= 1)) return null;
  const ids = new Set(target.clipIds);
  const commands: Command[] = [];
  for (const t of doc.tracks) {
    for (const c of t.clips) {
      const r = target.range;
      if (r ? t.id !== r.trackId : !ids.has(c.id)) continue;
      const from = Math.max(c.start, r ? r.start : c.start);
      const to = Math.min(c.start + c.length, r ? r.end : c.start + c.length);
      const lines: number[] = [];
      const given = typeof step === "number" ? null : step(from, to);
      if (given && given.length > 2001) return null;
      for (const at of given ?? []) if (at > c.start && at < c.start + c.length && at >= from && at <= to) lines.push(at);
      for (let k = typeof step === "number" ? Math.ceil(from / step) : 0; typeof step === "number" && k * step <= to; k++) {
        const at = Math.round(k * step);
        if (at > c.start && at < c.start + c.length && at >= from && at <= to) lines.push(at);
        if (lines.length > 2000) return null;
      }
      for (const at of lines.reverse()) commands.push({ type: "split-clip", trackId: t.id, clipId: c.id, at });
    }
  }
  return batch("Separated on the grid", commands);
}

/** Strip Silence's gaps: where a track is active (seconds) padded before and after (seconds), merged, and what lies
 *  between them inside from to (samples), as the ranges to clear. */
export function stripGaps(active: readonly (readonly [number, number])[], sampleRate: number, from: number, to: number, padBefore: number, padAfter: number): { start: number; end: number }[] {
  const keep: [number, number][] = [];
  for (const [s, e] of [...active].sort((x, y) => x[0] - y[0])) {
    const a = Math.max(from, Math.round((s - padBefore) * sampleRate));
    const b = Math.min(to, Math.round((e + padAfter) * sampleRate));
    if (b <= a) continue;
    const last = keep[keep.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else keep.push([a, b]);
  }
  const gaps: { start: number; end: number }[] = [];
  let at = from;
  for (const [a, b] of keep) {
    if (a > at) gaps.push({ start: at, end: a });
    at = Math.max(at, b);
  }
  if (to > at) gaps.push({ start: at, end: to });
  return gaps;
}

/** Identify Beat: the tempo at which `length` samples last `bars` bars of `beatsPerBar` beats. */
export function identifyBeat(length: number, sampleRate: number, bars: number, beatsPerBar: number): number | null {
  if (!(length > 0) || !(bars > 0) || !(beatsPerBar > 0)) return null;
  return (bars * beatsPerBar * 60 * sampleRate) / length;
}

/** TCE to Selection: the clip's audio swapped for its stretched render (`media`), set at `start` and `length` long
 *  (as far as the render reaches), as one step. */
export function fitToRange(doc: SessionDoc, trackId: string, clipId: string, media: MediaRef, start: number, length: number): Command | null {
  const swapped = applyCommand(doc, { type: "set-clip-media", trackId, clipId, media }, () => "fit");
  const clip = swapped.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const available = sessionLength(media, doc.sampleRate) - Math.round((clip.sourceIn * doc.sampleRate) / media.sampleRate);
  return batch("Fitted a clip to the selection", [
    { type: "set-clip-media", trackId, clipId, media },
    { type: "set-clip-bounds", trackId, clipId, start: Math.max(0, Math.round(start)), sourceIn: clip.sourceIn, length: Math.max(1, Math.min(Math.round(length), available)) },
  ], true);
}

/** A media's transients (its own seconds) where they fall inside the clip, in session samples. */
export function clipTransients(doc: SessionDoc, clip: Clip, seconds: readonly number[], mediaRate: number): number[] {
  const k = doc.sampleRate / mediaRate;
  return seconds.map((s) => clip.start + Math.round((s * mediaRate - clip.sourceIn) * k)).filter((x) => x > clip.start && x < clip.start + clip.length);
}

/** Tab and Shift Tab: the next clip edge after `at` (or the last before it) on the given tracks (every track for
 *  null), `extra` stops (transients) among them. */
export function nextStop(doc: SessionDoc, trackIds: readonly string[] | null, at: number, direction: 1 | -1, extra: readonly number[] = []): number | null {
  const stops = new Set<number>(extra);
  for (const t of doc.tracks) {
    if (trackIds && !trackIds.includes(t.id)) continue;
    for (const c of t.clips) {
      stops.add(c.start);
      stops.add(c.start + c.length);
    }
  }
  const sorted = [...stops].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((s) => s > at) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < at) return sorted[i];
  return null;
}

/** Nudge: the selected clips moved by `by` samples (the nudge value, either way), stopped at the session start; a
 *  locked clip stays where it is. */
export function nudgeClips(doc: SessionDoc, clipIds: readonly string[], by: number): Command | null {
  const ids = new Set(clipIds);
  const chosen = doc.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id) && !c.lock).map((clip) => ({ trackId: t.id, clip })));
  if (!chosen.length) return null;
  const delta = Math.max(-Math.min(...chosen.map((x) => x.clip.start)), Math.round(by));
  if (!delta) return null;
  return batch(delta > 0 ? "Nudged clips later" : "Nudged clips earlier", chosen.map(({ trackId, clip }) => ({ type: "move-clip", trackId, clipId: clip.id, start: clip.start + delta })));
}

const inShape = (c: Clip): FadeShape => c.fadeShape ?? "linear";
const outShape = (c: Clip): FadeShape => c.fadeOutShape ?? inShape(c);

/** Create Fades from a selection (Pro Tools' Cmd F): where the range crosses a butt splice, a crossfade over the whole
 *  of the range around it, each clip lengthened past the splice by as much of the range as lies on the other side and
 *  its file still holds; where the range takes in a clip's start and ends inside it, a fade-in to the range's end; where
 *  it starts inside a clip and takes in its end, a fade-out from the range's start. */
export function createFades(doc: SessionDoc, range: EditRange, shape: FadeShape): Command | null {
  const track = doc.tracks.find((t) => t.id === range.trackId);
  if (!track || range.end <= range.start) return null;
  const trackId = track.id;
  const inside = (at: number) => range.start < at && at < range.end;
  const ordered = [...track.clips].sort((a, b) => a.start - b.start);
  const splices = ordered.flatMap((left, i) => {
    const right = ordered[i + 1];
    return right && right.start === left.start + left.length && inside(right.start) ? [{ left, right, at: right.start }] : [];
  });
  const faded = new Set(splices.flatMap((s) => [s.left.id, s.right.id]));
  const commands: Command[] = [];
  for (const { left, right, at } of splices) {
    const rangeBefore = at - Math.max(range.start, left.start);
    const rangeAfter = Math.min(range.end, right.start + right.length) - at;
    const leftHandle = Math.max(0, Math.min(rangeAfter, reach(doc, left, left.sourceIn) - left.length));
    const rightHandle = Math.max(0, Math.min(rangeBefore, Math.floor(right.sourceIn / rate(doc, right))));
    if (leftHandle > 0) commands.push({ type: "set-clip-bounds", trackId, clipId: left.id, start: left.start, sourceIn: left.sourceIn, length: left.length + leftHandle });
    if (rightHandle > 0) {
      const sourceIn = right.sourceIn - Math.round(rightHandle * rate(doc, right));
      commands.push({ type: "set-clip-bounds", trackId, clipId: right.id, start: at - rightHandle, sourceIn, length: right.length + rightHandle });
    }
    commands.push({ type: "set-clip-fades", trackId, clipId: left.id, fadeIn: left.fadeIn ?? 0, fadeOut: rangeBefore + leftHandle, outShape: shape });
    commands.push({ type: "set-clip-fades", trackId, clipId: right.id, fadeIn: rangeAfter + rightHandle, fadeOut: right.fadeOut ?? 0, shape, outShape: outShape(right) });
  }
  for (const c of ordered) {
    if (faded.has(c.id)) continue;
    const end = c.start + c.length;
    const takesStart = range.start <= c.start && c.start < range.end && range.end < end;
    const takesEnd = c.start < range.start && range.start < end && end <= range.end;
    if (takesStart) commands.push({ type: "set-clip-fades", trackId, clipId: c.id, fadeIn: range.end - c.start, fadeOut: c.fadeOut ?? 0, shape, outShape: outShape(c) });
    else if (takesEnd) commands.push({ type: "set-clip-fades", trackId, clipId: c.id, fadeIn: c.fadeIn ?? 0, fadeOut: end - range.start, outShape: shape });
  }
  return batch("Created fades", commands, true);
}

/** Delete Fades: the fades of the clips the range touches, or of the selected clips. */
export function deleteFades(doc: SessionDoc, target: EditTarget): Command | null {
  const ids = new Set(target.clipIds);
  const r = target.range;
  const commands: Command[] = doc.tracks.flatMap((t) =>
    t.clips
      .filter((c) => (r ? t.id === r.trackId && c.start < r.end && c.start + c.length > r.start : ids.has(c.id)) && ((c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0))
      .map((c) => ({ type: "set-clip-fades", trackId: t.id, clipId: c.id, fadeIn: 0, fadeOut: 0 }) as Command),
  );
  return batch("Deleted fades", commands);
}

/** Fade to Start and Fade to End: the clips under the playhead fade in from their start to it, or out from it. */
export function fadeToPlayhead(doc: SessionDoc, target: EditTarget, at: number, edge: "start" | "end"): Command | null {
  const x = Math.round(at);
  const commands = underPlayhead(doc, target, x).map(({ trackId, clip }): Command =>
    edge === "start"
      ? { type: "set-clip-fades", trackId, clipId: clip.id, fadeIn: x - clip.start, fadeOut: Math.min(clip.fadeOut ?? 0, clip.start + clip.length - x) }
      : { type: "set-clip-fades", trackId, clipId: clip.id, fadeIn: Math.min(clip.fadeIn ?? 0, x - clip.start), fadeOut: clip.start + clip.length - x },
  );
  return batch(edge === "start" ? "Faded in to the playhead" : "Faded out from the playhead", commands);
}

/** A copied range: the audio in it (starts counted from the range's start), its length, and its track's volume and pan
 *  lanes with where the range began on them. */
export interface RangeClip {
  start: number;
  length: number;
  pieces: Omit<Clip, "id">[];
  volume?: AutoPoint[];
  pan?: AutoPoint[];
}

/** Range copy (Pro Tools' Copy with an edit selection): what plays in the range, its automation with it. */
export function copyRange(doc: SessionDoc, range: EditRange): RangeClip | null {
  const span = editSpan(doc, { range, clipIds: [] });
  const track = doc.tracks.find((t) => t.id === range.trackId);
  if (!span || !track) return null;
  return {
    start: span.start,
    length: span.end - span.start,
    pieces: span.pieces.map((p) => ({ ...p.clip, start: p.clip.start - span.start })),
    ...(track.automation?.volume?.length ? { volume: [...track.automation.volume] } : {}),
    ...(track.automation?.pan?.length ? { pan: [...track.automation.pan] } : {}),
  };
}

/** Paste a copied range at `at` on a track, over what lies there (with Shuffle, opening time for it), its automation
 *  pasted with it so the range plays as it did where it was copied. */
export function pasteRange(doc: SessionDoc, copied: RangeClip, trackId: string, at: number, shuffle: boolean): Command | null {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || copied.length < 1) return null;
  const a = Math.max(0, Math.round(at));
  const commands: Command[] = [
    shuffle ? { type: "insert-time", trackIds: [trackId], at: a, length: copied.length, follow: "tracks" } : { type: "clear-range", trackId, start: a, end: a + copied.length, ripple: false },
    ...copied.pieces.map((p): Command => ({ type: "paste-clip", trackId, clip: { ...p, start: p.start + a } })),
  ];
  const opened = shuffle ? mapLanes(track, (points, gain) => insertLane(points, a, copied.length, gain)) : track;
  for (const param of ["volume", "pan"] as const) {
    const source = copied[param];
    if (!source?.length) continue;
    const flat = param === "volume" ? track.gainDb : (track.pan ?? 0);
    commands.push({ type: "set-automation", trackId, param, points: pasteLane(opened.automation?.[param] ?? [], flat, source, copied.start, copied.length, a, param === "volume") });
  }
  return batch("Pasted a range", commands, true);
}

/** S6, Consolidate (Pro Tools' Consolidate Clip): what plays from `start` to `end` on a track, rendered by the engine
 *  into one file (`media`), set over that span as one clip; a whole batch, its clearing and its placing one edit. */
export function consolidate(doc: SessionDoc, trackId: string, start: number, end: number, media: MediaRef): Command | null {
  const a = Math.max(0, Math.round(start));
  const b = Math.round(end);
  if (b <= a || !doc.tracks.some((t) => t.id === trackId)) return null;
  return batch(
    "Consolidated clips",
    [
      { type: "clear-range", trackId, start: a, end: b, ripple: false },
      { type: "import-media", media, at: a, trackId, clip: { sourceIn: 0, length: Math.min(b - a, sessionLength(media, doc.sampleRate)) } },
    ],
    true,
  );
}

const picked = (doc: SessionDoc, clipIds: readonly string[]) => {
  const ids = new Set(clipIds);
  return doc.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
};

/** Clip mute (Pro Tools' Mute Clips): the selected clips muted, or unmuted when every one already is. */
export function muteClips(doc: SessionDoc, clipIds: readonly string[]): Command | null {
  const chosen = picked(doc, clipIds);
  if (!chosen.length) return null;
  const mute = chosen.some((c) => !c.mute);
  return batch(mute ? "Muted clips" : "Unmuted clips", [{ type: "set-clips-mute", clipIds: chosen.map((c) => c.id), mute }]);
}

/** Time Lock and Edit Lock: the selected clips locked that way, or unlocked when every one already is. */
export function lockClips(doc: SessionDoc, clipIds: readonly string[], kind: "time" | "edit"): Command | null {
  const chosen = picked(doc, clipIds);
  if (!chosen.length) return null;
  const lock = chosen.every((c) => c.lock === kind) ? null : kind;
  return batch(lock === null ? "Unlocked clips" : kind === "time" ? "Time-locked clips" : "Edit-locked clips", [{ type: "set-clips-lock", clipIds: chosen.map((c) => c.id), lock }]);
}

/** Space Clips: on each track, its selected clips laid out in time order from where the first one starts, each the
 *  next `gap` samples after the last one's end (or, start to start, after its start); a locked clip neither moves nor
 *  takes a place. */
export function spaceClips(doc: SessionDoc, clipIds: readonly string[], gap: number, startToStart: boolean): Command | null {
  const ids = new Set(clipIds);
  const commands: Command[] = [];
  for (const t of doc.tracks) {
    const lineUp = t.clips.filter((c) => ids.has(c.id) && !c.lock).sort((a, b) => a.start - b.start);
    let next = lineUp.length > 1 ? lineUp[0].start : null;
    for (const c of next === null ? [] : lineUp) {
      const start = Math.max(0, Math.round(next as number));
      if (start !== c.start) commands.push({ type: "move-clip", trackId: t.id, clipId: c.id, start });
      next = start + gap + (startToStart ? 0 : c.length);
    }
  }
  return batch("Spaced clips", commands);
}

/** Snap to Next and Previous: each selected clip moved up against the nearest clip after it (its end on that clip's
 *  start) or before it (its start on that clip's end), on its own track; selected clips are not what it snaps to. */
export function snapClips(doc: SessionDoc, clipIds: readonly string[], to: "next" | "previous"): Command | null {
  const ids = new Set(clipIds);
  const commands: Command[] = [];
  for (const t of doc.tracks) {
    const fixed = t.clips.filter((c) => !ids.has(c.id));
    for (const c of t.clips.filter((x) => ids.has(x.id) && !x.lock)) {
      const end = c.start + c.length;
      const target =
        to === "next"
          ? fixed.filter((o) => o.start >= end).reduce<number | null>((best, o) => (best === null || o.start < best ? o.start : best), null)
          : fixed.filter((o) => o.start + o.length <= c.start).reduce<number | null>((best, o) => (best === null || o.start + o.length > best ? o.start + o.length : best), null);
      if (target === null) continue;
      const start = to === "next" ? target - c.length : target;
      if (start !== c.start) commands.push({ type: "move-clip", trackId: t.id, clipId: c.id, start });
    }
  }
  return batch(to === "next" ? "Snapped clips to the next clip" : "Snapped clips to the previous clip", commands);
}

/** A memory location: a marker (start equals end) or a region (a selection location), with its number. */
export interface MemoryLocation {
  id: string;
  kind: "marker" | "region";
  number: number;
  start: number;
  end: number;
}

/** The session's memory locations in time order. */
export function memoryLocations(doc: SessionDoc): MemoryLocation[] {
  const numbers = memoryNumbers(doc);
  return [
    ...doc.markers.map((m): MemoryLocation => ({ id: m.id, kind: "marker", number: numbers.get(m.id) ?? 0, start: m.at, end: m.at })),
    ...(doc.regions ?? []).map((r): MemoryLocation => ({ id: r.id, kind: "region", number: numbers.get(r.id) ?? 0, start: r.start, end: r.end })),
  ].sort((a, b) => a.start - b.start || a.number - b.number);
}

/** The memory location numbered `n`. */
export function findMemory(doc: SessionDoc, n: number): MemoryLocation | null {
  return memoryLocations(doc).find((m) => m.number === n) ?? null;
}

/** The first memory location after `at`, or the last one before it. */
export function nextMemory(doc: SessionDoc, at: number, direction: 1 | -1): MemoryLocation | null {
  const all = memoryLocations(doc);
  if (direction > 0) return all.find((m) => m.start > at) ?? null;
  return [...all].reverse().find((m) => m.start < at) ?? null;
}
