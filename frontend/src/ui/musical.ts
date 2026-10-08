/**
 * The footer's Tempo, Meter and Snap on the agreed canvas: tempo and meter set the session's tempo (set-tempo), each in
 * a small dialog above its readout (tempo with Tap and Identify Beat), and Snap's sets Off, Grid or Beats, the grid's
 * value and the nudge's (set-snap, which Grid and Bars follow). The input meter shows only while a track is armed, so
 * the footer holds what the canvas holds otherwise.
 */
import type { Engine } from "../engine";
import { editSpan, identifyBeat, type EditRange } from "../engine/editing";
import { GRID_CHOICES, gridShort, NUDGE_DEFAULT } from "../engine/grid";
import { setText } from "../vendor/nodemode/dom-stable";

/** S5: the grid and nudge values as a select's option groups. */
const choices = (first: string) => {
  const groups = [...new Set(GRID_CHOICES.map((c) => c.group))];
  return `${first}${groups.map((g) => `<optgroup label="${g}">${GRID_CHOICES.filter((c) => c.group === g).map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}</optgroup>`).join("")}`;
};

export function mountMusical(host: HTMLElement, engine: Engine): void {
  const bar = host.querySelector<HTMLElement>(".fw-musical");
  const status = host.querySelector<HTMLElement>(".fw-status");
  if (!bar || !status) return;
  const value = (name: string) => bar.querySelector<HTMLElement>(`[data-mus-value="${name}"]`);
  const tempo = () => engine.get("document").tempo ?? { bpm: 120, beatsPerBar: 4 };

  const pop = document.createElement("div");
  pop.className = "fw-norm fw-mus-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.innerHTML = `<label class="fw-spot-label" data-for="tempo">Tempo<input type="number" class="fw-spot-input" data-m="bpm" min="20" max="300" step="0.1" aria-label="Tempo in beats a minute"> BPM</label><button type="button" class="fw-mode" data-for="tempo" data-m="tap" title="Tap four times or more in time">Tap</button><label class="fw-spot-label" data-for="tempo" title="Identify Beat: how many bars the selection lasts">Selection<input type="number" class="fw-spot-input" data-m="bars" min="0.25" max="64" step="0.25" value="1" aria-label="Bars the selection lasts"> bars</label><button type="button" class="fw-mode" data-for="tempo" data-m="identify" title="Set the tempo so the selected range, the selected clips or the loop lasts that many bars">Identify</button><label class="fw-spot-label" data-for="meter">Beats in a bar<input type="number" class="fw-spot-input" data-m="beats" min="1" max="16" step="1" aria-label="Beats in a bar"> / 4</label><label class="fw-spot-label" data-for="snap">Snap<select class="fw-spot-input" data-m="snap" aria-label="What moves and trims snap to"><option value="off">Off</option><option value="grid">Grid</option><option value="beats">Beats</option></select></label><label class="fw-spot-label" data-for="snap" title="The grid moves and trims snap to, and Separate on the grid cuts on">Grid<select class="fw-spot-input" data-m="grid" aria-label="Grid value">${choices('<option value="">Follows the zoom</option>')}</select></label><label class="fw-spot-label" data-for="snap" title="How far a nudge moves the selected clips or the range (the comma and the full stop, or the keypad's minus and plus)">Nudge<select class="fw-spot-input" data-m="nudge" aria-label="Nudge value">${choices("")}</select></label>`;
  document.body.append(pop);
  const bpm = pop.querySelector<HTMLInputElement>('[data-m="bpm"]') as HTMLInputElement;
  const beats = pop.querySelector<HTMLInputElement>('[data-m="beats"]') as HTMLInputElement;
  const snapMode = pop.querySelector<HTMLSelectElement>('[data-m="snap"]') as HTMLSelectElement;
  const gridValue = pop.querySelector<HTMLSelectElement>('[data-m="grid"]') as HTMLSelectElement;
  const nudgeValue = pop.querySelector<HTMLSelectElement>('[data-m="nudge"]') as HTMLSelectElement;
  // S5: Snap's dialog sets the snap, the grid value (choosing one turns the grid on) and the nudge value (set-snap)
  const setSnap = (change: { grid?: boolean; bars?: boolean; value?: string; nudge?: string }) => {
    const s = engine.get("document").snap ?? { grid: false, bars: false };
    engine.dispatch({ type: "set-snap", grid: change.grid ?? s.grid, bars: change.bars ?? s.bars, ...(change.value !== undefined ? { value: change.value } : {}), ...(change.nudge !== undefined ? { nudge: change.nudge } : {}) });
  };
  snapMode.addEventListener("change", () => setSnap({ grid: snapMode.value !== "off", bars: snapMode.value === "beats" }));
  gridValue.addEventListener("change", () => {
    setSnap({ value: gridValue.value, ...(gridValue.value ? { grid: true } : {}) });
    snapMode.value = !engine.get("document").snap?.grid ? "off" : engine.get("document").snap?.bars ? "beats" : "grid";
  });
  nudgeValue.addEventListener("change", () => setSnap({ nudge: nudgeValue.value }));
  let opener: HTMLElement | null = null;
  const close = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    opener?.setAttribute("aria-expanded", "false");
    opener = null;
  };
  const open = (button: HTMLElement, kind: string) => {
    for (const el of pop.querySelectorAll<HTMLElement>("[data-for]")) el.hidden = el.dataset.for !== kind;
    pop.setAttribute("aria-label", kind === "tempo" ? "Tempo" : kind === "snap" ? "Snap, grid and nudge" : "Meter");
    bpm.value = String(tempo().bpm);
    beats.value = String(tempo().beatsPerBar);
    const s = engine.get("document").snap;
    snapMode.value = !s?.grid ? "off" : s.bars ? "beats" : "grid";
    gridValue.value = s?.value ?? "";
    nudgeValue.value = s?.nudge ?? NUDGE_DEFAULT;
    pop.hidden = false;
    const r = button.getBoundingClientRect();
    pop.style.transform = `translate(${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)))}px, ${Math.round(r.top - 8 - pop.offsetHeight)}px)`;
    opener = button;
    button.setAttribute("aria-expanded", "true");
    (kind === "tempo" ? bpm : kind === "snap" ? snapMode : beats).focus();
  };
  const commit = () => {
    const b = Number(bpm.value);
    const n = Number(beats.value);
    if (Number.isFinite(b) && Number.isFinite(n)) engine.dispatch({ type: "set-tempo", bpm: Math.min(300, Math.max(20, b)), beatsPerBar: Math.round(Math.min(16, Math.max(1, n))) });
  };
  bpm.addEventListener("change", commit);
  beats.addEventListener("change", commit);
  let taps: number[] = [];
  pop.querySelector('[data-m="tap"]')?.addEventListener("click", () => {
    const now = performance.now();
    taps = [...taps.filter((t) => now - t < 3000), now].slice(-8);
    if (taps.length < 4) return;
    const gap = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    bpm.value = (60000 / gap).toFixed(1);
    commit();
  });
  // S4, Identify Beat: the tempo at which the selection (a range, the selected clips, else the loop) lasts the bars typed
  let range: EditRange | null = null;
  let picked: readonly string[] = [];
  host.addEventListener("fw-range", (e) => {
    const d = (e as CustomEvent<EditRange | null>).detail;
    range = d ? { trackId: d.trackId, start: d.start, end: d.end } : null;
  });
  host.addEventListener("fw-selection", (e) => {
    picked = (e as CustomEvent<string[]>).detail ?? [];
  });
  const bars = pop.querySelector<HTMLInputElement>('[data-m="bars"]') as HTMLInputElement;
  pop.querySelector('[data-m="identify"]')?.addEventListener("click", () => {
    const doc = engine.get("document");
    const loop = doc.loop && doc.loop.end > doc.loop.start ? doc.loop : null;
    const span = editSpan(doc, { range, clipIds: picked }) ?? loop;
    const n = Number(bars.value);
    const found = span ? identifyBeat(span.end - span.start, doc.sampleRate, n, tempo().beatsPerBar) : null;
    const notice = host.querySelector<HTMLElement>(".fw-notice");
    if (found === null || found < 30 || found > 300) {
      setText(notice, !span ? "Select a range, clips or the loop to identify the beat from" : found === null ? "Type how many bars the selection lasts" : `${found.toFixed(1)} BPM is outside 30 to 300`);
      return;
    }
    bpm.value = found.toFixed(1);
    commit();
    setText(notice, `Tempo ${found.toFixed(1)} BPM: the selection lasts ${n} bar${n === 1 ? "" : "s"} of ${tempo().beatsPerBar}`);
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      const back = opener;
      close();
      back?.focus();
    } else if (e.key === "Enter") {
      if (opener?.dataset.mus !== "snap") commit();
      close();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (!pop.hidden && !pop.contains(t) && !opener?.contains(t)) close();
  });

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mus]");
    const kind = b?.dataset.mus;
    if (!b || !kind) return;
    if (opener === b) close();
    else open(b, kind);
  });

  const render = () => {
    const doc = engine.get("document");
    const t = tempo();
    setText(value("tempo"), Number.isInteger(t.bpm) ? String(t.bpm) : t.bpm.toFixed(1));
    setText(value("meter"), `${t.beatsPerBar}/4`);
    const s = doc.snap;
    setText(value("snap"), !s?.grid ? "Off" : s.value ? gridShort(s.value) : s.bars ? "Beats" : "Grid");
  };
  engine.subscribe("document", render);
  render();

  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  const armed = () => {
    const on = !!lanes?.querySelector('.fw-arm[aria-pressed="true"]');
    if (status.classList.contains("is-armed") !== on) status.classList.toggle("is-armed", on);
  };
  if (lanes) new MutationObserver(armed).observe(lanes, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"], childList: true });
  armed();
}
