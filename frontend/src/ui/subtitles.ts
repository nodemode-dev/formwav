/**
 * Subtitle files from the transcript (the comparison's Captions row: "the transcript still does not export as a
 * subtitle file"). The transcript's words, in session time, become cues by the conventions most subtitle guidelines
 * share: at most 42 characters a line and two lines a cue, broken near the middle at a word; at most 7 s a cue, at
 * least 5/6 s where the next cue leaves room; a new cue at a change of speaker, at a sentence's end or at a pause of
 * 0.6 s or more. Filler words are left out. With several speakers, a cue that begins a speaker's turn begins with
 * the speaker's name.
 */
export interface SubtitleWord {
  text: string;
  /** Session samples. */
  start: number;
  end: number;
  speaker: string;
  filler: boolean;
}

export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  lines: string[];
}

export const LINE_CHARS = 42;
export const MAX_CUE_SECONDS = 7;
export const MIN_CUE_SECONDS = 5 / 6;
export const PAUSE_SECONDS = 0.6;

/** Two lines at most, broken at the word boundary nearest the middle that keeps both within the line length. */
export function balanceLines(text: string): string[] {
  if (text.length <= LINE_CHARS) return [text];
  const words = text.split(" ");
  let best: string[] | null = null;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > LINE_CHARS || b.length > LINE_CHARS) continue;
    const score = Math.abs(a.length - b.length);
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best ?? [text];
}

export function subtitleCues(all: SubtitleWord[], rate: number): Cue[] {
  const words = all.filter((w) => !w.filler && w.text.trim()).sort((a, b) => a.start - b.start);
  const several = new Set(words.map((w) => w.speaker)).size > 1;
  const cues: Cue[] = [];
  let cur: { start: number; end: number; text: string; speaker: string } | null = null;
  let lastSpeaker = "";
  const close = () => {
    if (!cur) return;
    cues.push({ start: cur.start / rate, end: cur.end / rate, lines: balanceLines(cur.text) });
    lastSpeaker = cur.speaker;
    cur = null;
  };
  for (const w of words) {
    const text = w.text.trim();
    if (cur) {
      const joined = `${cur.text} ${text}`;
      const sentenceEnded = /[.!?…]["')\]]?$/.test(cur.text);
      const paused = (w.start - cur.end) / rate >= PAUSE_SECONDS;
      const tooLong = (w.end - cur.start) / rate > MAX_CUE_SECONDS;
      const tooWide = balanceLines(joined).some((l) => l.length > LINE_CHARS) || joined.length > 2 * LINE_CHARS;
      if (w.speaker !== cur.speaker || sentenceEnded || paused || tooLong || tooWide) close();
      else {
        cur.text = joined;
        cur.end = w.end;
        continue;
      }
    }
    const named: boolean = several && w.speaker !== lastSpeaker;
    cur = { start: w.start, end: w.end, text: named ? `${w.speaker}: ${text}` : text, speaker: w.speaker };
  }
  close();
  // the shortest cues are held longer, as far as the next cue allows
  cues.forEach((c, i) => {
    if (c.end - c.start < MIN_CUE_SECONDS) c.end = Math.min(c.start + MIN_CUE_SECONDS, i + 1 < cues.length ? cues[i + 1].start : Infinity);
  });
  return cues;
}

function stamp(seconds: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, d = 2) => String(n).padStart(d, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSubRip(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.lines.join("\n")}\n`).join("\n");
}

export function toWebVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.lines.join("\n")}\n`).join("\n")}`;
}
