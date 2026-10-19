/**
 * Settings > Theme and colour: a small panel with the theme picker (the form family's profiles from the vendored theme
 * module) and six accents, each swatch filled through currentColor from its app token. A choice is applied and stored by
 * the theme module (setTheme, setAccent), so it holds across sessions.
 */
import { readChoice, setAccent, setTheme, THEMES } from "../vendor/formvis/themes";

const SWATCHES = ["orange", "lime", "teal", "blue", "pink", "violet"];

/** A computed rgb() colour as #rrggbb, or "" when it does not parse. */
function hexOf(rgb: string): string {
  const parts = rgb.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return "";
  return "#" + parts.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
}

export function mountThemeMenu(host: HTMLElement): void {
  const pop = host.querySelector<HTMLElement>(".fw-settings-pop");
  if (!pop) return;
  const choice = readChoice();
  const swatches = SWATCHES.map(
    (name) =>
      `<button type="button" class="fw-swatch" data-swatch="${name}" aria-label="${name[0].toUpperCase()}${name.slice(1)} accent" aria-pressed="false" style="color: var(--fw-swatch-${name})"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"></circle></svg></button>`,
  ).join("");
  pop.innerHTML = `<button class="fw-ibtn" type="button" role="menuitem" data-action="theme" aria-haspopup="dialog" aria-expanded="false" title="Choose the colour theme and the accent colour"><span>Theme and colour…</span></button>`;
  const item = pop.querySelector<HTMLButtonElement>('[data-action="theme"]');
  const panel = document.createElement("div");
  panel.className = "fw-popover fw-theme-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Theme and colour");
  panel.innerHTML = `<label class="fw-theme-pick">Theme <select data-theme-pick aria-label="Theme"></select></label><span class="fw-menu-label">Accent</span><div class="fw-swatches" role="group" aria-label="Accent colour">${swatches}</div>`;
  (document.getElementById("overlay-root") ?? document.body).append(panel);
  const select = panel.querySelector<HTMLSelectElement>("[data-theme-pick]");
  if (select) {
    select.replaceChildren(...Object.entries(THEMES).map(([id, t]) => new Option(t.label, id)));
    select.value = choice.theme;
    select.addEventListener("change", () => setTheme(select.value));
  }

  const mark = (accent: string) => {
    for (const b of panel.querySelectorAll<HTMLButtonElement>(".fw-swatch")) {
      b.setAttribute("aria-pressed", String(hexOf(getComputedStyle(b).color) === accent.toLowerCase()));
    }
  };
  mark(choice.accentColor);
  panel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".fw-swatch");
    if (!b) return;
    const hex = hexOf(getComputedStyle(b).color);
    if (!hex) return;
    setAccent(hex);
    mark(hex);
  });

  const anchor = () => pop.closest(".fw-menu")?.querySelector<HTMLElement>(".fw-menu-btn") ?? null;
  const setOpen = (open: boolean) => {
    if (panel.hidden === !open) return;
    panel.hidden = !open;
    item?.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const r = anchor()?.getBoundingClientRect();
    if (r) {
      panel.style.top = `${Math.round(r.bottom + 4)}px`;
      panel.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - panel.offsetWidth - 8))}px`;
    }
    select?.focus();
  };
  item?.addEventListener("click", () => window.setTimeout(() => setOpen(!!panel.hidden), 0));
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Node;
    if (!panel.hidden && !panel.contains(target) && !pop.contains(target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || panel.hidden) return;
    setOpen(false);
    anchor()?.focus();
  });
}
