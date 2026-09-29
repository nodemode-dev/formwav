import type { Player } from "../audio/player";

const FLOOR_DB = -60;
const FALL_DB_PER_SECOND = 20;

function toDb(peak: number): number {
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function mountOutputMeter(host: HTMLElement, player: Player): void {
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  const meter = document.createElement("div");
  meter.className = "fw-out-meter";
  meter.setAttribute("role", "group");
  meter.setAttribute("aria-label", "Output level");
  meter.innerHTML =
    `<div class="fw-out-track"><div class="fw-out-bar"></div></div>` +
    `<div class="fw-out-track"><div class="fw-out-bar"></div></div>` +
    `<button class="fw-out-clip" type="button" data-clip="false" aria-label="Output clip indicator, click to reset" title="Output reached 0 dBFS (click to reset)"></button>`;
  transport?.append(meter);
  const bars = [...meter.querySelectorAll<HTMLElement>(".fw-out-bar")];
  const clip = meter.querySelector<HTMLButtonElement>(".fw-out-clip");
  const shown = [-Infinity, -Infinity];
  const last = ["", ""];
  let lastTime = performance.now();

  const draw = (i: number) => {
    const v = Math.max(0, Math.min(1, (shown[i] - FLOOR_DB) / -FLOOR_DB));
    const transform = `scaleX(${v.toFixed(3)})`;
    if (transform !== last[i]) {
      last[i] = transform;
      bars[i].style.transform = transform;
    }
  };
  draw(0);
  draw(1);

  player.onOutputLevel((left, right) => {
    const now = performance.now();
    const fall = ((now - lastTime) / 1000) * FALL_DB_PER_SECOND;
    lastTime = now;
    const peaks = [left, right];
    const silent = left === 0 && right === 0;
    for (let i = 0; i < 2; i++) {
      shown[i] = silent ? -Infinity : Math.max(toDb(peaks[i]), shown[i] - fall);
      draw(i);
    }
    if (clip && Math.max(left, right) >= 1 && clip.dataset.clip !== "true") clip.dataset.clip = "true";
  });

  clip?.addEventListener("click", () => {
    if (clip.dataset.clip !== "false") clip.dataset.clip = "false";
  });
}
