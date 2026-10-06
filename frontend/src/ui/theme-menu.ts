/**
 * The title bar's theme menu and accent swatches (the approved target, research/ui_reference): the form family's
 * profiles from the vendored theme module, and six accents, each swatch filled through currentColor from its app
 * token. A choice is applied and stored by the theme module (setTheme, setAccent), so it holds across sessions.
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
  const slot = host.querySelector<HTMLElement>(".fw-topbar-actions");
  if (!slot) return;
  const choice = readChoice();
  const wrap = document.createElement("div");
  wrap.className = "fw-settings";
  const options = Object.entries(THEMES)
    .map(([id, t]) => `<option value="${id}"${id === choice.theme ? " selected" : ""}>${t.label}</option>`)
    .join("");
  const swatches = SWATCHES.map(
    (name) =>
      `<button type="button" class="fw-swatch" data-swatch="${name}" aria-label="${name[0].toUpperCase()}${name.slice(1)} accent" aria-pressed="false" style="color: var(--fw-swatch-${name})"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="currentColor"></circle></svg></button>`,
  ).join("");
  wrap.innerHTML = `<button type="button" class="fw-ibtn fw-settings-btn" popovertarget="fw-settings-pop" title="Theme, accent and other settings">Settings</button><div id="fw-settings-pop" class="fw-settings-pop" popover><span class="fw-settings-title">Settings</span><label class="fw-theme-pick" title="The interface's colours, from the form family's profiles">Theme <select aria-label="Theme">${options}</select></label><div class="fw-settings-row"><span>Accent</span><div class="fw-swatches" role="group" aria-label="Accent colour">${swatches}</div></div></div>`;
  slot.prepend(wrap);

  const mark = (accent: string) => {
    for (const b of wrap.querySelectorAll<HTMLButtonElement>(".fw-swatch")) {
      b.setAttribute("aria-pressed", String(hexOf(getComputedStyle(b).color) === accent.toLowerCase()));
    }
  };
  mark(choice.accentColor);
  wrap.querySelector("select")?.addEventListener("change", (e) => setTheme((e.target as HTMLSelectElement).value));
  wrap.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".fw-swatch");
    if (!b) return;
    const hex = hexOf(getComputedStyle(b).color);
    if (!hex) return;
    setAccent(hex);
    mark(hex);
  });
}
