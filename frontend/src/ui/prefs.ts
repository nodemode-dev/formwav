import { icon as fvIcon } from "../vendor/formvis/icons";
import { DEFAULT_ACCENT, readChoice, setAccent, setIntensity, setTheme, THEMES } from "../vendor/formvis/themes";
import { homeAtLaunch, setHomeAtLaunch } from "./home";
import type { Engine } from "../engine";
import { armedTrack } from "./arm";
import { HEIGHT_KEY } from "./dock";
import { DEFAULT_PRESETS, PRESETS_KEY } from "./editing";
import { language, LANGUAGES, onLanguage, setLanguage } from "./i18n";
import { inputDevices, onInputsChanged, refreshInputs, setTrackInput, trackInput } from "./inputs";
import { INPUT_QUANTIZE_KEY } from "./midi-input";
import { modelsMarkup, mountModelsKeys } from "./prefs-models";
import { CLOCK_MODES, clockMode, setClockMode, type ClockMode } from "./shell";

const MOTION_KEY = "formwav.reduceMotion";
const SYSTEM_KEY = "formwav.followSystem";
const DARK_KEY = "formwav.darkTheme";
const LIGHT = new Set(["light", "sand"]);

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: this visit only */
  }
};

// FormVis's list of sections (its SettingsDialog), with formwav's own: Models on this computer is the eleventh
const SECTIONS: [id: string, label: string, icon: string][] = [
  ["general", "General", "settings"],
  ["interface", "Interface", "theme"],
  ["workspace", "Workspace", "layers"],
  ["audio", "Audio and Devices", "sliders"],
  ["recording", "Recording", "play"],
  ["editing", "Editing", "penTool"],
  ["files", "File Handling", "folder"],
  ["plugins", "Plugins and Extensions", "plus"],
  ["models", "Models on this computer", "download"],
  ["keys", "Keys and Models", "lock"],
  ["agents", "Agents", "link"],
];
const RAIL_KEY = "formwav.prefsRailCollapsed";
const FOLD_ICON = `<span class="icon" style="width:16px;height:16px" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 6l-6 6 6 6M19 6l-6 6 6 6"/></svg></span>`;

/** The body of a section's card (`[data-prefs-body]`), for a section module that renders its own rows into it. */
export function prefsCardBody(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`dialog.fw-prefs [data-prefs-body="${id}"]`);
}

const row = (label: string, hint: string, control: string) =>
  `<div class="fw-prefs-row"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label">${label}</span><span class="fw-prefs-row-hint">${hint}</span></div><div class="fw-prefs-row-ctl">${control}</div></div>`;
const check = (key: string, label: string) => `<label class="fw-prefs-check"><input type="checkbox" data-pref="${key}"><span>${label}</span></label>`;
const num = (key: string, min: number, max: number, step: number, unit: string, label: string) =>
  `<label class="fw-prefs-num"><input type="number" data-pref="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><span>${unit}</span></label>`;
const btn = (act: string, label: string) => `<button type="button" class="fw-prefs-btn" data-prefs-act="${act}">${label}</button>`;
// a slider with its number box beside it (FormVis's controls.ts builds its sliders this way): either one sets the
// other, and the setting is written once, by whichever was used
const slide = (key: string, min: number, max: number, step: number, unit: string, label: string) =>
  `<span class="fw-prefs-slide"><input type="range" data-pref="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><label class="fw-prefs-num"><input type="number" data-pref="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><span>${unit}</span></label></span>`;
const selectOf = (key: string, label: string, options: [string, string][]) =>
  `<select data-pref="${key}" aria-label="${label}">${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
// the theme grid: one swatch for each profile, the surface, the raised surface and the ink as the profile has them
const themeGrid = () =>
  `<div class="fw-prefs-themes" role="radiogroup" aria-label="Theme">${Object.entries(THEMES)
    .map(([id, p]) => `<button type="button" class="fw-theme-swatch" role="radio" aria-checked="false" data-theme-pick="${id}" aria-label="${p.label}" title="${p.label}" translate="no" style="--sw-a:${p.vars["--bg-primary"]};--sw-b:${p.vars["--bg-tertiary"]};--sw-c:${p.vars["--text-primary"]}"><i></i></button>`)
    .join("")}</div>`;
const QUANTIZE_GRIDS: [string, string][] = [["", "Kept as played"], ["1/4", "1/4"], ["1/8", "1/8"], ["1/16", "1/16"], ["1/32", "1/32"], ["1/4t", "1/4 triplet"], ["1/8t", "1/8 triplet"], ["1/16t", "1/16 triplet"]];
const ZOOM_PRESET_KEYS = ["zoom0", "zoom1", "zoom2", "zoom3", "zoom4"];

/**
 * Preferences (formvis's SettingsDialog, the SETTINGS map): one dialog built once at start, the section rail floating
 * outside its left edge (collapsible to icons, remembered as formwav.prefsRailCollapsed) and wired to a port at the
 * header divider, the sections as foldable cards in one scrolling pane, Done in the footer; the rail follows the scroll
 * (scroll spy) and a tab scrolls its card into view. `fw-preferences` with a section id as detail opens at that card;
 * a section module renders into its card through prefsCardBody(id). Opened by Settings > Preferences, Cmd or Ctrl comma, Home's Preferences, and the desktop app's menu.
 * Rows read the setting each time the dialog opens and write it at once: the theme and accent through the family's
 * theme store, the language through i18n, Home at launch, reduced motion and following the system's appearance as
 * formwav keys; the recording rows are the transport's own fields (latency, pre-roll, post-roll), written there so
 * there is one path; the agents and devices rows open their dialogs.
 */
export function mountPreferences(host: HTMLElement, engine: Engine): void {
  const dialog = document.createElement("dialog");
  dialog.className = "fw-prefs";
  dialog.setAttribute("aria-label", "Preferences");
  const themeOptions = Object.entries(THEMES)
    .map(([id, p]) => `<option value="${id}">${p.label}</option>`)
    .join("");
  const langOptions = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
  const clockOptions = CLOCK_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
  const proxy = (selector: string, label: string) => `<button type="button" class="fw-prefs-btn" data-prefs-click='${selector}'>${label}</button>`;
  const group = (label: string) => `<h4 class="fw-prefs-group">${label}</h4>`;
  const extra = modelsMarkup();
  const cards: Record<string, string> = {
    general:
      group("Startup") +
      row("Home at launch", "Show Start when formwav starts with no session open", check("home", "Show Start at launch")) +
      group("Reset") +
      row("Reset all preferences", "Theme, language, layout, recording and every other setting of this window go back to their defaults; sessions are kept", btn("reset", "Reset…")),
    interface:
      group("Theme") +
      row("Themes", "Pick one to see it at once", themeGrid()) +
      row("Theme", "The colours of every surface", `<select data-pref="theme" aria-label="Theme" translate="no">${themeOptions}</select>`) +
      row("Follow the system", "Switch between the light theme and your dark one with the computer's appearance", check("system", "Follow the system's appearance")) +
      row("Accent colour", "Buttons, selection and focus", `<span class="fw-prefs-accent"><input type="color" data-pref="accent" aria-label="Accent colour">${btn("accent-default", "Default")}</span>`) +
      row("Accent strength", "How strongly the accent tints surfaces", slide("intensity", 0, 150, 5, "%", "Accent strength")) +
      group("Language and motion") +
      row("Language", "The language of the interface; English is the default", `<select data-pref="language" aria-label="Language" translate="no">${langOptions}</select>`) +
      row("Reduce motion", "Turn off transitions and animations", check("motion", "Reduce motion")) +
      group("Counters") +
      row("Main counter", "The timebase of the counter and the ruler", `<select data-pref="clock" aria-label="Main counter">${clockOptions}</select>`),
    workspace:
      group("Panels") +
      row("Browser", "The media browser beside the tracks", check("pane-media", "Show the browser")) +
      row("Editor", "The editor panel under the tracks", check("pane-editor", "Show the editor")) +
      group("Window") +
      row("Window configuration", "Arrange the panels as a preset or as one you saved; the same list as View > Layout", selectOf("layout", "Window configuration", [["", "Layout"]])) +
      row("Dock height", "How tall the editor panel opens under the tracks", slide("dock-height", 140, 600, 10, "px", "Dock height in pixels")) +
      group("Zoom") +
      row("Zoom presets", "Five zoom levels the number keys recall; Shift with a key stores the zoom in view", `<span class="fw-prefs-zooms">${ZOOM_PRESET_KEYS.map((k, i) => `<input type="number" data-pref="${k}" min="0.25" max="8000" step="any" aria-label="Zoom preset ${i + 1}">`).join("")}</span>`),
    audio:
      group("Output") +
      row("Output", "Where playback is heard: the browser's own audio, or a device of this computer", selectOf("output", "Output", [["browser", "Browser"]])) +
      group("Input") +
      row("Recording input", "The armed track's input, or the first track's when none is armed; every track keeps its own", selectOf("input", "Recording input", [["", "Default input"]])),
    recording:
      group("Timing") +
      row("Recording latency", "How far a take is moved back to line up with what was playing", num("latency", 0, 500, 1, "ms", "Recording latency in milliseconds")) +
      row("Pre-roll", "How long recording rolls before the punch point", num("preroll", 0, 10, 0.5, "s", "Pre-roll in seconds")) +
      row("Post-roll", "How long a punch keeps rolling after its out point", num("postroll", 0, 10, 0.5, "s", "Post-roll in seconds")),
    editing:
      group("Commands") +
      row("Keyboard shortcuts", "Every command with a key, by menu", btn("shortcuts", "Show shortcuts")) +
      row("Commands", "Find and run any command by name (Cmd or Ctrl K)", btn("palette", "Search commands")) +
      group("MIDI input") +
      row("Quantize takes", "Place the notes of a MIDI take on this grid as the take is kept; the Event menu's Quantize sets the same", selectOf("iq-grid", "Quantize MIDI takes to", QUANTIZE_GRIDS)) +
      row("Strength", "How far each note moves toward the grid", slide("iq-strength", 0, 100, 1, "%", "Input quantize strength")) +
      row("Swing", "How far every second line moves later", slide("iq-swing", 0, 100, 1, "%", "Input quantize swing")) +
      row("Notes", "Whether a note's end moves with its start", selectOf("iq-ends", "Input quantize notes", [["starts", "Starts only"], ["ends", "Starts and ends"]])),
    files:
      group("Autosave and recovery") +
      row("Autosave", "The open session is kept every 30 seconds; after a crash, Recover or Discard is offered at the next start", `<span class="fw-prefs-state" data-prefs-autosave></span>${btn("autosave-discard", "Discard")}`) +
      group("Cloud") +
      row("Google Drive and Dropbox", "Open a session from, or save it to, your cloud storage", proxy('[data-action="cloud"]', "Cloud…")),
    plugins:
      group("Plug-ins") +
      row("Plug-in folders", "Plug-ins are found in the system's plug-in folders and in the folders FORMWAV_PLUGIN_PATH names", `<span class="fw-prefs-state" data-prefs-plugins></span>${btn("plugins-scan", "Scan again")}`) +
      group("Extensions") +
      row("Reload extensions", "Read the installed and development extensions again", proxy('[data-ext-act="reload"]', "Reload")) +
      row("Manage in FormPortal", "Install, update and remove extensions in FormPortal", proxy('[data-ext-act="manage"]', "Open FormPortal")),
    keys: extra.keys,
    models: extra.models,
    agents:
      group("Agents") +
      row("Agents", "Connect an AI agent to formwav's MCP server", btn("agents", "Agents…")) +
      group("Devices") +
      row("Devices on this network", "Pair a phone or tablet as a remote or a microphone; off until you turn it on", btn("devices", "Devices…")),
  };
  dialog.innerHTML = `<div class="fw-prefs-head"><span class="fw-prefs-headicon">${fvIcon("settings", 16)}</span><h2 class="fw-prefs-title">Preferences</h2><button type="button" class="fw-prefs-x" data-prefs-act="done" aria-label="Close" title="Close">${fvIcon("close", 16)}</button></div>
<div class="fw-prefs-pane">${SECTIONS.map(([id, label, ic], i) => `<section class="fw-prefs-sec${i ? "" : " is-current"}" data-prefs-sec="${id}" role="tabpanel"><button type="button" class="fw-prefs-sechead" data-prefs-fold="${id}" aria-expanded="true"><span class="fw-prefs-secicon">${fvIcon(ic, 16)}</span><span class="fw-prefs-seclabel">${label}</span><span class="fw-prefs-chev">${fvIcon("chevronDown", 16)}</span></button><div class="fw-prefs-secbody" data-prefs-body="${id}">${cards[id]}</div></section>`).join("")}</div>
<div class="fw-prefs-foot"><button type="button" class="fw-prefs-done" data-prefs-act="done">Done</button></div>
<div class="fw-prefs-rail"><nav class="fw-prefs-nav" role="tablist" aria-label="Sections">${SECTIONS.map(([id, label, ic], i) => `<button type="button" class="fw-prefs-tab${i ? "" : " is-active"}" role="tab" aria-selected="${i ? "false" : "true"}" data-prefs-tab="${id}" title="${label}"><span class="fw-prefs-tabicon">${fvIcon(ic, 18)}</span><span class="fw-prefs-tablabel">${label}</span></button>`).join("")}</nav><button type="button" class="fw-prefs-fold" data-prefs-rail-fold>${FOLD_ICON}</button></div>
<svg class="fw-prefs-wire" aria-hidden="true"><path class="fw-prefs-wire-shade"></path><path class="fw-prefs-wire-line"></path></svg><span class="fw-prefs-port" aria-hidden="true"></span>`;
  // FormVis's group cards: each group heading and the rows under it, up to the next heading, in one card
  for (const body of dialog.querySelectorAll<HTMLElement>("[data-prefs-body]")) {
    let box: HTMLElement | null = null;
    for (const child of [...body.children] as HTMLElement[]) {
      if (child.matches("h4.fw-prefs-group") || !box) {
        box = document.createElement("div");
        box.className = "fw-prefs-groupbox";
        body.insertBefore(box, child);
      }
      box.append(child);
    }
  }
  host.append(dialog);
  const modelsKeys = mountModelsKeys(dialog);
  const pref =<T extends HTMLElement = HTMLInputElement>(k: string) => dialog.querySelector<T>(`[data-pref="${k}"]`);
  const pane = dialog.querySelector<HTMLElement>(".fw-prefs-pane")!;
  const nav = dialog.querySelector<HTMLElement>(".fw-prefs-nav")!;
  const railEl = dialog.querySelector<HTMLElement>(".fw-prefs-rail")!;
  const head = dialog.querySelector<HTMLElement>(".fw-prefs-head")!;
  const port = dialog.querySelector<HTMLElement>(".fw-prefs-port")!;
  const wirePaths = [...dialog.querySelectorAll<SVGPathElement>(".fw-prefs-wire path")];
  const foldRail = dialog.querySelector<HTMLButtonElement>("[data-prefs-rail-fold]")!;
  const secs = new Map([...pane.querySelectorAll<HTMLElement>("[data-prefs-sec]")].map((s) => [s.dataset.prefsSec!, s] as const));
  let current = SECTIONS[0][0];
  let wireRaf = 0;
  let spyRaf = 0;
  let spyMuted = 0;
  let wireD = "";
  let portY = Number.NaN;
  // the connector, as FormVis draws it: from the active tab's right edge along a trunk in the gap to the port on the
  // frame's left edge at the header divider; only the path data and the port's offset change
  const drawWire = () => {
    if (!dialog.open) return;
    const F = dialog.getBoundingClientRect();
    const tab = nav.querySelector<HTMLElement>(".fw-prefs-tab.is-active");
    if (!F.width || !tab) return;
    const N = nav.getBoundingClientRect();
    let T = tab.getBoundingClientRect();
    if (T.top < N.top || T.bottom > N.bottom) {
      nav.scrollTop += T.top < N.top ? T.top - N.top - 6 : T.bottom - N.bottom + 6;
      T = tab.getBoundingClientRect();
    }
    const R = railEl.getBoundingClientRect();
    const H = head.getBoundingClientRect();
    const py = Math.round(H.bottom - F.top);
    const sx = Math.round(T.right - F.left);
    const ty = Math.round(T.top - F.top + T.height / 2);
    const rr = R.right - F.left;
    const trunk = Math.round(rr - rr * 0.45);
    const dy = py - ty;
    const r = 10;
    const dir = dy > 0 ? 1 : -1;
    const d = Math.abs(dy) < 2 * r ? `M ${sx} ${ty} H ${trunk} V ${py} H -7` : `M ${sx} ${ty} H ${trunk - r} a ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${r} ${dir * r} V ${py - dir * r} a ${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${r} ${dir * r} H -7`;
    if (d !== wireD) {
      wireD = d;
      for (const p of wirePaths) p.setAttribute("d", d);
    }
    if (py !== portY) {
      portY = py;
      port.style.transform = `translateY(${py}px)`;
    }
  };
  const queueWire = () => {
    if (!wireRaf) wireRaf = requestAnimationFrame(() => ((wireRaf = 0), drawWire()));
  };
  const markSection = (id: string) => {
    if (current === id || !secs.has(id)) return;
    current = id;
    for (const [n, s] of secs) s.classList.toggle("is-current", n === id);
    for (const b of nav.querySelectorAll<HTMLElement>("[data-prefs-tab]")) {
      const on = b.dataset.prefsTab === id;
      b.classList.toggle("is-active", on);
      if (b.getAttribute("aria-selected") !== String(on)) b.setAttribute("aria-selected", String(on));
    }
    queueWire();
  };
  // the scroll spy: the last card whose top has passed the pane's top edge, the last card at the end of the scroll
  const queueSpy = () => {
    if (spyRaf) return;
    spyRaf = requestAnimationFrame(() => {
      spyRaf = 0;
      if (!pane.clientHeight || performance.now() < spyMuted) return;
      const edge = pane.getBoundingClientRect().top + 24;
      let best = "";
      let bestD = Infinity;
      if (pane.scrollHeight > pane.clientHeight + 4 && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) best = SECTIONS[SECTIONS.length - 1][0];
      else
        for (const [n, s] of secs) {
          const top = s.getBoundingClientRect().top;
          const dd = top <= edge ? edge - top : top - edge + 100000;
          if (dd < bestD) {
            bestD = dd;
            best = n;
          }
        }
      if (best) markSection(best);
    });
  };
  const foldSection = (id: string) => {
    const s = secs.get(id);
    if (!s) return;
    const folded = !s.classList.contains("is-folded");
    s.classList.toggle("is-folded", folded);
    s.querySelector<HTMLElement>("[data-prefs-body]")!.hidden = folded;
    s.querySelector(".fw-prefs-sechead")!.setAttribute("aria-expanded", String(!folded));
    queueWire();
    queueSpy();
  };
  const scrollToSection = (id: string, behavior: ScrollBehavior) => {
    const s = secs.get(id);
    if (!s) return;
    if (s.classList.contains("is-folded")) foldSection(id);
    markSection(id);
    spyMuted = performance.now() + 700;
    pane.scrollTo({ top: s.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 12, behavior });
  };
  let railCollapsed = read(RAIL_KEY) === "1";
  const paintRail = () => {
    dialog.classList.toggle("is-rail-collapsed", railCollapsed);
    const label = railCollapsed ? "Expand tabs" : "Collapse tabs";
    if (foldRail.title !== label) {
      foldRail.title = label;
      foldRail.setAttribute("aria-label", label);
    }
    foldRail.setAttribute("aria-expanded", String(!railCollapsed));
  };
  paintRail();
  foldRail.addEventListener("click", () => {
    railCollapsed = !railCollapsed;
    write(RAIL_KEY, railCollapsed ? "1" : "0");
    paintRail();
    queueWire();
  });
  pane.addEventListener("scroll", queueSpy, { passive: true });
  new ResizeObserver(queueWire).observe(dialog);
  window.addEventListener("resize", queueWire);
  // keys typed in the dialog stay in it (FormVis's Dialog): the window's shortcuts do not fire behind it
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  const field = (sel: string) => host.querySelector<HTMLInputElement>(sel);

  type Setter = (k: string, v: string | boolean) => void;
  // fill a select with another select's options (the status bar's output, the layout menu): the same list, the same store
  const mirror = (target: HTMLSelectElement | null, source: HTMLSelectElement | null) => {
    if (!target || !source) return;
    const want = [...source.options].map((o) => `${o.value}\u0000${o.textContent}`).join("\u0001");
    if (target.dataset.mirror !== want) {
      target.replaceChildren(...[...source.options].map((o) => new Option(o.textContent ?? "", o.value)));
      target.dataset.mirror = want;
    }
  };
  const stored = (key: string) => {
    try {
      return JSON.parse(read(key) ?? "null") as unknown;
    } catch {
      return null;
    }
  };
  const syncWorkspace = (set: Setter) => {
    mirror(pref<HTMLSelectElement>("layout"), host.querySelector<HTMLSelectElement>(".fw-layout-select"));
    set("layout", "");
    const kept = Number(read(HEIGHT_KEY));
    // what the dock opens to: the kept height, else the one it was last given, else the stylesheet's
    const given = parseFloat(host.querySelector<HTMLElement>(".fw-dock")?.style.getPropertyValue("--fw-dock-h") ?? "");
    set("dock-height", String(kept > 0 ? kept : Math.round(given || parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cv-editor-h")) || 300)));
    const saved = stored(PRESETS_KEY);
    const list = Array.isArray(saved) && saved.length === 5 && saved.every((z) => typeof z === "number" && z > 0) ? (saved as number[]) : DEFAULT_PRESETS;
    ZOOM_PRESET_KEYS.forEach((k, i) => set(k, String(list[i])));
  };
  const inputTarget = () => armedTrack() ?? engine.get("document").tracks[0]?.id ?? null;
  const syncDevices = (set: Setter) => {
    mirror(pref<HTMLSelectElement>("output"), host.querySelector<HTMLSelectElement>("[data-output]"));
    set("output", host.querySelector<HTMLSelectElement>("[data-output]")?.value ?? "browser");
    const select = pref<HTMLSelectElement>("input");
    if (!select) return;
    const want = inputDevices().map((d) => `${d.id}\u0000${d.label}`).join("\u0001");
    if (select.dataset.mirror !== want) {
      select.replaceChildren(new Option("Default input", ""), ...inputDevices().map((d) => new Option(d.label || d.id, d.id)));
      select.dataset.mirror = want;
    }
    const track = inputTarget();
    if (select.disabled !== !track) select.disabled = !track;
    set("input", track ? trackInput(track) : "");
  };
  const syncQuantize = (set: Setter) => {
    const q = stored(INPUT_QUANTIZE_KEY) as { grid?: string; strength?: number; swing?: number; ends?: boolean } | null;
    set("iq-grid", q?.grid ?? "");
    set("iq-strength", String(Math.round((q?.strength ?? 1) * 100)));
    set("iq-swing", String(Math.round((q?.swing ?? 0) * 100)));
    set("iq-ends", q?.ends ? "ends" : "starts");
    for (const k of ["iq-strength", "iq-swing", "iq-ends"]) for (const el of dialog.querySelectorAll<HTMLInputElement>(`[data-pref="${k}"]`)) if (el.disabled !== !q) el.disabled = !q;
  };
  const writeQuantize = () => {
    const get = (k: string) => pref<HTMLInputElement>(k)?.value ?? "";
    try {
      if (!get("iq-grid")) localStorage.removeItem(INPUT_QUANTIZE_KEY);
      else localStorage.setItem(INPUT_QUANTIZE_KEY, JSON.stringify({ grid: get("iq-grid"), strength: Math.min(100, Math.max(0, Number(get("iq-strength")) || 0)) / 100, swing: Math.min(100, Math.max(0, Number(get("iq-swing")) || 0)) / 100, ends: get("iq-ends") === "ends" }));
    } catch {
      /* storage blocked: this visit only */
    }
  };
  const applyMotion = () => document.body.classList.toggle("animations-disabled", read(MOTION_KEY) === "1");
  const system = window.matchMedia?.("(prefers-color-scheme: light)");
  const followSystem = () => {
    if (read(SYSTEM_KEY) !== "1" || !system) return;
    const now = readChoice().theme;
    if (system.matches && !LIGHT.has(now)) {
      write(DARK_KEY, now);
      setTheme("light");
    } else if (!system.matches && LIGHT.has(now)) setTheme(read(DARK_KEY) || "studio");
  };
  system?.addEventListener?.("change", followSystem);
  applyMotion();
  followSystem();

  const sync = () => {
    const choice = readChoice();
    const set = (k: string, v: string | boolean) => {
      // a slider and its number box carry the same key: both are set, the one being typed in is left alone
      for (const el of dialog.querySelectorAll<HTMLInputElement>(`[data-pref="${k}"]`)) {
        if (typeof v === "boolean") {
          if (el.checked !== v) el.checked = v;
        } else if (el.value !== v && el !== document.activeElement) el.value = v;
      }
    };
    for (const t of dialog.querySelectorAll<HTMLElement>("[data-theme-pick]")) {
      const on = String(t.dataset.themePick === choice.theme);
      if (t.getAttribute("aria-checked") !== on) t.setAttribute("aria-checked", on);
    }
    syncWorkspace(set);
    syncDevices(set);
    syncQuantize(set);
    set("home", homeAtLaunch());
    set("theme", choice.theme);
    set("system", read(SYSTEM_KEY) === "1");
    set("accent", choice.accentColor);
    set("intensity", String(Math.round((choice.intensity ?? 1) * 100)));
    set("language", language());
    set("motion", read(MOTION_KEY) === "1");
    set("latency", field("[data-latency]")?.value ?? "0");
    set("preroll", field("[data-preroll]")?.value ?? "0");
    set("postroll", field("[data-postroll]")?.value ?? "0");
    set("clock", clockMode());
    set("pane-media", host.querySelector('.fw-panel-toggle[data-pane="media"]')?.getAttribute("aria-pressed") === "true");
    set("pane-editor", host.querySelector('.fw-panel-toggle[data-pane="editor"]')?.getAttribute("aria-pressed") === "true");
  };
  // the kept autosave and the plug-ins found, read from the engine each time the dialog opens
  const refreshStates = async (rescan = false) => {
    const say = (sel: string, text: string) => {
      const el = dialog.querySelector<HTMLElement>(sel);
      if (el && el.textContent !== text) el.textContent = text;
    };
    try {
      const kept = (await (await fetch("/api/autosave")).json()) as { exists: boolean; name?: string; tracks?: number; savedAt?: number };
      say("[data-prefs-autosave]", kept.exists ? `${kept.name ?? "Untitled session"}: ${kept.tracks ?? 0} tracks, kept ${new Date((kept.savedAt ?? 0) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Nothing kept");
      const discard = dialog.querySelector<HTMLButtonElement>('[data-prefs-act="autosave-discard"]');
      if (discard && discard.disabled === kept.exists) discard.disabled = !kept.exists;
    } catch {
      say("[data-prefs-autosave]", "");
    }
    const scan = dialog.querySelector<HTMLButtonElement>('[data-prefs-act="plugins-scan"]');
    try {
      if (scan) scan.disabled = true;
      const found = (await (await fetch(`/api/plugins${rescan ? "?refresh=1" : ""}`)).json()) as { plugins?: unknown[] };
      const n = found.plugins?.length ?? 0;
      say("[data-prefs-plugins]", n === 1 ? "1 plug-in found" : `${n} plug-ins found`);
    } catch {
      say("[data-prefs-plugins]", "");
    } finally {
      if (scan) scan.disabled = false;
    }
  };
  const open = (section?: string) => {
    void refreshInputs(false);
    void refreshStates();
    sync();
    if (!dialog.open) {
      dialog.showModal();
      // focus goes to the first field (FormVis's Dialog.open), else to Done
      (pane.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), select:not(:disabled)") ?? dialog.querySelector<HTMLElement>(".fw-prefs-done"))?.focus({ preventScroll: true });
    }
    if (typeof section === "string" && secs.has(section)) scrollToSection(section, "auto");
    modelsKeys.start();
    queueWire();
  };
  dialog.addEventListener("close", () => modelsKeys.stop());
  const toField = (sel: string, value: string) => {
    const f = field(sel);
    if (!f) return;
    f.value = value;
    f.dispatchEvent(new Event("change", { bubbles: true }));
  };
  dialog.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.pref;
    if (k === "home") setHomeAtLaunch(el.checked);
    else if (k === "theme") setTheme(el.value);
    else if (k === "system") {
      write(SYSTEM_KEY, el.checked ? "1" : "0");
      followSystem();
    } else if (k === "accent") setAccent(el.value);
    else if (k === "language") void setLanguage(el.value);
    else if (k === "motion") {
      write(MOTION_KEY, el.checked ? "1" : "0");
      applyMotion();
    } else if (k === "clock") setClockMode(el.value as ClockMode);
    else if (k === "pane-media" || k === "pane-editor") {
      const toggle = host.querySelector<HTMLElement>(`.fw-panel-toggle[data-pane="${k.slice(5)}"]`);
      if (toggle && (toggle.getAttribute("aria-pressed") === "true") !== el.checked) toggle.click();
    } else if (k === "latency") toField("[data-latency]", el.value);
    else if (k === "preroll") toField("[data-preroll]", el.value);
    else if (k === "postroll") toField("[data-postroll]", el.value);
    else if (k === "layout") {
      const source = host.querySelector<HTMLSelectElement>(".fw-layout-select");
      if (source && el.value) {
        source.value = el.value;
        source.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (k === "output") {
      const source = host.querySelector<HTMLSelectElement>("[data-output]");
      if (source) {
        source.value = el.value;
        source.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (k === "input") {
      const track = inputTarget();
      if (track) setTrackInput(track, el.value);
    } else if (k === "dock-height") host.dispatchEvent(new CustomEvent("fw-dock-height", { detail: Number(el.value) }));
    else if (k && ZOOM_PRESET_KEYS.includes(k)) host.dispatchEvent(new CustomEvent("fw-zoom-presets", { detail: ZOOM_PRESET_KEYS.map((key) => Number(pref(key)?.value)) }));
    else if (k?.startsWith("iq-")) writeQuantize();
    sync();
  });
  dialog.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.pref;
    // a slider and its number box follow each other as either moves
    if (k && (el.type === "range" || el.type === "number")) for (const twin of dialog.querySelectorAll<HTMLInputElement>(`[data-pref="${k}"]`)) if (twin !== el && twin.value !== el.value) twin.value = el.value;
    if (k === "intensity") setIntensity(Number(el.value) / 100);
  });
  dialog.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === dialog) {
      // a click on the dialog element itself outside its frame is the backdrop's
      const r = dialog.getBoundingClientRect();
      const ev = e as MouseEvent;
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) dialog.close();
      return;
    }
    const tab = t.closest<HTMLElement>("[data-prefs-tab]")?.dataset.prefsTab;
    // the pane alone scrolls (scrollIntoView would scroll the dialog's own box too and hide its head)
    if (tab) return scrollToSection(tab, "smooth");
    const fold = t.closest<HTMLElement>("[data-prefs-fold]")?.dataset.prefsFold;
    if (fold) return foldSection(fold);
    const pick = t.closest<HTMLElement>("[data-theme-pick]")?.dataset.themePick;
    if (pick) {
      setTheme(pick);
      sync();
      return;
    }
    const proxied = t.closest<HTMLElement>("[data-prefs-click]")?.dataset.prefsClick;
    if (proxied) {
      dialog.close();
      host.querySelector<HTMLElement>(proxied)?.click();
      return;
    }
    const act = t.closest<HTMLElement>("[data-prefs-act]")?.dataset.prefsAct;
    if (!act) return;
    if (act === "done") dialog.close();
    else if (act === "accent-default") {
      setAccent(DEFAULT_ACCENT);
      sync();
    } else if (act === "autosave-discard") {
      void fetch("/api/autosave", { method: "DELETE" }).then(() => refreshStates(), () => undefined);
    } else if (act === "plugins-scan") {
      void refreshStates(true);
    } else if (act === "reset") {
      if (!window.confirm("Reset every preference of this window to its default? Saved sessions are kept.")) return;
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith("formwav.") || key === "nodemode_ui_settings") localStorage.removeItem(key);
      } catch {
        /* storage blocked: nothing kept to reset */
      }
      location.reload();
    } else {
      dialog.close();
      if (act === "shortcuts") host.dispatchEvent(new CustomEvent("fw-shortcuts"));
      else if (act === "palette") host.dispatchEvent(new CustomEvent("fw-palette"));
      else if (act === "agents" || act === "devices") host.querySelector<HTMLElement>(`.fw-settings-pop [data-action="${act}"]`)?.click();
    }
  });
  document.addEventListener("nm:ui-settings-changed", () => dialog.open && sync());
  onInputsChanged(() => dialog.open && sync());
  onLanguage(() => dialog.open && sync());

  // Settings > Preferences…, first in the Settings menu
  const item = document.createElement("button");
  item.className = "fw-ibtn";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.dataset.action = "preferences";
  item.dataset.cmd = "settings"; // the command `settings`: Cmd or Ctrl comma, the gear, the app menu and Start's row run it
  item.title = "Theme, language, recording and every other setting (Cmd or Ctrl comma)";
  item.innerHTML = "<span>Preferences…</span><kbd>⌘,</kbd>";
  host.querySelector(".fw-settings-pop")?.prepend(item);
  item.addEventListener("click", () => open());
  host.addEventListener("fw-preferences", (e) => open((e as CustomEvent<unknown>).detail as string | undefined));
  host.addEventListener("fw-desktop-menu", (e) => {
    if ((e as CustomEvent<string>).detail === "preferences") open();
  });
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ",") {
      e.preventDefault();
      open();
    }
  });
}
