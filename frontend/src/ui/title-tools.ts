import { icon } from "../vendor/formvis/icons";
import { readChoice, setTheme } from "../vendor/formvis/themes";

const LIGHT = new Set(["light", "sand"]);
const DARK_KEY = "formwav.darkTheme";

/**
 * The title bar's tools, as the form family has them (formvis titlebar-tools): a theme toggle between the light theme
 * and the dark theme last used (kept under formwav.darkTheme, Studio Dark at first), its icon the theme it switches
 * to, and a button that opens the command palette (fw-palette, the same as Cmd or Ctrl K). Both buttons are in the
 * page from the first frame; only the toggle's icon and words change, in place.
 */
export function mountTitleTools(host: HTMLElement): void {
  const toggle = host.querySelector<HTMLButtonElement>('[data-action="theme-toggle"]');
  const search = host.querySelector<HTMLButtonElement>('[data-action="search-commands"]');
  if (search && !search.firstElementChild) search.innerHTML = icon("search", 15);
  let shown = "";
  const paint = () => {
    if (!toggle) return;
    const light = LIGHT.has(readChoice().theme);
    const want = light ? "dark" : "light";
    if (shown === want) return;
    shown = want;
    toggle.innerHTML = icon(light ? "moon" : "sun", 15);
    const words = light ? "Switch to a dark theme" : "Switch to a light theme";
    toggle.title = words;
    toggle.setAttribute("aria-label", words);
  };
  toggle?.addEventListener("click", () => {
    const now = readChoice().theme;
    if (LIGHT.has(now)) {
      let dark = "studio";
      try {
        dark = localStorage.getItem(DARK_KEY) || dark;
      } catch {
        /* storage blocked: Studio Dark */
      }
      setTheme(dark);
    } else {
      try {
        localStorage.setItem(DARK_KEY, now);
      } catch {
        /* storage blocked: the toggle still works this visit */
      }
      setTheme("light");
    }
  });
  search?.addEventListener("click", () => host.dispatchEvent(new CustomEvent("fw-palette")));
  document.addEventListener("nm:ui-settings-changed", paint);
  paint();
}
