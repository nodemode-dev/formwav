import { HOLD, syllabify } from "./lyrics";

/**
 * Sung words onto notes (DEV_PLAN_sung_lyrics L5), pure. Each heard word (Whisper's text and times) is split into its
 * syllables (syllabify: "Twin-", "kle"), each syllable given a time spread evenly over its word, and the syllables are
 * aligned to the notes in order by dynamic programming: a syllable on a note costs the distance between their times,
 * a note left without one costs SKIP (it becomes a hold of the syllable before, a melisma, or stays empty before the
 * first), and a syllable sharing the note before costs JOIN. Whisper's times on singing run early by tenths of a
 * second, so order carries the alignment and time breaks ties.
 */
export const SKIP = 0.8;
export const SKIP_HELD = 0.25;
export const JOIN = 1.2;
/** How much a syllable's place in its phrase weighs against a note's, in notes: low, as Whisper's times on singing are
 *  uneven within a phrase too; order carries the alignment. */
export const PLACE = 0.4;
/** A rest this long ends a phrase: a breath. Shorter gaps are consonants and scoops, measured on sung lines (0.35 s
 *  of one sat inside a phrase). */
export const REST_S = 0.45;
export const SHORT_S = 0.12;

/** Notes cut into phrases at rests of REST_S or more; each word goes to the phrase whose span (widened by half a second
 *  either side, Whisper's drift) is nearest its time; within a phrase, syllables and notes are aligned by their place in
 *  the phrase (0 at its first, 1 at its last), measured in notes, which takes out Whisper's offset and stretch. */
export function assignLyrics(notes: readonly { start: number; length: number; pitch: number }[], words: readonly { text: string; start: number; end: number }[]): (string | undefined)[] {
  const out: (string | undefined)[] = notes.map(() => undefined);
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start);
  const phrases: number[][] = [];
  for (const i of order) {
    const last = phrases[phrases.length - 1];
    const prev = last ? notes[last[last.length - 1]] : null;
    if (prev && notes[i].start - (prev.start + prev.length) < REST_S) last.push(i);
    else phrases.push([i]);
  }
  const spans = phrases.map((p) => ({ a: notes[p[0]].start, b: notes[p[p.length - 1]].start + notes[p[p.length - 1]].length }));
  const owned: (typeof words[number])[][] = phrases.map(() => []);
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    let best = 0;
    spans.forEach((s, k) => {
      const d = mid < s.a ? s.a - mid : mid > s.b ? mid - s.b : 0;
      const db = mid < spans[best].a ? spans[best].a - mid : mid > spans[best].b ? mid - spans[best].b : 0;
      if (d < db) best = k;
    });
    owned[best].push(w);
  }
  phrases.forEach((p, k) => {
    const got = alignPhrase(p.map((i) => notes[i]), owned[k]);
    p.forEach((i, j) => (out[i] = got[j]));
  });
  let sung = false;
  order.forEach((i) => {
    if (out[i] && out[i] !== HOLD) sung = true;
    else if (out[i] === HOLD && !sung) out[i] = undefined;
  });
  return out;
}

function alignPhrase(notes: readonly { start: number; length: number; pitch: number }[], words: readonly { text: string; start: number; end: number }[]): (string | undefined)[] {
  const syl: { text: string; at: number }[] = [];
  for (const w of words) {
    const parts = syllabify(w.text).filter((s) => s !== HOLD);
    const span = Math.max(0, w.end - w.start);
    parts.forEach((p, k) => syl.push({ text: p, at: w.start + (span * k) / Math.max(1, parts.length) }));
  }
  const n = notes.length;
  const m = syl.length;
  const out: (string | undefined)[] = notes.map(() => undefined);
  if (!n || !m) return out;
  const place = (v: number, a: number, b: number) => (b > a ? (v - a) / (b - a) : 0);
  // the phrase's span taken from its notes long enough to carry a syllable, so a slip at either end does not stretch it
  const firm = notes.filter((x) => x.length >= SHORT_S);
  const n0 = (firm[0] ?? notes[0]).start;
  const n1 = (firm[firm.length - 1] ?? notes[n - 1]).start;
  const s0 = syl[0].at;
  const s1 = syl[m - 1].at;
  const scale = Math.max(1, n - 1);
  // a note that carries on the one before it (no gap to speak of) is most likely the same syllable held: a fragment of
  // a held note, or a melisma; leaving it without a syllable costs little there
  // so is a note too short to carry a syllable of its own (a slip between two notes, or a scoop into one)
  const skipAt = (j: number) => (notes[j].length < SHORT_S || (j > 0 && notes[j].pitch === notes[j - 1].pitch && notes[j].start - (notes[j - 1].start + notes[j - 1].length) < 0.05) ? SKIP_HELD : SKIP);
  // cost[i][j]: the best alignment of the first i syllables to the first j notes, the j-th note taking the i-th syllable
  const INF = Number.POSITIVE_INFINITY;
  const cost = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(INF));
  const move = Array.from({ length: m + 1 }, () => new Array<0 | 1 | 2>(n + 1).fill(0));
  cost[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    cost[0][j] = cost[0][j - 1] + skipAt(j - 1);
    move[0][j] = 1;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const take = cost[i - 1][j - 1] + PLACE * scale * Math.abs(place(notes[j - 1].start, n0, n1) - place(syl[i - 1].at, s0, s1));
      const skip = cost[i][j - 1] + skipAt(j - 1);
      const join = cost[i - 1][j] + JOIN;
      const best = Math.min(take, skip, join);
      cost[i][j] = best;
      move[i][j] = best === take ? 0 : best === skip ? 1 : 2;
    }
  }
  let i = m;
  let j = n;
  const given: string[][] = notes.map(() => []);
  while (i > 0 || j > 0) {
    const mv = i === 0 ? 1 : j === 0 ? 2 : move[i][j];
    if (mv === 0) {
      given[j - 1].unshift(syl[i - 1].text);
      i--;
      j--;
    } else if (mv === 1) j--;
    else {
      given[Math.max(0, j - 1)].unshift(syl[i - 1].text);
      i--;
    }
  }
  let sung = false;
  given.forEach((g, k) => {
    if (g.length) {
      out[k] = g.join(" ").replace(/- /g, "");
      sung = true;
    } else if (sung) out[k] = HOLD;
  });
  return out;
}
