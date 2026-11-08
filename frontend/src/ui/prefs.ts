import { icon as fvIcon } from "../vendor/formvis/icons";
import { DEFAULT_ACCENT, readChoice, setAccent, setIntensity, setTheme, THEMES } from "../vendor/formvis/themes";
import { homeAtLaunch, setHomeAtLaunch } from "./home";
import { language, LANGUAGES, onLanguage, setLanguage } from "./i18n";
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
  ["keys", "Keys and Models", "lock"],
  ["models", "Models on this computer", "download"],
  ["agents", "Agents", "link"],
];

const row = (label: string, hint: string, control: string) =>
  `<div class="fw-prefs-row"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label">${label}</span><span class="fw-prefs-row-hint">${hint}</span></div><div class="fw-prefs-row-ctl">${control}</div></div>`;
const check = (key: string, label: string) => `<label class="fw-prefs-check"><input type="checkbox" data-pref="${key}"><span>${label}</span></label>`;
const num = (key: string, min: number, max: number, step: number, unit: string, label: string) =>
  `<label class="fw-prefs-num"><input type="number" data-pref="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><span>${unit}</span></label>`;
const btn = (act: string, label: string) => `<button type="button" class="fw-prefs-btn" data-prefs-act="${act}">${label}</button>`;

/**
 * Preferences (formvis's SettingsDialog, the SETTINGS map): one dialog built once at start, a rail of sections on the
 * left and their cards stacked on the right, the rail following the scroll (scroll spy) and a tab scrolling its card
 * into view. Opened by Settings > Preferences, Cmd or Ctrl comma, Home's Preferences, and the desktop app's menu.
 * Rows read the setting each time the dialog opens and write it at once: the theme and accent through the family's
 * theme store, the language through i18n, Home at launch, reduced motion and following the system's appearance as
 * formwav keys; the recording rows are the transport's own fields (latency, pre-roll, post-roll), written there so
 * there is one path; the agents and devices rows open their dialogs.
 */
export function mountPreferences(host: HTMLElement): void {
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
      row("Theme", "The colours of every surface", `<select data-pref="theme" aria-label="Theme" translate="no">${themeOptions}</select>`) +
      row("Follow the system", "Switch between the light theme and your dark one with the computer's appearance", check("system", "Follow the system's appearance")) +
      row("Accent colour", "Buttons, selection and focus", `<span class="fw-prefs-accent"><input type="color" data-pref="accent" aria-label="Accent colour">${btn("accent-default", "Default")}</span>`) +
      row("Accent strength", "How strongly the accent tints surfaces", `<input type="range" data-pref="intensity" min="0" max="150" step="5" aria-label="Accent strength">`) +
      group("Language and motion") +
      row("Language", "The language of the interface; English is the default", `<select data-pref="language" aria-label="Language" translate="no">${langOptions}</select>`) +
      row("Reduce motion", "Turn off transitions and animations", check("motion", "Reduce motion")) +
      group("Counters") +
      row("Main counter", "The timebase of the counter and the ruler", `<select data-pref="clock" aria-label="Main counter">${clockOptions}</select>`),
    workspace:
      group("Panels") +
      row("Browser", "The media browser beside the tracks", check("pane-media", "Show the browser")) +
      row("Editor", "The editor panel under the tracks", check("pane-editor", "Show the editor")),
    audio:
      group("Output") +
      row("Output", "Where playback is heard: choose it in the status bar's output menu", "") +
      group("Input") +
      row("Recording input", "Each track records from its own input, chosen on the track", ""),
    recording:
      group("Timing") +
      row("Recording latency", "How far a take is moved back to line up with what was playing", num("latency", 0, 500, 1, "ms", "Recording latency in milliseconds")) +
      row("Pre-roll", "How long recording rolls before the punch point", num("preroll", 0, 10, 0.5, "s", "Pre-roll in seconds")) +
      row("Post-roll", "How long a punch keeps rolling after its out point", num("postroll", 0, 10, 0.5, "s", "Post-roll in seconds")),
    editing:
      group("Commands") +
      row("Keyboard shortcuts", "Every command with a key, by menu", btn("shortcuts", "Show shortcuts")) +
      row("Commands", "Find and run any command by name (Cmd or Ctrl K)", btn("palette", "Search commands")),
    files:
      group("Autosave and recovery") +
      row("Autosave", "The open session is kept every 30 seconds; after a crash, Recover or Discard is offered at the next start", "") +
      group("Cloud") +
      row("Google Drive and Dropbox", "Open a session from, or save it to, your cloud storage", proxy('[data-action="cloud"]', "Cloud…")),
    plugins:
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
  dialog.innerHTML = `<div class="fw-prefs-head"><h2 class="fw-prefs-title">Preferences</h2><button type="button" class="fw-prefs-done" data-prefs-act="done">Done</button><button type="button" class="fw-prefs-x" data-prefs-act="done" aria-label="Close" title="Close">${fvIcon("close", 14)}</button></div>
<div class="fw-prefs-body">
  <nav class="fw-prefs-rail" aria-label="Sections">${SECTIONS.map(([id, label, ic], i) => `<button type="button" class="fw-prefs-tab${i ? "" : " is-current"}" data-prefs-tab="${id}">${fvIcon(ic, 16)}<span>${label}</span></button>`).join("")}</nav>
  <div class="fw-prefs-pane">${SECTIONS.map(([id, label, ic]) => `<section class="fw-prefs-sec" data-prefs-sec="${id}"><h3 class="fw-prefs-sec-title">${fvIcon(ic, 16)}<span>${label}</span></h3>${cards[id]}</section>`).join("")}</div>
</div>`;
  host.append(dialog);
  const modelsKeys = mountModelsKeys(dialog);
  const pref =<T extends HTMLElement = HTMLInputElement>(k: string) => dialog.querySelector<T>(`[data-pref="${k}"]`);
  const pane = dialog.querySelector<HTMLElement>(".fw-prefs-pane")!;
  const field = (sel: string) => host.querySelector<HTMLInputElement>(sel);

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
      const el = pref(k);
      if (!el) return;
      if (typeof v === "boolean") {
        if ((el as HTMLInputElement).checked !== v) (el as HTMLInputElement).checked = v;
      } else if ((el as HTMLInputElement).value !== v) (el as HTMLInputElement).value = v;
    };
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
  const open = () => {
    sync();
    if (!dialog.open) dialog.showModal();
    modelsKeys.start();
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
    sync();
  });
  dialog.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.pref === "intensity") setIntensity(Number(el.value) / 100);
  });
  dialog.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === dialog) return dialog.close();
    const tab = t.closest<HTMLElement>("[data-prefs-tab]")?.dataset.prefsTab;
    // the pane alone scrolls (scrollIntoView would scroll the dialog's own clipped box too and hide its head)
    const sec = tab ? dialog.querySelector<HTMLElement>(`[data-prefs-sec="${tab}"]`) : null;
    if (sec) return pane.scrollTo({ top: pane.scrollTop + sec.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16 });
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
  // scroll spy: the rail marks the card whose top has passed the pane's top third
  pane.addEventListener("scroll", () => {
    const top = pane.getBoundingClientRect().top + pane.clientHeight / 3;
    let current = SECTIONS[0][0];
    for (const sec of pane.querySelectorAll<HTMLElement>("[data-prefs-sec]")) if (sec.getBoundingClientRect().top <= top) current = sec.dataset.prefsSec!;
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) current = SECTIONS[SECTIONS.length - 1][0];
    for (const b of dialog.querySelectorAll<HTMLElement>("[data-prefs-tab]")) b.classList.toggle("is-current", b.dataset.prefsTab === current);
  });
  document.addEventListener("nm:ui-settings-changed", () => dialog.open && sync());
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
  item.addEventListener("click", open);
  host.addEventListener("fw-preferences", open);
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
