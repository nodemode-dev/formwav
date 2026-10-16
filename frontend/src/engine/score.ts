import type { SessionDoc } from "./document";
import { noteTracks, trackEvents } from "./smf";

export interface ScoreItem {
  rest: boolean;
  pitches: number[];
  /** sixteenths */
  at: number;
  dur: number;
  tieStart: boolean;
  tieStop: boolean;
}
export interface ScorePart {
  name: string;
  clef: "G" | "F";
  measures: ScoreItem[][];
}
export interface Score {
  title: string;
  bpm: number;
  beats: number;
  measures: number;
  parts: ScorePart[];
}

const UNITS = [16, 12, 8, 6, 4, 3, 2, 1];
const TYPE: Record<number, [string, boolean]> = { 16: ["whole", false], 12: ["half", true], 8: ["half", false], 6: ["quarter", true], 4: ["quarter", false], 3: ["eighth", true], 2: ["eighth", false], 1: ["16th", false] };
const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
const DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

const split = (dur: number) => {
  const out: number[] = [];
  let left = dur;
  for (const u of UNITS) while (left >= u) {
    out.push(u);
    left -= u;
  }
  return out;
};

/** S8: the session's note tracks laid out on a sixteenth-note grid at its tempo and meter (quarter-note beats): one
 *  voice per part, notes starting together a chord held until the next starts, gaps as rests, values split into whole
 *  to sixteenth (dotted where they fit) and tied across bar lines; a part's clef by its middle pitch. Sharps only and
 *  no key signature: a readable score of what was played, not an engraving. */
export function layout(doc: SessionDoc, title = "formwav session"): Score {
  const bpm = doc.tempo?.bpm ?? 120;
  const beats = Math.max(1, Math.round(doc.tempo?.beatsPerBar ?? 4));
  const bar = beats * 4;
  const sixteenth = (frames: number) => Math.round((frames / doc.sampleRate) * (bpm / 60) * 4);
  const tracks = noteTracks(doc);
  const raw = tracks.map((t) => trackEvents(doc, t).notes.map((n) => ({ at: sixteenth(n.at), len: Math.max(1, sixteenth(n.at + n.length) - sixteenth(n.at)), pitch: n.pitch })));
  const end = Math.max(1, ...raw.flat().map((n) => n.at + n.len));
  const measures = Math.max(1, Math.ceil(end / bar));
  const parts = tracks.map((t, p) => {
    const notes = raw[p];
    const starts = [...new Set(notes.map((n) => n.at))].sort((a, b) => a - b);
    const events: { at: number; dur: number; pitches: number[] }[] = [];
    starts.forEach((s, i) => {
      const group = notes.filter((n) => n.at === s);
      const next = starts[i + 1] ?? Infinity;
      events.push({ at: s, dur: Math.max(1, Math.min(Math.max(...group.map((n) => n.len)), next - s)), pitches: [...new Set(group.map((n) => n.pitch))].sort((a, b) => a - b) });
    });
    const items: ScoreItem[][] = Array.from({ length: measures }, () => []);
    const place = (at: number, dur: number, pitches: number[]) => {
      let pos = at;
      let left = dur;
      while (left > 0) {
        const m = Math.floor(pos / bar);
        const inBar = Math.min(left, (m + 1) * bar - pos);
        for (const u of split(inBar)) {
          items[m].push({ rest: !pitches.length, pitches, at: pos - m * bar, dur: u, tieStart: false, tieStop: false });
          pos += u;
        }
        left -= inBar;
      }
    };
    let cursor = 0;
    for (const e of events) {
      if (e.at > cursor) place(cursor, e.at - cursor, []);
      const before = items.flat().length;
      place(e.at, e.dur, e.pitches);
      const pieces = items.flat().slice(before);
      pieces.forEach((it, k) => {
        it.tieStart = k < pieces.length - 1;
        it.tieStop = k > 0;
      });
      cursor = e.at + e.dur;
    }
    if (cursor < measures * bar) place(cursor, measures * bar - cursor, []);
    for (const m of items) m.sort((a, b) => a.at - b.at);
    const all = notes.map((n) => n.pitch).sort((a, b) => a - b);
    const middle = all.length ? all[Math.floor(all.length / 2)] : 60;
    return { name: t.name, clef: middle >= 57 ? ("G" as const) : ("F" as const), measures: items };
  });
  return { title, bpm, beats, measures, parts };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The layout as MusicXML 4.0 partwise (divisions 4, a sixteenth each): a part per note track, its clef, the meter and
 *  tempo in the first measure, chords, rests, ties and dots. */
export function musicXml(score: Score): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${esc(score.title)}</work-title></work>`,
    "  <identification><encoding><software>formwav</software></encoding></identification>",
    "  <part-list>",
    ...score.parts.map((p, i) => `    <score-part id="P${i + 1}"><part-name>${esc(p.name)}</part-name></score-part>`),
    "  </part-list>",
  ];
  score.parts.forEach((p, i) => {
    out.push(`  <part id="P${i + 1}">`);
    p.measures.forEach((items, m) => {
      out.push(`    <measure number="${m + 1}">`);
      if (m === 0) {
        out.push(`      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>${score.beats}</beats><beat-type>4</beat-type></time><clef><sign>${p.clef}</sign><line>${p.clef === "G" ? 2 : 4}</line></clef></attributes>`);
        out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(score.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(score.bpm * 100) / 100}"/></direction>`);
      }
      const whole = items.length > 0 && items.every((it) => it.rest);
      if (whole) {
        out.push(`      <note><rest measure="yes"/><duration>${score.beats * 4}</duration><voice>1</voice></note>`);
      } else {
        for (const it of items) {
          const [type, dotted] = TYPE[it.dur];
          const tail = `<voice>1</voice><type>${type}</type>${dotted ? "<dot/>" : ""}`;
          if (it.rest) {
            out.push(`      <note><rest/><duration>${it.dur}</duration>${tail}</note>`);
            continue;
          }
          it.pitches.forEach((pitch, k) => {
            const step = STEPS[pitch % 12];
            const alter = SHARP[pitch % 12] ? "<alter>1</alter>" : "";
            const ties = `${it.tieStop ? '<tie type="stop"/>' : ""}${it.tieStart ? '<tie type="start"/>' : ""}`;
            const tied = it.tieStop || it.tieStart ? `<notations>${it.tieStop ? '<tied type="stop"/>' : ""}${it.tieStart ? '<tied type="start"/>' : ""}</notations>` : "";
            const accidental = SHARP[pitch % 12] ? "<accidental>sharp</accidental>" : "";
            out.push(`      <note>${k > 0 ? "<chord/>" : ""}<pitch><step>${step}</step>${alter}<octave>${Math.floor(pitch / 12) - 1}</octave></pitch><duration>${it.dur}</duration>${ties}${tail}${accidental}${tied}</note>`);
          });
        }
      }
      if (m === p.measures.length - 1) out.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      out.push("    </measure>");
    });
    out.push("  </part>");
  });
  out.push("</score-partwise>", "");
  return out.join("\n");
}

/** The layout drawn as a printable SVG score: systems of `barsPerSystem` bars, a five-line staff per part, the clef
 *  letter, the meter, note heads (open from a half up), stems, flags, dots, sharps, ledger lines, ties and rests. Its
 *  root carries data-measures and data-heads (the note heads drawn). */
export function scoreSvg(score: Score, barsPerSystem = 4, width = 820): string {
  const left = 70;
  const gap = 8;
  const staffH = gap * 4;
  const partGap = 70;
  const systemH = score.parts.length * (staffH + partGap) + 20;
  const systems = Math.ceil(score.measures / barsPerSystem);
  const top = 90;
  const height = top + systems * systemH + 30;
  const barW = (width - left - 20) / barsPerSystem;
  const bar = score.beats * 4;
  const out: string[] = [];
  let heads = 0;
  out.push(`<text x="${width / 2}" y="34" text-anchor="middle" font-size="20" font-weight="700">${esc(score.title)}</text>`);
  out.push(`<text x="${left}" y="64" font-size="12">♩ = ${Math.round(score.bpm)}</text>`);
  for (let s = 0; s < systems; s++) {
    const y0 = top + s * systemH;
    score.parts.forEach((p, pi) => {
      const sy = y0 + pi * (staffH + partGap);
      const bottom = sy + staffH;
      const bottomDia = p.clef === "G" ? 4 * 7 + 2 : 2 * 7 + 4;
      for (let l = 0; l < 5; l++) out.push(`<line x1="${left}" y1="${sy + l * gap}" x2="${width - 20}" y2="${sy + l * gap}" stroke="#000" stroke-width="1"/>`);
      out.push(`<text x="${left - 8}" y="${sy - 8}" text-anchor="end" font-size="11">${s === 0 ? esc(p.name) : ""}</text>`);
      out.push(`<text x="${left + 4}" y="${p.clef === "G" ? sy + 3 * gap + 4 : sy + gap + 4}" font-size="18" font-family="serif" font-weight="700">${p.clef}</text>`);
      if (s === 0) {
        out.push(`<text x="${left + 22}" y="${sy + gap * 2 - 1}" font-size="15" font-weight="700" font-family="serif">${score.beats}</text>`);
        out.push(`<text x="${left + 22}" y="${sy + gap * 4 - 1}" font-size="15" font-weight="700" font-family="serif">4</text>`);
      }
      out.push(`<line x1="${left}" y1="${sy}" x2="${left}" y2="${bottom}" stroke="#000"/>`);
      for (let b = 0; b < barsPerSystem; b++) {
        const m = s * barsPerSystem + b;
        if (m >= score.measures) break;
        const x0 = left + b * barW;
        const inner = x0 + (b === 0 ? 40 : 12);
        const span = x0 + barW - inner - 10;
        const xb = x0 + barW;
        out.push(`<line x1="${xb}" y1="${sy}" x2="${xb}" y2="${bottom}" stroke="#000" stroke-width="${m === score.measures - 1 ? 3 : 1}"/>`);
        for (const it of p.measures[m]) {
          const x = inner + (it.at / bar) * span;
          if (it.rest) {
            const my = sy + gap * 2;
            if (it.dur >= 8) out.push(`<rect x="${x}" y="${it.dur >= 16 ? sy + gap : my - 4}" width="10" height="4" fill="#000"/>`);
            else if (it.dur >= 4) out.push(`<path d="M${x + 2} ${my - 9} l5 6 l-5 5 l5 6" stroke="#000" stroke-width="2" fill="none"/>`);
            else out.push(`<circle cx="${x + 3}" cy="${my - 2}" r="2.2" fill="#000"/><path d="M${x + 3} ${my - 2} l5 -2 l-4 ${it.dur === 1 ? 14 : 10}" stroke="#000" stroke-width="1.4" fill="none"/>`);
            continue;
          }
          const ys = it.pitches.map((pitch) => bottom - ((Math.floor(pitch / 12) - 1) * 7 + DIATONIC[pitch % 12] - bottomDia) * (gap / 2));
          for (const [k, pitch] of it.pitches.entries()) {
            const y = ys[k];
            for (let ly = bottom + gap; ly <= y + 0.1; ly += gap) out.push(`<line x1="${x - 8}" y1="${ly}" x2="${x + 8}" y2="${ly}" stroke="#000"/>`);
            for (let ly = sy - gap; ly >= y - 0.1; ly -= gap) out.push(`<line x1="${x - 8}" y1="${ly}" x2="${x + 8}" y2="${ly}" stroke="#000"/>`);
            const open = it.dur >= 8;
            out.push(`<ellipse class="head" cx="${x}" cy="${y}" rx="5" ry="3.6" transform="rotate(-20 ${x} ${y})" fill="${open ? "#fff" : "#000"}" stroke="#000" stroke-width="1.3"/>`);
            heads++;
            if (SHARP[pitch % 12]) out.push(`<text x="${x - 15}" y="${y + 4}" font-size="12" font-family="serif">♯</text>`);
            if (TYPE[it.dur][1]) out.push(`<circle cx="${x + 9}" cy="${y - 1}" r="1.6" fill="#000"/>`);
            if (it.tieStart) out.push(`<path d="M${x + 4} ${y + 5} q10 7 20 0" stroke="#000" fill="none"/>`);
          }
          if (it.dur < 16) {
            const lowest = Math.max(...ys);
            const highest = Math.min(...ys);
            const up = (lowest + highest) / 2 > sy + gap * 2;
            const sx = up ? x + 4.6 : x - 4.6;
            const y1 = up ? lowest : highest;
            const y2 = up ? highest - 28 : lowest + 28;
            out.push(`<line x1="${sx}" y1="${y1}" x2="${sx}" y2="${y2}" stroke="#000" stroke-width="1.2"/>`);
            const flags = it.dur <= 1 ? 2 : it.dur <= 3 ? 1 : 0;
            for (let f = 0; f < flags; f++) {
              const fy = y2 + (up ? f * 6 : -f * 6);
              out.push(`<path d="M${sx} ${fy} q7 ${up ? 6 : -6} 6 ${up ? 14 : -14}" stroke="#000" stroke-width="1.4" fill="none"/>`);
            }
          }
        }
      }
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-measures="${score.measures}" data-heads="${heads}" font-family="Inter, sans-serif"><rect width="100%" height="100%" fill="#fff"/>${out.join("")}</svg>`;
}
