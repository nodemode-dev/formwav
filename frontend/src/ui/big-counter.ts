/**
 * Pro Tools' Big Counter: the transport's position in large figures, in the footer clock's own format and timecode
 * start, on a panel that floats over the window; dragged by its head, closed by its button or from the View menu.
 */
import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";
import { icon as fvIcon } from "../vendor/formvis/icons";
import { clockMode, formatClock } from "./shell";

export interface BigCounter {
  toggle: () => void;
  isOpen: () => boolean;
  onChange: (fn: () => void) => void;
}

export function mountBigCounter(host: HTMLElement, engine: Engine): BigCounter {
  const panel = document.createElement("section");
  panel.className = "fw-big-counter";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Big counter");
  panel.innerHTML = `<div class="fw-big-counter-head"><span>Counter</span><button type="button" class="fw-icon-btn fw-big-counter-close" aria-label="Close the big counter" title="Close the big counter">${fvIcon("close", 14)}</button></div><output class="fw-big-counter-time">00:00:00.000</output>`;
  host.append(panel);
  const head = panel.querySelector<HTMLElement>(".fw-big-counter-head") as HTMLElement;
  const time = panel.querySelector<HTMLElement>(".fw-big-counter-time");
  const render = () => {
    if (panel.hidden) return;
    const t = engine.get("transport");
    setText(time, formatClock(t.positionSamples, t.sampleRate, clockMode(), engine.get("document").timecodeStart ?? 0));
  };
  engine.subscribe("transport", render);
  engine.subscribe("document", render);
  document.addEventListener("fw:clock-mode", render);

  const listeners = new Set<() => void>();
  const setOpen = (on: boolean) => {
    if (panel.hidden === !on) return;
    panel.hidden = !on;
    render();
    for (const fn of listeners) fn();
  };
  panel.querySelector(".fw-big-counter-close")?.addEventListener("click", () => setOpen(false));

  let offset = { x: 0, y: 0 };
  let drag: { x: number; y: number; from: { x: number; y: number }; base: DOMRect } | null = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const r = panel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, from: offset, base: new DOMRect(r.left - offset.x, r.top - offset.y, r.width, r.height) };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => {
    const d = drag;
    if (!d) return;
    const x = Math.min(window.innerWidth - d.base.right, Math.max(-d.base.left, d.from.x + e.clientX - d.x));
    const y = Math.min(window.innerHeight - d.base.bottom, Math.max(-d.base.top, d.from.y + e.clientY - d.y));
    offset = { x, y };
    panel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
  const end = () => {
    drag = null;
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);

  return {
    toggle: () => setOpen(panel.hidden !== false),
    isOpen: () => !panel.hidden,
    onChange: (fn) => listeners.add(fn),
  };
}
