const LABEL_SPACING_PX = 80;
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

let enabled = false;

export function labelStep(pxPerSecond: number): number {
  return STEPS.find((s) => s * pxPerSecond >= LABEL_SPACING_PX) ?? STEPS[STEPS.length - 1];
}

export function gridEnabled(): boolean {
  return enabled;
}

export function snapSamples(position: number, sampleRate: number, pxPerSecond: number): number {
  if (!enabled) return position;
  const step = (labelStep(pxPerSecond) / 5) * sampleRate;
  return Math.max(0, Math.round(Math.round(position / step) * step));
}

export function mountGrid(host: HTMLElement): void {
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-mode";
  button.textContent = "Grid";
  button.title = "Snap moves and trims to the ruler's ticks (G)";
  button.setAttribute("aria-pressed", "false");
  transport?.append(button);

  const toggle = () => {
    enabled = !enabled;
    button.setAttribute("aria-pressed", String(enabled));
  };
  button.addEventListener("click", toggle);
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "g") return;
    e.preventDefault();
    toggle();
  });
}
