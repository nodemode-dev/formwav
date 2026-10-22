import type { NoteEvent } from "./document";
import { HOLD, singingOrder } from "./lyrics";

/**
 * Pronunciation of sung lyrics (DEV_PLAN_sung_lyrics L2), pure: lyrics grouped into words (a syllable ending in "-"
 * runs on into the next note's), a word's ARPAbet phonemes split across its notes, and the duration split that places
 * each phoneme in time: a syllable's leading consonants before its note starts, its vowel from the note's start, its
 * closing consonants at the note's end. The consonant lengths are formwav's defaults, by class, scaled down to fit.
 */
export const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
export const CONSONANT_CLASS: Record<string, "stop" | "affricate" | "fricative" | "aspirate" | "nasal" | "liquid" | "semivowel"> = {
  B: "stop", D: "stop", G: "stop", K: "stop", P: "stop", T: "stop", CH: "affricate", JH: "affricate",
  DH: "fricative", F: "fricative", S: "fricative", SH: "fricative", TH: "fricative", V: "fricative", Z: "fricative", ZH: "fricative",
  HH: "aspirate", M: "nasal", N: "nasal", NG: "nasal", L: "liquid", R: "liquid", W: "semivowel", Y: "semivowel",
};
export const CONSONANT_MS = { stop: 50, affricate: 70, fricative: 80, aspirate: 50, nasal: 60, liquid: 55, semivowel: 45 } as const;
/** The most of the note before a syllable that its leading consonants may take, and of its own note its closing ones. */
export const ONSET_SHARE = 0.5;
export const CODA_SHARE = 0.3;

const ONSETS = new Set([
  "P R", "B R", "T R", "D R", "K R", "G R", "F R", "TH R", "SH R", "P L", "B L", "K L", "G L", "F L", "S L",
  "T W", "D W", "K W", "G W", "TH W", "S W", "S P", "S T", "S K", "S M", "S N", "S F", "S P R", "S T R", "S K R", "S P L", "S K W",
]);

export const isVowel = (p: string) => VOWELS.has(p.replace(/[012]$/, ""));
export const isPhoneme = (p: string) => VOWELS.has(p.replace(/[012]$/, "")) || (p in CONSONANT_CLASS);
const validOnset = (cluster: string[]) => cluster.length <= 1 ? cluster[0] !== "NG" && cluster[0] !== "ZH" : ONSETS.has(cluster.join(" "));

/** Phonemes typed by hand: upper-cased, split on spaces, commas or hyphens; null when any is not ARPAbet. */
export function parsePhonemes(text: string): string[] | null {
  const list = text.trim().toUpperCase().split(/[\s,\-]+/).filter(Boolean);
  return list.every(isPhoneme) ? list : null;
}

/** A word as the dictionary is asked for it: letters, digits and apostrophes, lower case. */
export const wordKey = (text: string) => text.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}']/gu, "");

/** The notes' words in singing order: each with the note indexes it spans; a hold ("-") belongs to no word. */
export function lyricWords(notes: readonly NoteEvent[], syllable: string): { word: string; notes: number[] }[] {
  const out: { word: string; notes: number[] }[] = [];
  let open: { word: string; notes: number[] } | null = null;
  for (const i of singingOrder(notes)) {
    const text = notes[i].lyric ?? syllable;
    if (text === HOLD) continue;
    // several words on one note (a line longer than its notes) are each a word of their own, sung in turn
    const tokens = text.split(/\s+/).filter(Boolean);
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k];
      const runsOn = k === tokens.length - 1 && token.endsWith("-");
      const part = runsOn ? token.slice(0, -1) : token;
      if (open) {
        open.word += part;
        if (!open.notes.includes(i)) open.notes.push(i);
      } else open = { word: part, notes: [i] };
      if (!runsOn) {
        out.push({ ...open, word: wordKey(open.word) });
        open = null;
      }
    }
  }
  if (open) out.push({ ...open, word: wordKey(open.word) });
  return out;
}

/** A word's phonemes over `count` notes: one vowel a note, the consonants between two vowels split so the later
 *  syllable takes the longest onset English allows; more notes than vowels leaves the last ones empty (held), fewer
 *  puts the rest of the word on the last note. */
export function splitWord(phones: readonly string[], count: number): string[][] {
  if (count <= 1) return [[...phones]];
  const vowels = phones.map((p, i) => (isVowel(p) ? i : -1)).filter((i) => i >= 0);
  const groups = Math.min(count, vowels.length);
  if (groups <= 1) return [[...phones], ...Array.from({ length: count - 1 }, () => [])];
  const cuts: number[] = [];
  for (let g = 1; g < groups; g++) {
    const from = vowels[g - 1] + 1;
    const to = vowels[g];
    let cut = to;
    for (let k = from; k <= to; k++) if (validOnset(phones.slice(k, to) as string[]) || k === to) {
      cut = k;
      break;
    }
    cuts.push(cut);
  }
  const out: string[][] = [];
  let last = 0;
  for (const c of cuts) {
    out.push(phones.slice(last, c) as string[]);
    last = c;
  }
  out.push(phones.slice(last) as string[]);
  while (out.length < count) out.push([]);
  return out;
}

/** Each note's phonemes: its own when edited, else its share of its word's; null where the word is not known yet. A
 *  hold note is an empty list (it sings on the vowel before it). */
export function notePhonemes(notes: readonly NoteEvent[], syllable: string, lookup: (word: string) => readonly string[] | undefined): (string[] | null)[] {
  const out: (string[] | null)[] = notes.map((n) => (n.lyric === HOLD ? [] : null));
  const unknown = new Set<number>();
  const seen = new Set<number>();
  for (const w of lyricWords(notes, syllable)) {
    const phones = lookup(w.word);
    const parts = phones ? splitWord(phones, w.notes.length) : null;
    w.notes.forEach((i, k) => {
      if (!parts) unknown.add(i);
      out[i] = seen.has(i) ? [...(out[i] ?? []), ...(parts?.[k] ?? [])] : (parts?.[k] ?? null);
      seen.add(i);
    });
  }
  for (const i of unknown) out[i] = null;
  notes.forEach((n, i) => {
    if (n.phonemes?.length) out[i] = [...n.phonemes];
  });
  return out;
}

export type Piece = { phoneme: string; at: number; length: number };

const msOf = (p: string) => (isVowel(p) ? 0 : CONSONANT_MS[CONSONANT_CLASS[p] ?? "stop"]);

/** Each note's phonemes placed in frames: the leading consonants end at the note's start, taking at most ONSET_SHARE
 *  of the note before it (or the rest before it); what does not fit before goes into the note's start, up to
 *  CODA_SHARE of it, the vowel starting after it (the first note of a clip at 0 has no room before it); the vowel (and any later vowels, shared equally) runs from the
 *  note's start; the closing consonants end where the note ends or the next syllable's consonants begin, taking at most
 *  CODA_SHARE of the note. Lengths are scaled down together, never below a frame. */
export function durationSplit(notes: readonly NoteEvent[], phonemes: readonly (readonly string[] | null)[], rate: number): Piece[][] {
  const order = singingOrder(notes);
  const out: Piece[][] = notes.map(() => []);
  const onsetStart = new Map<number, number>();
  const vowelStart = new Map<number, number>();
  const parts = notes.map((_, i) => {
    const ph = phonemes[i] ?? [];
    const first = ph.findIndex(isVowel);
    const lastV = ph.length - 1 - [...ph].reverse().findIndex(isVowel);
    return first < 0 ? { onset: [...ph], nucleus: [] as string[], coda: [] as string[] } : { onset: ph.slice(0, first), nucleus: ph.slice(first, lastV + 1), coda: ph.slice(lastV + 1) };
  });
  order.forEach((i, k) => {
    const n = notes[i];
    const prev = k > 0 ? notes[order[k - 1]] : null;
    const room = Math.max(0, prev ? Math.min(n.at - prev.at, prev.at + prev.length >= n.at ? prev.length * ONSET_SHARE : n.at - (prev.at + prev.length)) : n.at);
    const want = parts[i].onset.map((p) => (msOf(p) * rate) / 1000);
    const total = want.reduce((a, b) => a + b, 0);
    const before = Math.min(room, total);
    const inside = Math.min(total - before, n.length * CODA_SHARE);
    const scale = total > 0 ? (before + inside) / total : 1;
    vowelStart.set(i, Math.round(n.at + inside));
    let t = n.at - before;
    onsetStart.set(i, Math.round(t));
    for (let j = 0; j < want.length; j++) {
      const length = Math.max(1, Math.round(want[j] * scale));
      out[i].push({ phoneme: parts[i].onset[j], at: Math.round(t), length });
      t += want[j] * scale;
    }
  });
  order.forEach((i, k) => {
    const n = notes[i];
    const next = k < order.length - 1 ? order[k + 1] : -1;
    let end = n.at + n.length;
    if (next >= 0 && notes[next].at <= end + 1) end = Math.min(end, onsetStart.get(next) ?? end);
    end = Math.max(n.at + 1, end);
    const want = parts[i].coda.map((p) => (msOf(p) * rate) / 1000);
    const total = want.reduce((a, b) => a + b, 0);
    const from = vowelStart.get(i) ?? n.at;
    const cap = (end - from) * CODA_SHARE;
    const scale = total > cap ? cap / total : 1;
    const codaStart = end - total * scale;
    const nucleus = parts[i].nucleus;
    const each = (codaStart - from) / Math.max(1, nucleus.length);
    nucleus.forEach((p, j) => out[i].push({ phoneme: p, at: Math.round(from + j * each), length: Math.max(1, Math.round(each)) }));
    let t = codaStart;
    for (let j = 0; j < want.length; j++) {
      out[i].push({ phoneme: parts[i].coda[j], at: Math.round(t), length: Math.max(1, Math.round(want[j] * scale)) });
      t += want[j] * scale;
    }
  });
  return out;
}
