import { icon as fcIcon } from "../vendor/formcut/icons";
import type { Engine } from "../engine";

const LABEL_SPACING_PX = 80;
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

let enabled = false;
let shuffle = false;
let spot = false;
let punch = false;

export function shuffleEnabled(): boolean {
  return shuffle;
}

export function spotEnabled(): boolean {
  return spot;
}

export function punchEnabled(): boolean {
  return punch;
}

export function labelStep(pxPerSecond: number): number {
  return STEPS.find((s) => s * pxPerSecond >= LABEL_SPACING_PX) ?? STEPS[STEPS.length - 1];
}

export function gridEnabled(): boolean {
  return enabled;
}

let bars = false;
let beatSeconds: number | null = null;

/** Whether the ruler shows bars and beats (and the grid snaps to beats) rather than seconds. */
export function barsEnabled(): boolean {
  return bars;
}

/** The session's beat length in seconds while Bars is on and a tempo is set (the ruler keeps it current), else null. */
export function setBeatGrid(seconds: number | null): void {
  beatSeconds = seconds && seconds > 0 ? seconds : null;
}

export function snapSamples(position: number, sampleRate: number, pxPerSecond: number): number {
  if (!enabled) return position;
  if (bars && beatSeconds) {
    // Beats halved or doubled by powers of two until a step is at least 12 px wide, down to a sixteenth of a beat.
    let step = beatSeconds;
    while (step * pxPerSecond < 12) step *= 2;
    while (step / 2 >= beatSeconds / 16 && (step / 2) * pxPerSecond >= 12) step /= 2;
    const samples = step * sampleRate;
    return Math.max(0, Math.round(Math.round(position / samples) * samples));
  }
  const step = (labelStep(pxPerSecond) / 5) * sampleRate;
  return Math.max(0, Math.round(Math.round(position / step) * step));
}

export function mountGrid(host: HTMLElement, engine?: Engine): void {
  const transport = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="edit"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray") ?? host.querySelector<HTMLElement>(".fw-transport");
  const makeButton = (label: string, title: string, glyph: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fw-mode";
    button.innerHTML = `${fcIcon(glyph)}<span>${label}</span>`;
    button.title = title;
    button.setAttribute("aria-pressed", "false");
    transport?.append(button);
    return button;
  };
  const gridButton = makeButton("Grid", "Snap moves and trims to the ruler's ticks (G)", "grid3");
  const shuffleButton = makeButton("Shuffle", "Deleting and trimming clips moves the later clips on the track to close the gap (H)", "shuffle");
  const spotButton = makeButton("Spot", "Click a clip to type its exact start time (T)", "crosshair");
  const punchButton = makeButton("Punch", "Recording on the armed track replaces only the loop range, then stops (P)", "punch");
  const barsButton = makeButton("Bars", "Show bars and beats at the session tempo on the ruler; with Grid on, snap to beats", "activity");
  // AU-07: Grid and Bars are this project's snap settings, kept in the document (saved with the session, restored when
  // it opens or an undo reaches back past a change); without an engine they stay local as before
  const applySnap = (grid: boolean, beats: boolean) => {
    if (enabled !== grid) {
      enabled = grid;
      gridButton.setAttribute("aria-pressed", String(enabled));
    }
    if (bars !== beats) {
      bars = beats;
      barsButton.setAttribute("aria-pressed", String(bars));
      document.dispatchEvent(new CustomEvent("fw-bars-changed"));
    }
  };
  const setSnap = (grid: boolean, beats: boolean) => {
    if (engine) engine.dispatch({ type: "set-snap", grid, bars: beats });
    else applySnap(grid, beats);
  };
  engine?.subscribe("document", () => {
    const snap = engine.get("document").snap;
    applySnap(snap?.grid ?? false, snap?.bars ?? false);
  });
  barsButton.addEventListener("click", () => setSnap(enabled, !bars));

  const toggleGrid = () => setSnap(!enabled, bars);
  const toggleShuffle = () => {
    shuffle = !shuffle;
    shuffleButton.setAttribute("aria-pressed", String(shuffle));
  };
  const toggleSpot = () => {
    spot = !spot;
    spotButton.setAttribute("aria-pressed", String(spot));
  };
  const togglePunch = () => {
    punch = !punch;
    punchButton.setAttribute("aria-pressed", String(punch));
  };
  gridButton.addEventListener("click", toggleGrid);
  shuffleButton.addEventListener("click", toggleShuffle);
  spotButton.addEventListener("click", toggleSpot);
  punchButton.addEventListener("click", togglePunch);
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "g") toggleGrid();
    else if (key === "h") toggleShuffle();
    else if (key === "t") toggleSpot();
    else if (key === "p") togglePunch();
    else return;
    e.preventDefault();
  });
}
