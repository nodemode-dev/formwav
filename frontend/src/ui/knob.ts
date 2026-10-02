/**
 * Rotary controls (AU-14): a range input drawn as a knob. The input stays the control's truth (its value, default,
 * keyboard handling and its input and change events, so every handler and undo rule built on it holds); the knob
 * draws the value as an arc over a 270-degree sweep, growing from the default (the centre for a pan) to the value,
 * turns a vertical drag into value changes (the full range over 150 px, ten times finer with Shift held), sends
 * input while dragging and one change on release (one undo step), and resets to the default on double-click. The
 * hidden input keeps keyboard focus and arrows; a focus ring shows on the knob.
 */
const SWEEP = 270;
const R = 11;
const FULL_PX = 150;

const point = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(16 + R * Math.sin(a)).toFixed(2)} ${(16 - R * Math.cos(a)).toFixed(2)}`;
};

function angleOf(input: HTMLInputElement, value: number): number {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  return -SWEEP / 2 + ((Math.min(max, Math.max(min, value)) - min) / (max - min || 1)) * SWEEP;
}

function render(input: HTMLInputElement): void {
  const knob = input.previousElementSibling;
  if (!(knob instanceof HTMLElement) || !knob.classList.contains("fw-knob")) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const origin = input.dataset.default !== undefined ? Math.min(max, Math.max(min, Number(input.dataset.default))) : min;
  const a0 = angleOf(input, origin);
  const a1 = angleOf(input, value);
  const arc = a0 === a1 ? "" : `M ${point(a0)} A ${R} ${R} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${point(a1)}`;
  const path = knob.querySelector(".fw-knob-value");
  if (path && path.getAttribute("d") !== arc) path.setAttribute("d", arc);
  const tip = knob.querySelector(".fw-knob-pointer");
  const [x, y] = point(a1).split(" ");
  if (tip && (tip.getAttribute("x2") !== x || tip.getAttribute("y2") !== y)) {
    tip.setAttribute("x2", x);
    tip.setAttribute("y2", y);
  }
  const disabled = String(input.disabled);
  if (knob.dataset.disabled !== disabled) knob.dataset.disabled = disabled;
}

/** Draws `input` (a range input) as a knob placed just before it; safe to call again. */
export function knobify(input: HTMLInputElement): void {
  if (input.dataset.knob !== undefined) return;
  input.dataset.knob = "";
  input.classList.add("fw-knob-input");
  const knob = document.createElement("span");
  knob.className = "fw-knob";
  knob.title = `${input.getAttribute("aria-label") ?? "Value"}: drag up or down (Shift for fine), double-click to reset`;
  knob.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><path class="fw-knob-track" d="M ${point(-SWEEP / 2)} A ${R} ${R} 0 1 1 ${point(SWEEP / 2)}"/><path class="fw-knob-value" d=""/><line class="fw-knob-pointer" x1="16" y1="16" x2="16" y2="5"/></svg>`;
  input.before(knob);
  input.addEventListener("input", () => render(input));
  knob.addEventListener("pointerdown", (e) => {
    if (input.disabled || e.button !== 0) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    input.focus({ preventScroll: true });
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = Number(input.step) || 0;
    const start = Number(input.value);
    const y0 = e.clientY;
    let changed = false;
    const move = (ev: PointerEvent) => {
      const perPx = ((max - min) / FULL_PX) * (ev.shiftKey ? 0.1 : 1);
      let next = Math.min(max, Math.max(min, start + (y0 - ev.clientY) * perPx));
      if (step > 0) next = Math.round(next / step) * step;
      const text = String(Number(next.toFixed(6)));
      if (text === input.value) return;
      input.value = text;
      changed = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const up = () => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      if (changed) input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
  });
  knob.addEventListener("dblclick", () => {
    if (input.disabled || input.dataset.default === undefined || input.value === input.dataset.default) return;
    input.value = input.dataset.default;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  render(input);
}

/** Redraws the knob after the input's value or disabled state was set in code (which sends no event). */
export function syncKnob(input: HTMLInputElement): void {
  render(input);
}
