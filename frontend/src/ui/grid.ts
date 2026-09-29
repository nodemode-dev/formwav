const LABEL_SPACING_PX = 80;
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

let enabled = false;
let shuffle = false;

export function shuffleEnabled(): boolean {
  return shuffle;
}

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
  const makeButton = (label: string, title: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fw-mode";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-pressed", "false");
    transport?.append(button);
    return button;
  };
  const gridButton = makeButton("Grid", "Snap moves and trims to the ruler's ticks (G)");
  const shuffleButton = makeButton("Shuffle", "Deleting and trimming clips moves the later clips on the track to close the gap (H)");

  const toggleGrid = () => {
    enabled = !enabled;
    gridButton.setAttribute("aria-pressed", String(enabled));
  };
  const toggleShuffle = () => {
    shuffle = !shuffle;
    shuffleButton.setAttribute("aria-pressed", String(shuffle));
  };
  gridButton.addEventListener("click", toggleGrid);
  shuffleButton.addEventListener("click", toggleShuffle);
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "g") toggleGrid();
    else if (key === "h") toggleShuffle();
    else return;
    e.preventDefault();
  });
}
