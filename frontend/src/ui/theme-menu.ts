/**
 * The header's theme picker and accent swatches (the agreed canvas): the form family's profiles from the vendored theme
 * module, and six accents, each swatch filled through currentColor from its app token; Settings repeats the accents for
 * a window too narrow to show them in the header. A choice is applied and stored by the theme module (setTheme,
 * setAccent), so it holds across sessions.
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
  const wrap = pop;
  const swatches = SWATCHES.map(
    (name) =>
      `<button type="button" class="fw-swatch" data-swatch="${name}" aria-label="${name[0].toUpperCase()}${name.slice(1)} accent" aria-pressed="false" style="color: var(--fw-swatch-${name})"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"></circle></svg></button>`,
  ).join("");
  pop.innerHTML = `<span class="fw-menu-label fw-menu-accent">Accent</span><div class="fw-swatches fw-menu-accent" role="group" aria-label="Accent colour">${swatches}</div>`;
  const headSelect = host.querySelector<HTMLSelectElement>("[data-theme-pick]");
  const headSwatches = host.querySelector<HTMLElement>(".fw-head-swatches");
  if (headSelect) {
    headSelect.replaceChildren(...Object.entries(THEMES).map(([id, t]) => new Option(t.label, id)));
    headSelect.value = choice.theme;
  }
  if (headSwatches) headSwatches.innerHTML = swatches;
  headSelect?.addEventListener("change", () => setTheme(headSelect.value));

  const mark = (accent: string) => {
    for (const b of host.querySelectorAll<HTMLButtonElement>(".fw-swatch")) {
      b.setAttribute("aria-pressed", String(hexOf(getComputedStyle(b).color) === accent.toLowerCase()));
    }
  };
  mark(choice.accentColor);
  for (const root of [wrap, headSwatches]) {
    root?.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".fw-swatch");
      if (!b) return;
      const hex = hexOf(getComputedStyle(b).color);
      if (!hex) return;
      setAccent(hex);
      mark(hex);
    });
  }
}
