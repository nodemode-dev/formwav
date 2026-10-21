import type { NoteEvent } from "./document";

/**
 * Sung lyrics on notes (DEV_PLAN_sung_lyrics L1): a note sings its `lyric`, or the session's default syllable when it
 * has none. A line typed or pasted on a note is split into syllables, one per note from that note on in time order;
 * "-" or "_" alone holds the previous syllable over a note (a melisma). Pure functions, no interface.
 */
export const SING_SYLLABLES = ["da", "la"] as const;
export type SingSyllable = (typeof SING_SYLLABLES)[number];
export const DEFAULT_SYLLABLE: SingSyllable = "da";
export const HOLD = "-";

const VOWEL = /[aeiouy]/i;
const ONSETS = new Set(["bl", "br", "ch", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "ph", "pl", "pr", "sc", "sh", "sk", "sl", "sm", "sn", "sp", "st", "sw", "th", "tr", "tw", "wh", "wr", "qu", "scr", "shr", "spl", "spr", "str", "thr"]);

/** One word's syllables: vowel groups are the nuclei, a silent final e and the y that starts a word are not, a final
 *  consonant plus "le" is its own syllable; one consonant between nuclei starts the next syllable, a cluster is split so
 *  the next syllable keeps the longest onset English allows. An approximation, corrected by typing hyphens. */
export function syllablesOf(word: string): string[] {
  const lower = word.toLowerCase();
  const letters = [...lower];
  const nucleus = letters.map((ch, i) => VOWEL.test(ch) && !(ch === "y" && i === 0) && !(ch === "u" && letters[i - 1] === "q"));
  const n = letters.length;
  if (n > 2 && lower.endsWith("e") && !lower.endsWith("le") && !lower.endsWith("ee") && nucleus.slice(0, n - 1).some(Boolean) && !nucleus[n - 2]) nucleus[n - 1] = false;
  if (n > 2 && lower.endsWith("le") && !nucleus[n - 3]) nucleus[n - 2] = true;
  const groups: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!nucleus[i]) continue;
    if (groups.length && groups[groups.length - 1][1] === i) groups[groups.length - 1][1] = i + 1;
    else groups.push([i, i + 1]);
  }
  if (groups.length < 2) return [word];
  const cuts: number[] = [];
  for (let g = 1; g < groups.length; g++) {
    const from = groups[g - 1][1];
    const to = groups[g][0];
    const cluster = lower.slice(from, to);
    let cut = to;
    if (cluster.length === 1) cut = from;
    else if (cluster.length > 1) {
      cut = to - 1;
      for (let k = 0; k < cluster.length; k++) if (ONSETS.has(cluster.slice(k))) {
        cut = from + k;
        break;
      }
    }
    if (lower.endsWith("le") && g === groups.length - 1 && to === n - 2) cut = n - 3;
    cuts.push(cut);
  }
  const out: string[] = [];
  let last = 0;
  for (const c of cuts) {
    if (c > last && c < n) {
      out.push(word.slice(last, c));
      last = c;
    }
  }
  out.push(word.slice(last));
  return out.filter((s) => s.length > 0);
}

/** A line as one syllable per note: words split by syllablesOf, a hyphen typed inside a word splits it there instead,
 *  and "-" or "_" standing alone holds the syllable before it. */
export function syllabify(line: string): string[] {
  const out: string[] = [];
  for (const raw of line.trim().split(/\s+/)) {
    if (!raw) continue;
    if (raw === "-" || raw === "_" || /^[-_]+$/.test(raw)) {
      for (let i = 0; i < raw.length; i++) out.push(HOLD);
      continue;
    }
    if (raw.includes("-")) {
      for (const part of raw.split("-")) if (part) out.push(part);
      continue;
    }
    const word = raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
    if (!word) continue;
    out.push(.../^[a-z']+$/i.test(word) ? syllablesOf(word) : [word]);
  }
  return out;
}

/** The notes' indexes in singing order: by start, the higher of a chord first. */
export function singingOrder(notes: readonly NoteEvent[]): number[] {
  return notes.map((_, i) => i).sort((a, b) => notes[a].at - notes[b].at || notes[b].pitch - notes[a].pitch || a - b);
}

/** What a note sings: its lyric, or the default syllable. */
export function sungOf(note: NoteEvent, syllable: SingSyllable = DEFAULT_SYLLABLE): string {
  return note.lyric ?? syllable;
}

const setLyric = (n: NoteEvent, lyric: string | undefined): NoteEvent => {
  const { lyric: _old, phonemes: _ph, ...rest } = n;
  return lyric ? { ...rest, lyric } : rest;
};

/** A line on the notes from note `from` (an index into notes) on, one syllable per note in singing order; an empty line
 *  clears that one note back to the default syllable. Syllables beyond the last note are joined onto it. */
export function withLyrics(notes: readonly NoteEvent[], from: number, text: string): NoteEvent[] {
  const out = notes.map((n) => ({ ...n }));
  const order = singingOrder(notes);
  const p = order.indexOf(from);
  if (p < 0) return out;
  const syllables = syllabify(text);
  if (!syllables.length) {
    out[from] = setLyric(out[from], undefined);
    return out;
  }
  const room = order.length - p;
  const fitted = syllables.length > room ? [...syllables.slice(0, room - 1), syllables.slice(room - 1).join(" ")] : syllables;
  fitted.forEach((s, k) => (out[order[p + k]] = setLyric(out[order[p + k]], s)));
  return out;
}

/** Every lyric from note `from` on moves one note later (by 1) or earlier (by -1) in singing order. Nothing is lost:
 *  forward, the last note's lyric joins the one arriving there; backward, the note before takes both. */
export function shiftLyrics(notes: readonly NoteEvent[], from: number, by: 1 | -1): NoteEvent[] {
  const out = notes.map((n) => ({ ...n }));
  const order = singingOrder(notes);
  const p = order.indexOf(from);
  if (p < 0 || (by === -1 && p === 0) || (by === 1 && p === order.length - 1)) return out;
  const lyrics = order.map((i) => notes[i].lyric);
  const next = [...lyrics];
  const join = (a?: string, b?: string) => [a, b].filter(Boolean).join(" ") || undefined;
  if (by === 1) {
    next[p] = undefined;
    for (let k = p + 1; k < order.length; k++) next[k] = lyrics[k - 1];
    next[order.length - 1] = join(lyrics[order.length - 2], lyrics[order.length - 1]);
  } else {
    next[p - 1] = join(lyrics[p - 1], lyrics[p]);
    for (let k = p; k < order.length - 1; k++) next[k] = lyrics[k + 1];
    next[order.length - 1] = undefined;
  }
  order.forEach((i, k) => {
    if (next[k] !== notes[i].lyric) out[i] = setLyric(out[i], next[k]);
  });
  return out;
}
