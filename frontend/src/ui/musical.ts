/**
 * The footer's Tempo, Meter and Snap on the agreed canvas: tempo and meter set the session's tempo (set-tempo), each in
 * a small dialog above its readout (tempo with Tap), and Snap steps Off, Grid, Beats (set-snap, which Grid and Bars
 * follow). The input meter shows only while a track is armed, so the footer holds what the canvas holds otherwise.
 */
import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

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
  pop.innerHTML = `<label class="fw-spot-label" data-for="tempo">Tempo<input type="number" class="fw-spot-input" data-m="bpm" min="20" max="300" step="0.1" aria-label="Tempo in beats a minute"> BPM</label><button type="button" class="fw-mode" data-for="tempo" data-m="tap" title="Tap four times or more in time">Tap</button><label class="fw-spot-label" data-for="meter">Beats in a bar<input type="number" class="fw-spot-input" data-m="beats" min="1" max="16" step="1" aria-label="Beats in a bar"> / 4</label>`;
  document.body.append(pop);
  const bpm = pop.querySelector<HTMLInputElement>('[data-m="bpm"]') as HTMLInputElement;
  const beats = pop.querySelector<HTMLInputElement>('[data-m="beats"]') as HTMLInputElement;
  let opener: HTMLElement | null = null;
  const close = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    opener?.setAttribute("aria-expanded", "false");
    opener = null;
  };
  const open = (button: HTMLElement, kind: string) => {
    for (const el of pop.querySelectorAll<HTMLElement>("[data-for]")) el.hidden = el.dataset.for !== kind;
    pop.setAttribute("aria-label", kind === "tempo" ? "Tempo" : "Meter");
    bpm.value = String(tempo().bpm);
    beats.value = String(tempo().beatsPerBar);
    pop.hidden = false;
    const r = button.getBoundingClientRect();
    pop.style.transform = `translate(${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)))}px, ${Math.round(r.top - 8 - pop.offsetHeight)}px)`;
    opener = button;
    button.setAttribute("aria-expanded", "true");
    (kind === "tempo" ? bpm : beats).focus();
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
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      const back = opener;
      close();
      back?.focus();
    } else if (e.key === "Enter") {
      commit();
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
    if (kind === "snap") {
      const s = engine.get("document").snap ?? { grid: false, bars: false };
      const next = !s.grid ? { grid: true, bars: false } : !s.bars ? { grid: true, bars: true } : { grid: false, bars: false };
      engine.dispatch({ type: "set-snap", ...next });
      return;
    }
    if (opener === b) close();
    else open(b, kind);
  });

  const render = () => {
    const doc = engine.get("document");
    const t = tempo();
    setText(value("tempo"), Number.isInteger(t.bpm) ? String(t.bpm) : t.bpm.toFixed(1));
    setText(value("meter"), `${t.beatsPerBar}/4`);
    const s = doc.snap;
    setText(value("snap"), !s?.grid ? "Off" : s.bars ? "Beats" : "Grid");
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
