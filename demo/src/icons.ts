import { ICONS as BASE } from "../../frontend/src/ui/icons";

const S = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const DEMO_ICONS: Record<string, string> = {
  ...BASE,
  palette: S('<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.4-1.3-1.6-1.3-2.9 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.2" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.8" r="1" fill="currentColor" stroke="none"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  minus: S('<path d="M5 12h14"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
};

export function mountIcons(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const svg = DEMO_ICONS[el.dataset.icon ?? ""];
    if (!svg) continue;
    const size = el.dataset.size ?? "16";
    el.style.inlineSize = `${size}px`;
    el.style.blockSize = `${size}px`;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = svg;
  }
}
