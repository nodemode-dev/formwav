/**
 * The bottom editor of the agreed canvas: Clip, Effects, Mixer, Synth, Pads, Spectrum and Transcript as tabs, the
 * Inspector, Notes, Labels and Terminal under More, what the open tab works on and Ask the agent at the right, and the
 * header's editor toggle. The modules keep their own logic: each panel's `hidden` flag stays the
 * source of truth and each keeps its toggle (the View chip, the title-bar buttons, the X key). The dock adopts the
 * panels and watches their `hidden` flag: a panel that opens is shown on its tab and any other open panel is hidden
 * the way its module hides it (the flag and its toggle's aria-pressed, nothing torn down, so a terminal session
 * survives a tab switch); a tab opens its panel through the module's own toggle, so the terminal still refits and takes
 * focus. The dock's height is dragged from its top edge and kept for the next visit.
 */
import type { Engine } from "../engine";
import { icon as fvIcon } from "../vendor/formvis/icons";
import { mountMenu } from "./file-menu";

const HEIGHT_KEY = "formwav.editorHeight";
const MORE = new Set(["inspector", "notes", "labels", "terminal"]);
export const LANE_COLORS = ["cyan", "violet", "amber", "pink", "slate", "green", "blue", "red"];
const FLOAT_KEY = "formwav.floating";

/** A floating panel and its window's place (AU-08, AU-09). */
export interface FloatState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
let floatingNow: () => FloatState[] = () => [];
let setFloating: (list: FloatState[]) => void = () => undefined;
/** AU-09: the panels floating now and their places, for a saved layout. */
export function dockFloating(): FloatState[] {
  return floatingNow();
}
/** AU-09: float exactly these panels at these places; any other floating panel goes back to the dock. */
export function applyDockFloating(list: FloatState[]): void {
  setFloating(list);
}

interface Docked {
  id: string;
  label: string;
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  tab: HTMLButtonElement;
}

export function mountDock(host: HTMLElement, engine: Engine): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const transport = pane?.querySelector<HTMLElement>(".fw-dock-anchor");
  if (!pane || !transport) return;
  const dock = document.createElement("section");
  dock.className = "fw-dock";
  dock.hidden = true;
  dock.setAttribute("aria-label", "Dock");
  dock.innerHTML = `<div class="fw-dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the editor" tabindex="0"></div><div class="fw-dock-head"><span class="fw-dock-tabs" role="tablist" aria-label="Editor"></span><div class="fw-menu fw-dock-more"><button type="button" class="fw-menu-btn fw-dock-tab" aria-haspopup="menu" aria-expanded="false"><span class="fw-dock-more-label">More</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button><div class="cv-menu fw-menu-pop" role="menu" aria-label="More panels" hidden></div></div><span class="fw-dock-context"><span class="fw-dock-who"><span class="fw-dock-swatch" aria-hidden="true"></span><span class="fw-dock-track"></span></span><span class="fw-dock-detail"></span></span><button type="button" class="fw-ibtn fw-dock-ask" data-ask-agent="">Ask the agent</button><button type="button" class="fw-icon-btn fw-dock-close" aria-label="Close the editor" title="Close the editor">${fvIcon("close", 14)}</button></div><div class="fw-dock-body"></div>`;
  transport.before(dock);
  const tabs = dock.querySelector<HTMLElement>(".fw-dock-tabs") as HTMLElement;
  const body = dock.querySelector<HTMLElement>(".fw-dock-body") as HTMLElement;
  const grip = dock.querySelector<HTMLElement>(".fw-dock-grip") as HTMLElement;
  const moreRoot = dock.querySelector<HTMLElement>(".fw-dock-more") as HTMLElement;
  const morePop = moreRoot.querySelector<HTMLElement>(".fw-menu-pop") as HTMLElement;
  const moreLabel = moreRoot.querySelector<HTMLElement>(".fw-dock-more-label");

  // The Inspector, the transcript and the labels open from the editor's tabs: each toggle flips its panel's hidden
  // flag, as each other panel's module does, so the dock's one-at-a-time rule and tabs treat them like the rest
  for (const [panelSel, toggleSel] of [[".fw-pane-inspector", "[data-inspector]"], [".fw-transcript-panel", "[data-transcript]"], [".fw-labels-panel", "[data-labels]"]]) {
    const panel = host.querySelector<HTMLElement>(panelSel);
    const toggle = host.querySelector<HTMLButtonElement>(`.fw-tool-tray ${toggleSel}`);
    toggle?.addEventListener("click", () => {
      if (!panel) return;
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-pressed", String(!panel.hidden));
    });
  }
  const wanted: Array<[string, string, string, string]> = [
    ["clip", "Clip", ".fw-cliptab", ".fw-tool-tray [data-cliptab]"],
    ["effects", "Effects", ".fw-editor-panel.fw-chain", ".fw-tool-tray [data-chain]"],
    ["mixer", "Mixer", ".fw-mixer", '.fw-tool-tray .fw-mode[title^="Show the mixer"]'],
    ["synth", "Synth", ".fw-synth", ".fw-tool-tray [data-synth]"],
    ["pads", "Pads", ".fw-pads", ".fw-tool-tray [data-pads]"],
    ["spectrum", "Spectrum", ".fw-spectrum", ".fw-tool-tray .fw-mode[data-spectrum]"],
    ["transcript", "Transcript", ".fw-transcript-panel", ".fw-tool-tray [data-transcript]"],
    ["inspector", "Inspector", ".fw-pane-inspector", ".fw-tool-tray [data-inspector]"],
    ["notes", "Notes", ".fw-piano", ".fw-tool-tray .fw-mode[data-piano]"],
    ["labels", "Labels", ".fw-labels-panel", ".fw-tool-tray [data-labels]"],
    ["terminal", "Terminal", ".fw-term:not(.fw-agent)", '[data-action="terminal"]'],
  ];
  const docked: Docked[] = [];
  for (const [id, label, panelSel, toggleSel] of wanted) {
    const panel = host.querySelector<HTMLElement>(panelSel);
    const toggle = host.querySelector<HTMLButtonElement>(toggleSel);
    if (!panel || !toggle) continue;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.panel = id;
    if (MORE.has(id)) {
      tab.className = "fw-ibtn";
      tab.setAttribute("role", "menuitemradio");
      tab.setAttribute("aria-checked", "false");
      tab.innerHTML = `<span class="fw-check" aria-hidden="true"></span><span></span>`;
      (tab.lastElementChild as HTMLElement).textContent = label;
      morePop.append(tab);
    } else {
      tab.className = "fw-dock-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.dataset.label = label;
      tab.textContent = label;
      tabs.append(tab);
    }
    body.append(panel);
    docked.push({ id, label, panel, toggle, tab });
  }
  if (docked.length === 0) return;
  const floatItem = document.createElement("button");
  floatItem.type = "button";
  floatItem.className = "fw-ibtn";
  floatItem.setAttribute("role", "menuitem");
  floatItem.innerHTML = `<span></span><span>Float this panel</span>`;
  floatItem.title = "Float the open panel in its own window (its Dock button puts it back)";
  morePop.append(Object.assign(document.createElement("span"), { className: "fw-menu-sep" }), floatItem);
  mountMenu(moreRoot);
  const editorToggle = host.querySelector<HTMLButtonElement>('.fw-panel-toggle[data-pane="editor"]');
  let lastShown = "clip";

  // AU-08: panels floated out of the dock (id to window); they are left out of the dock's one-at-a-time rule
  const floating = new Map<string, HTMLElement>();
  const inDock = () => docked.filter((d) => !floating.has(d.id));
  const sync = (opened?: Docked) => {
    if (opened && floating.has(opened.id)) opened = undefined;
    if (opened) {
      for (const other of inDock()) {
        if (other !== opened && !other.panel.hidden) {
          other.panel.hidden = true;
          other.toggle.setAttribute("aria-pressed", "false");
        }
      }
    }
    const shown = inDock().find((d) => !d.panel.hidden);
    for (const d of docked) {
      const on = String(d === shown);
      const attr = MORE.has(d.id) ? "aria-checked" : "aria-selected";
      if (d.tab.getAttribute(attr) !== on) d.tab.setAttribute(attr, on);
    }
    const inMore = !!shown && MORE.has(shown.id);
    if (moreRoot.classList.contains("is-active") !== inMore) moreRoot.classList.toggle("is-active", inMore);
    if (moreLabel) {
      const label = inMore && shown ? shown.label : "More";
      if (moreLabel.textContent !== label) moreLabel.textContent = label;
    }
    if (shown) lastShown = shown.id;
    if (editorToggle && editorToggle.getAttribute("aria-pressed") !== String(!!shown)) editorToggle.setAttribute("aria-pressed", String(!!shown));
    if (dock.hidden !== !shown) dock.hidden = !shown;
    host.dispatchEvent(new CustomEvent("fw-editor-tab", { detail: shown?.id ?? null }));
  };
  editorToggle?.addEventListener("click", () => {
    const shown = inDock().find((d) => !d.panel.hidden);
    if (shown) shown.toggle.click();
    else (docked.find((d) => d.id === lastShown && !floating.has(d.id)) ?? docked[0]).toggle.click();
  });
  for (const d of docked) {
    new MutationObserver(() => {
      const win = floating.get(d.id);
      if (win) {
        if (win.hidden !== d.panel.hidden) win.hidden = d.panel.hidden;
        return;
      }
      sync(d.panel.hidden ? undefined : d);
    }).observe(d.panel, { attributes: true, attributeFilter: ["hidden"] });
    d.tab.addEventListener("click", () => {
      if (d.panel.hidden) d.toggle.click();
    });
  }
  dock.querySelector(".fw-dock-close")?.addEventListener("click", () => docked.find((d) => !d.panel.hidden)?.toggle.click());

  // AU-08, AU-09: Float puts the dock's shown panel in its own window (dragged by its title, resized from its corner,
  // several at once) and its Dock button returns it; the floating set and places are kept, and saved layouts carry them
  const keep = () => {
    try {
      localStorage.setItem(FLOAT_KEY, JSON.stringify(floatingState()));
    } catch {
      /* not kept */
    }
  };
  const floatingState = (): FloatState[] => [...floating.entries()].map(([id, win]) => ({ id, x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight }));
  const dockBack = (d: Docked) => {
    const win = floating.get(d.id);
    if (!win) return;
    floating.delete(d.id);
    body.append(d.panel);
    win.remove();
    if (d.tab.hidden) d.tab.hidden = false;
    sync(d.panel.hidden ? undefined : d);
    keep();
  };
  const place = (win: HTMLElement, at: FloatState) => {
    win.style.width = `${Math.max(280, at.w)}px`;
    win.style.height = `${Math.max(160, at.h)}px`;
    win.style.left = `${Math.max(0, Math.min(at.x, window.innerWidth - 80))}px`;
    win.style.top = `${Math.max(0, Math.min(at.y, window.innerHeight - 40))}px`;
  };
  const float = (d: Docked, at?: FloatState, open = true) => {
    if (floating.has(d.id)) return;
    const win = document.createElement("section");
    win.className = "fw-float";
    win.dataset.panel = d.id;
    win.setAttribute("aria-label", `${d.label}, floating`);
    win.innerHTML = `<div class="fw-float-head"><span class="fw-float-title"></span><button type="button" class="fw-ibtn" data-float="dock" title="Put this panel back in the dock">Dock</button></div><div class="fw-float-body"></div>`;
    const title = win.querySelector<HTMLElement>(".fw-float-title");
    if (title) title.textContent = d.label;
    floating.set(d.id, win);
    win.querySelector<HTMLElement>(".fw-float-body")?.append(d.panel);
    host.append(win);
    place(win, at ?? { id: d.id, x: (window.innerWidth - 560) / 2, y: 96, w: 560, h: 320 });
    d.tab.hidden = true;
    win.hidden = d.panel.hidden;
    if (open && d.panel.hidden) d.toggle.click();
    win.querySelector('[data-float="dock"]')?.addEventListener("click", () => dockBack(d));
    const head = win.querySelector<HTMLElement>(".fw-float-head");
    head?.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const sx = e.clientX - win.offsetLeft;
      const sy = e.clientY - win.offsetTop;
      const move = (ev: PointerEvent) => {
        win.style.left = `${Math.max(0, ev.clientX - sx)}px`;
        win.style.top = `${Math.max(0, ev.clientY - sy)}px`;
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        keep();
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });
    new ResizeObserver(() => keep()).observe(win);
    sync();
    keep();
  };
  floatItem.addEventListener("click", () => {
    const shown = inDock().find((d) => !d.panel.hidden);
    if (shown) float(shown);
  });
  floatingNow = floatingState;
  setFloating = (list) => {
    for (const d of docked) if (floating.has(d.id) && !list.some((s) => s.id === d.id)) dockBack(d);
    for (const s of list) {
      const d = docked.find((x) => x.id === s.id);
      const win = d ? floating.get(d.id) : undefined;
      if (win) place(win, s);
      else if (d) float(d, s);
    }
    keep();
  };
  try {
    // last visit's floating panels come back floating, closed until opened through their own toggles
    for (const s of JSON.parse(localStorage.getItem(FLOAT_KEY) ?? "[]") as FloatState[]) {
      const d = docked.find((x) => x.id === s.id);
      if (d) float(d, s, false);
    }
  } catch {
    /* nothing kept */
  }

  // Height: dragged from the top edge, clamped between 140 px and 75 percent of the timeline pane, kept between visits.
  const setHeight = (px: number) => {
    const clamped = Math.round(Math.max(140, Math.min(px, pane.clientHeight * 0.75)));
    dock.style.setProperty("--fw-dock-h", `${clamped}px`);
    return clamped;
  };
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY));
    if (saved > 0) setHeight(saved);
  } catch {
    /* storage unavailable: the default height */
  }
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = dock.getBoundingClientRect().height;
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = setHeight(startH + (startY - ev.clientY));
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(last));
      } catch {
        /* not kept */
      }
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });

  // The head's right: what the open tab works on (the selected clip's track, or the live instrument) and Ask the agent
  const swatch = dock.querySelector<HTMLElement>(".fw-dock-swatch");
  const trackName = dock.querySelector<HTMLElement>(".fw-dock-track");
  const detail = dock.querySelector<HTMLElement>(".fw-dock-detail");
  const ask = dock.querySelector<HTMLElement>(".fw-dock-ask");
  let selected: string[] = [];
  let tab: string | null = null;
  const put = (el: HTMLElement | null, text: string) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  const context = () => {
    const doc = engine.get("document");
    const index = doc.tracks.findIndex((t) => t.clips.some((c) => selected.includes(c.id)));
    const track = doc.tracks[index];
    const clip = track?.clips.find((c) => selected.includes(c.id));
    const fx = (track?.fx ?? []).filter((f) => !f.bypass).length;
    const color = track ? `var(--fw-color-${track.color ?? LANE_COLORS[index % LANE_COLORS.length]})` : "transparent";
    if (swatch && swatch.style.background !== color) swatch.style.background = color;
    if (tab === "synth" || tab === "pads") {
      if (swatch && swatch.style.background !== "var(--accent-color)") swatch.style.background = "var(--accent-color)";
      put(trackName, "Live instrument");
      put(detail, doc.synth?.name ?? "Soft triangle");
    } else if (track && clip) {
      put(trackName, track.name);
      put(detail, `${clip.name ?? (doc.media[clip.mediaId]?.name ?? "clip").replace(/\.[^.]+$/, "")}, ${fx === 0 ? "no effects" : fx === 1 ? "one effect live" : `${fx} effects live`}`);
    } else {
      put(trackName, "");
      put(detail, "No clip selected");
    }
    if (ask) ask.dataset.askAgent = track ? `On ${track.name}${clip ? `, ${(doc.media[clip.mediaId]?.name ?? "this clip").replace(/\.[^.]+$/, "")}` : ""}: ` : "";
  };
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail ?? [];
    context();
  });
  host.addEventListener("fw-editor-tab", (e) => {
    tab = (e as CustomEvent<string | null>).detail;
    context();
  });
  ask?.addEventListener("click", () => host.dispatchEvent(new CustomEvent("fw-ask-agent", { detail: ask.dataset.askAgent ?? "" })));
  engine.subscribe("document", context);
  sync();
  context();
}
