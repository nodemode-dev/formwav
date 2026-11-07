import { DEMO_ICONS } from "../../../demo/src/icons";

const S = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  ...DEMO_ICONS,
  power: S('<path d="M12 3v8"/><path d="M6.3 7.2a8 8 0 1 0 11.4 0"/>'),
  chevron: S('<path d="M6 9l6 6 6-6"/>'),
};

export function mountIcons(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const svg = ICONS[el.dataset.icon ?? ""];
    if (!svg) continue;
    const size = el.dataset.size ?? "16";
    el.style.inlineSize = `${size}px`;
    el.style.blockSize = `${size}px`;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = svg;
  }
}
