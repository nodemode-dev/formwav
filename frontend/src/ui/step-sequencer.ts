/**
 * The comparison page's Pattern sequencer row (see HASHOUT_LOG): a grid of sixteenth-note steps, a pitch per row,
 * placed as an ordinary note clip at the playhead through the engine's note render, so the piano roll, the track's
 * instrument and exports treat it as any note clip.
 */
import type { Engine } from "../engine";
import type { MediaRef, NoteEvent } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

const STEPS = 16;
const ROWS = [72, 67, 64, 60];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

/** The pattern's notes in samples from the clip's start: each lit step a sixteenth long, repeated for each bar. */
export function patternNotes(on: boolean[][], pitches: number[], bars: number, bpm: number, rate: number, velocity = 100): NoteEvent[] {
  const step = Math.round((rate * 60) / bpm / 4);
  const notes: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < STEPS; s++) {
      on.forEach((row, r) => {
        if (row[s]) notes.push({ at: (bar * STEPS + s) * step, length: step, pitch: pitches[r], velocity });
      });
    }
  }
  return notes;
}

export function mountStepSequencer(host: HTMLElement, engine: Engine, notice: HTMLElement | null): void {
  const section = document.createElement("section");
  section.className = "fw-insp-section fw-steps";
  const rows = ROWS.map(
    (p, r) =>
      `<div class="fw-steps-row"><input type="number" min="0" max="127" step="1" value="${p}" data-steps-pitch="${r}" aria-label="Row ${r + 1} pitch" title="${noteName(p)}">${Array.from(
        { length: STEPS },
        (_, s) => `<button type="button" class="fw-step" data-row="${r}" data-step="${s}" aria-pressed="false" aria-label="Row ${r + 1}, step ${s + 1}"></button>`,
      ).join("")}</div>`,
  ).join("");
  section.innerHTML = `<div class="fw-insp-head">Step sequencer</div>
<div class="fw-steps-grid">${rows}</div>
<div class="fw-analyze-buttons"><label class="fw-sam-opt"><span>Bars</span><input type="number" min="1" max="16" step="1" value="2" data-steps-bars aria-label="Bars to repeat the pattern for"></label><button type="button" class="fw-ibtn" data-steps-act="place" title="Place the pattern as a note clip at the playhead, at the session's tempo">Place pattern</button><button type="button" class="fw-ibtn" data-steps-act="clear">Clear</button></div>`;
  host.append(section);
  const on: boolean[][] = ROWS.map(() => Array.from({ length: STEPS }, () => false));

  section.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLButtonElement>(".fw-step");
    if (cell) {
      const r = Number(cell.dataset.row);
      const s = Number(cell.dataset.step);
      on[r][s] = !on[r][s];
      cell.setAttribute("aria-pressed", String(on[r][s]));
      return;
    }
    const act = target.closest<HTMLElement>("[data-steps-act]")?.dataset.stepsAct;
    if (act === "clear") {
      on.forEach((row) => row.fill(false));
      for (const c of section.querySelectorAll<HTMLButtonElement>('.fw-step[aria-pressed="true"]')) c.setAttribute("aria-pressed", "false");
      return;
    }
    if (act !== "place") return;
    const doc = engine.get("document");
    const rate = doc.sampleRate;
    const bpm = doc.tempo?.bpm ?? 120;
    const bars = Math.min(16, Math.max(1, Math.round(Number(section.querySelector<HTMLInputElement>("[data-steps-bars]")?.value) || 1)));
    const pitches = ROWS.map((p, r) => Math.min(127, Math.max(0, Math.round(Number(section.querySelector<HTMLInputElement>(`[data-steps-pitch="${r}"]`)?.value) || p))));
    const notes = patternNotes(on, pitches, bars, bpm, rate);
    if (!notes.length) {
      if (notice) setText(notice, "Light at least one step to place a pattern");
      return;
    }
    try {
      const res = await fetch("/api/midi/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notes.map((n) => ({ start: n.at / rate, length: n.length / rate, pitch: n.pitch, velocity: n.velocity })), rate, name: "Pattern" }),
      });
      const media = (await res.json().catch(() => ({}))) as Partial<MediaRef> & { detail?: unknown };
      if (!res.ok || !media.id) throw new Error(typeof media.detail === "string" ? media.detail : `the engine answered ${res.status}`);
      engine.dispatch({ type: "import-media", media: media as MediaRef, at: engine.get("transport").positionSamples, notes });
      if (notice) setText(notice, `Placed a pattern: ${notes.length} notes over ${bars} bar${bars === 1 ? "" : "s"} at ${bpm} BPM`);
    } catch (err) {
      if (notice) setText(notice, `Could not place the pattern: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
