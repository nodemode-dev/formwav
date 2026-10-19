/**
 * PLAN_v13 S6, the counters (main and sub counters and edit selection): the main counter's timebase, a sub
 * counter under it, the selection's Start, End and Length in the main counter's timebase, the session's timecode rate
 * and the rulers shown, chosen in a small dialog over the clock.
 */
import type { Engine } from "../engine";
import { editSpan, type EditRange } from "../engine/editing";
import { FRAME_RATES, formatLength, formatPosition, TIME_FORMATS, type FrameRateId, type TimeFormat } from "../engine/timebase";
import { setText } from "../vendor/nodemode/dom-stable";
import { CLOCK_MODES, clockMode, setClockMode, timeOf, type ClockMode } from "./shell";

/** The rulers that can show under the main one, in their usual order (Timecode 2 runs at 25, or 30 when the session
 *  is at 25); the main ruler carries the markers and follows the main counter. */
export const RULERS: readonly { id: string; label: string }[] = [
  { id: "bars_beats", label: "Bars|Beats" },
  { id: "min_secs", label: "Min:Secs" },
  { id: "timecode", label: "Timecode" },
  { id: "timecode2", label: "Timecode 2" },
  { id: "feet_frames", label: "Feet+Frames" },
  { id: "samples", label: "Samples" },
  { id: "tempo", label: "Tempo" },
  { id: "meter", label: "Meter" },
  { id: "key", label: "Key" },
  { id: "chords", label: "Chords" },
];

let shownRulers: string[] = [];
/** The rulers chosen, in order. */
export function rulers(): readonly string[] {
  return shownRulers;
}

const RULERS_KEY = "formwav.rulers";
const SUB_KEY = "formwav.subCounter";

export function mountCounters(host: HTMLElement, engine: Engine): void {
  const clock = host.querySelector<HTMLElement>(".fw-clock");
  const length = host.querySelector<HTMLElement>(".fw-st-length");
  const sub = host.querySelector<HTMLElement>(".fw-subcounter");
  const box = host.querySelector<HTMLElement>(".fw-sel");
  const cells = Object.fromEntries([...host.querySelectorAll<HTMLElement>(".fw-sel-cell")].map((c) => [c.dataset.sel ?? "", c.querySelector<HTMLElement>(".fw-sel-value")]));
  if (!clock) return;
  let subFormat: TimeFormat | "" = "";
  try {
    const saved = localStorage.getItem(SUB_KEY) ?? "";
    if (TIME_FORMATS.some((f) => f.id === saved)) subFormat = saved as TimeFormat;
    const list = JSON.parse(localStorage.getItem(RULERS_KEY) ?? "[]");
    if (Array.isArray(list)) shownRulers = RULERS.map((r) => r.id).filter((id) => list.includes(id));
  } catch {
    clock.setAttribute("data-storage", "none");
  }
  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      clock.setAttribute("data-storage", "none");
    }
  };

  let range: EditRange | null = null;
  let picked: readonly string[] = [];
  host.addEventListener("fw-range", (e) => {
    const d = (e as CustomEvent<EditRange | null>).detail;
    range = d ? { trackId: d.trackId, start: d.start, end: d.end } : null;
    render();
  });
  host.addEventListener("fw-selection", (e) => {
    picked = (e as CustomEvent<string[]>).detail ?? [];
    render();
  });
  const mainFormat = (): TimeFormat => CLOCK_MODES.find((m) => m.id === clockMode())?.format ?? "min_secs";
  // the readouts: the selection's span (a range, else the selected clips), or the playhead with nothing selected
  const render = () => {
    const doc = engine.get("document");
    if (!doc.tracks.length) {
      for (const cell of [cells.start, cells.end, cells.length, sub]) setText(cell ?? null, "");
      return;
    }
    const ctx = timeOf(doc);
    const at = engine.get("transport").positionSamples;
    const span = editSpan(doc, { range, clipIds: picked });
    const start = span ? span.start : at;
    const end = span ? span.end : at;
    const fmt = mainFormat();
    // each timebase's widest usual reading, so the columns hold still as the figures change and drop as the tray narrows
    const w = fmt === "min_secs" || fmt === "feet_frames" ? "9" : fmt === "timecode" ? undefined : "10";
    if (box && box.dataset.w !== w) {
      if (w) box.dataset.w = w;
      else delete box.dataset.w;
    }
    setText(cells.start ?? null, formatPosition(start, fmt, ctx));
    setText(cells.end ?? null, formatPosition(end, fmt, ctx));
    setText(cells.length ?? null, formatLength(start, end - start, fmt, ctx));
    if (sub) setText(sub, subFormat ? `${TIME_FORMATS.find((f) => f.id === subFormat)?.label} ${formatPosition(at, subFormat, ctx)}` : "");
  };
  const showSub = () => {
    if (sub && sub.hidden !== !subFormat) sub.hidden = !subFormat;
    if (length && length.hidden !== !!subFormat) length.hidden = !!subFormat;
  };
  showSub();
  engine.subscribe("document", render);
  engine.subscribe("transport", render);
  document.addEventListener("fw:clock-mode", render);

  const pop = document.createElement("div");
  pop.className = "fw-norm fw-counter-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Counters and rulers");
  const option = (value: string, label: string) => `<option value="${value}">${label}</option>`;
  pop.innerHTML =
    `<label class="fw-spot-label">Main counter<select class="fw-spot-input" data-c="main" aria-label="Main counter">${CLOCK_MODES.map((m) => option(m.id, m.label)).join("")}</select></label>` +
    `<label class="fw-spot-label">Sub counter<select class="fw-spot-input" data-c="sub" aria-label="Sub counter">${option("", "Off")}${TIME_FORMATS.map((f) => option(f.id, f.label)).join("")}</select></label>` +
    `<label class="fw-spot-label" title="The session's timecode rate, for timecode, Feet+Frames and a grid of frames; saved with the session">Timecode rate<select class="fw-spot-input" data-c="rate" aria-label="Timecode rate">${FRAME_RATES.map((r) => option(r.id, r.label)).join("")}</select></label>` +
    `<div class="fw-counter-rulers" role="group" aria-label="Rulers"><span class="fw-counter-head">Rulers</span>${RULERS.map((r) => `<label class="fw-counter-ruler"><input type="checkbox" data-ruler="${r.id}"> ${r.label}</label>`).join("")}<span class="fw-counter-sets"><button type="button" class="fw-mode" data-c="all" title="Every ruler">All</button><button type="button" class="fw-mode" data-c="minimal" title="Only the main ruler, with the markers">Minimal</button></span></div>`;
  document.body.append(pop);
  const field = <T extends HTMLElement>(c: string) => pop.querySelector<T>(`[data-c="${c}"]`) as T;
  const main = field<HTMLSelectElement>("main");
  const subSelect = field<HTMLSelectElement>("sub");
  const rate = field<HTMLSelectElement>("rate");
  const syncPop = () => {
    const doc = engine.get("document");
    if (main.value !== clockMode()) main.value = clockMode();
    if (subSelect.value !== subFormat) subSelect.value = subFormat;
    const r = timeOf(doc).rate.id;
    if (rate.value !== r) rate.value = r;
    for (const box of pop.querySelectorAll<HTMLInputElement>("[data-ruler]")) box.checked = shownRulers.includes(box.dataset.ruler ?? "");
  };
  const setRulers = (next: string[]) => {
    shownRulers = RULERS.map((r) => r.id).filter((id) => next.includes(id));
    save(RULERS_KEY, JSON.stringify(shownRulers));
    syncPop();
    document.dispatchEvent(new CustomEvent("fw:rulers"));
  };
  main.addEventListener("change", () => setClockMode(main.value as ClockMode));
  subSelect.addEventListener("change", () => {
    subFormat = subSelect.value as TimeFormat | "";
    save(SUB_KEY, subFormat);
    showSub();
    render();
  });
  rate.addEventListener("change", () => engine.dispatch({ type: "set-frame-rate", rate: rate.value as FrameRateId }));
  pop.addEventListener("change", (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>("[data-ruler]");
    if (box) setRulers(box.checked ? [...shownRulers, box.dataset.ruler ?? ""] : shownRulers.filter((id) => id !== box.dataset.ruler));
  });
  field("all").addEventListener("click", () => setRulers(RULERS.map((r) => r.id)));
  field("minimal").addEventListener("click", () => setRulers([]));
  engine.subscribe("document", () => {
    if (!pop.hidden) syncPop();
  });

  const close = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    clock.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    syncPop();
    pop.hidden = false;
    const r = clock.getBoundingClientRect();
    pop.style.transform = `translate(${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)))}px, ${Math.round(r.top - 8 - pop.offsetHeight)}px)`;
    clock.setAttribute("aria-expanded", "true");
    main.focus();
  };
  clock.addEventListener("click", () => (pop.hidden ? open() : close()));
  clock.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (pop.hidden) open();
      else close();
    }
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.target as HTMLElement).tagName === "SELECT")) {
      e.preventDefault();
      close();
      clock.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (!pop.hidden && !pop.contains(t) && !clock.contains(t)) close();
  });
  host.addEventListener("fw-counters", open);
  render();
}
