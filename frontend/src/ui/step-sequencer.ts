/**
 * The comparison page's Pattern sequencer row (see HASHOUT_LOG), and L12's patterns that play: a grid of sixteenth-note
 * steps, a pitch per row (1 to 16 rows), a velocity per step (click lights a step; Shift-click cycles accent 127,
 * normal 100 and ghost 60), swing on the off-beat sixteenths (50 straight to 75; 66.7 is a triplet feel). Hear renders
 * the pattern as Place does and plays it without adding anything; Save keeps it in the session (save-pattern, one undo
 * step), where the list brings it back. Placed as an ordinary note clip at the playhead through the engine's note
 * render, so the piano roll, the track's instrument and exports treat it as any note clip.
 */
import type { Engine } from "../engine";
import { cleanSynth, DEFAULT_SYNTH, type MediaRef, type NoteEvent, type StepPattern } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

const STEPS = 16;
const DEFAULT_PITCHES = [84, 79, 76, 72, 67, 64, 60, 48];
const LEVELS = [127, 100, 60];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** The pattern's notes in samples from the clip's start: each lit step at its velocity, the off-beat sixteenths moved
 *  later by the swing (at 50 none; at 75 half a sixteenth), each note nine tenths of a sixteenth, repeated per bar. */
export function patternNotes(steps: number[][], pitches: number[], bars: number, bpm: number, rate: number, swing = 50): NoteEvent[] {
  const step = (rate * 60) / bpm / 4;
  const late = Math.round((clamp(swing, 50, 75, 50) / 100 - 0.5) * 2 * step);
  const notes: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++)
    for (let s = 0; s < STEPS; s++)
      steps.forEach((row, r) => {
        const v = row[s] ?? 0;
        if (v > 0) notes.push({ at: Math.round((bar * STEPS + s) * step) + (s % 2 ? late : 0), length: Math.round(step * 0.9), pitch: pitches[r], velocity: v });
      });
  return notes.sort((a, b) => a.at - b.at || b.pitch - a.pitch);
}

export function mountStepSequencer(host: HTMLElement, engine: Engine, notice: HTMLElement | null): void {
  const section = document.createElement("section");
  section.className = "fw-insp-section fw-steps";
  section.innerHTML = `<div class="fw-insp-head">Step sequencer</div>
<div class="fw-steps-grid"></div>
<div class="fw-analyze-buttons"><label class="fw-sam-opt"><span>Rows</span><input type="number" min="1" max="16" step="1" value="8" data-steps-rows aria-label="Rows in the pattern"></label><label class="fw-sam-opt"><span>Bars</span><input type="number" min="1" max="16" step="1" value="2" data-steps-bars aria-label="Bars to repeat the pattern for"></label><label class="fw-sam-opt"><span>Swing %</span><input type="number" min="50" max="75" step="0.5" value="50" data-steps-swing aria-label="Swing on the off-beat sixteenths, 50 straight to 75"></label></div>
<div class="fw-analyze-buttons"><button type="button" class="fw-ibtn" data-steps-act="hear" title="Render the pattern and play it, adding nothing">Hear</button><button type="button" class="fw-ibtn" data-steps-act="place" title="Place the pattern as a note clip at the playhead">Place at playhead</button><button type="button" class="fw-ibtn" data-steps-act="clear">Clear</button></div>
<div class="fw-analyze-buttons"><select data-steps-saved aria-label="Patterns kept in this session"><option value="">Patterns in this session</option></select><button type="button" class="fw-ibtn" data-steps-act="save" title="Keep this pattern in the session">Save</button><button type="button" class="fw-ibtn" data-steps-act="delete" title="Remove the chosen pattern from the session">Delete</button></div>
<p class="fw-steps-hint">Click a step to light it; Shift-click a lit step for accent, normal or ghost.</p>`;
  host.append(section);
  const grid = section.querySelector<HTMLElement>(".fw-steps-grid") as HTMLElement;
  const saved = section.querySelector<HTMLSelectElement>("[data-steps-saved]") as HTMLSelectElement;
  const num = (sel: string) => Number(section.querySelector<HTMLInputElement>(sel)?.value);
  let pitches = [...DEFAULT_PITCHES];
  let steps: number[][] = pitches.map(() => Array(STEPS).fill(0));
  let loaded = "";
  let audio: HTMLAudioElement | null = null;

  const level = (v: number) => (v >= 127 ? "hi" : v <= 60 ? "lo" : "mid");
  const draw = () => {
    grid.innerHTML = pitches
      .map((p, r) => `<div class="fw-steps-row"><input type="number" min="0" max="127" step="1" value="${p}" data-steps-pitch="${r}" aria-label="Row ${r + 1} pitch" title="${noteName(p)}">${steps[r]
        .map((v, s) => `<button type="button" class="fw-step" data-row="${r}" data-step="${s}" aria-pressed="${v > 0}"${v > 0 ? ` data-vel="${level(v)}"` : ""} aria-label="Row ${r + 1}, step ${s + 1}${v > 0 ? `, velocity ${v}` : ""}"></button>`)
        .join("")}</div>`)
      .join("");
  };
  const setRows = (n: number) => {
    n = clamp(Math.round(n), 1, 16, 8);
    while (pitches.length < n) {
      pitches.push(Math.max(0, (pitches.at(-1) ?? 60) - 5));
      steps.push(Array(STEPS).fill(0));
    }
    pitches = pitches.slice(0, n);
    steps = steps.slice(0, n);
    draw();
  };
  const listSaved = () => {
    const list = engine.get("document").patterns ?? [];
    saved.replaceChildren(new Option("Patterns in this session", ""), ...list.map((p) => new Option(p.name, p.id, false, p.id === loaded)));
  };
  const current = (): StepPattern => ({
    id: loaded || `pattern-${Date.now().toString(36)}`,
    name: (engine.get("document").patterns ?? []).find((p) => p.id === loaded)?.name ?? `Pattern ${(engine.get("document").patterns?.length ?? 0) + 1}`,
    pitches: pitches.map((p, r) => clamp(Math.round(num(`[data-steps-pitch="${r}"]`)), 0, 127, p)),
    steps: steps.map((row) => [...row]),
    bars: clamp(Math.round(num("[data-steps-bars]")), 1, 16, 2),
    swing: clamp(num("[data-steps-swing]"), 50, 75, 50),
  });
  const render = async (pat: StepPattern) => {
    const doc = engine.get("document");
    const rate = doc.sampleRate;
    const bpm = doc.tempo?.bpm ?? 120;
    const notes = patternNotes(pat.steps, pat.pitches, pat.bars, bpm, rate, pat.swing);
    if (!notes.length) throw new Error("light at least one step");
    const p = cleanSynth(doc.synth ?? DEFAULT_SYNTH);
    const patch = { wave: p.wave, attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release, gain: 0.25, cutoff: p.cutoff, resonance: p.resonance };
    const res = await fetch("/api/midi/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: notes.map((n) => ({ start: n.at / rate, length: n.length / rate, pitch: n.pitch, velocity: n.velocity })), rate, name: "Pattern", patch }),
    });
    const media = (await res.json().catch(() => ({}))) as Partial<MediaRef> & { detail?: unknown };
    if (!res.ok || !media.id) throw new Error(typeof media.detail === "string" ? media.detail : `the engine answered ${res.status}`);
    return { media: media as MediaRef, notes, bpm };
  };
  draw();
  listSaved();
  engine.subscribe("document", () => listSaved());

  section.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("[data-steps-rows]")) setRows(num("[data-steps-rows]"));
    if (t === saved) {
      const pat = (engine.get("document").patterns ?? []).find((p) => p.id === saved.value);
      if (!pat) return;
      loaded = pat.id;
      pitches = pat.pitches.map((p) => clamp(p, 0, 127, 60));
      steps = pat.steps.map((row) => Array.from({ length: STEPS }, (_, s) => clamp(row[s] ?? 0, 0, 127, 0)));
      (section.querySelector("[data-steps-rows]") as HTMLInputElement).value = String(pitches.length);
      (section.querySelector("[data-steps-bars]") as HTMLInputElement).value = String(pat.bars);
      (section.querySelector("[data-steps-swing]") as HTMLInputElement).value = String(pat.swing);
      draw();
      if (notice) setText(notice, `Loaded ${pat.name}`);
    }
  });
  section.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLButtonElement>(".fw-step");
    if (cell) {
      const r = Number(cell.dataset.row);
      const s = Number(cell.dataset.step);
      const v = steps[r][s];
      steps[r][s] = (e as MouseEvent).shiftKey && v > 0 ? LEVELS[(LEVELS.indexOf(v) + 1) % LEVELS.length] ?? 100 : v > 0 ? 0 : 100;
      const now = steps[r][s];
      cell.setAttribute("aria-pressed", String(now > 0));
      if (now > 0) cell.dataset.vel = level(now);
      else delete cell.dataset.vel;
      cell.setAttribute("aria-label", `Row ${r + 1}, step ${s + 1}${now > 0 ? `, velocity ${now}` : ""}`);
      return;
    }
    const act = target.closest<HTMLElement>("[data-steps-act]")?.dataset.stepsAct;
    if (!act) return;
    if (act === "clear") {
      steps = steps.map(() => Array(STEPS).fill(0));
      draw();
      return;
    }
    if (act === "save") {
      const pat = current();
      engine.dispatch({ type: "save-pattern", pattern: pat });
      loaded = pat.id;
      listSaved();
      if (notice) setText(notice, `Kept ${pat.name} in the session`);
      return;
    }
    if (act === "delete") {
      if (!saved.value) return void (notice && setText(notice, "Choose a pattern from the list to delete"));
      engine.dispatch({ type: "delete-pattern", id: saved.value });
      if (loaded === saved.value) loaded = "";
      listSaved();
      return;
    }
    const button = target.closest<HTMLButtonElement>("button");
    if (act === "hear" && audio) {
      audio.pause();
      audio = null;
      if (button) button.textContent = "Hear";
      return;
    }
    try {
      const { media, notes, bpm } = await render(current());
      if (act === "hear") {
        audio = new Audio(`/api/media/${media.id}/audio`);
        if (button) button.textContent = "Stop";
        audio.addEventListener("ended", () => {
          audio = null;
          if (button) button.textContent = "Hear";
        });
        await audio.play();
        return;
      }
      const bars = clamp(Math.round(num("[data-steps-bars]")), 1, 16, 2);
      engine.dispatch({ type: "import-media", media, at: engine.get("transport").positionSamples, notes });
      if (notice) setText(notice, `Placed a pattern: ${notes.length} notes over ${bars} bar${bars === 1 ? "" : "s"} at ${bpm} BPM`);
    } catch (err) {
      if (button && act === "hear") button.textContent = "Hear";
      if (notice) setText(notice, `Could not ${act === "hear" ? "play" : "place"} the pattern: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
