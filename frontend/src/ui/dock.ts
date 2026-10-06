/**
 * The bottom dock (formai-design-lang panel-architect): Mixer, Terminal and Agent share one tabbed dock above the
 * transport instead of stacking over the lanes. The modules keep their own logic: each panel's `hidden` flag stays the
 * source of truth and each keeps its toggle (the View chip, the title-bar buttons, the X key). The dock adopts the
 * panels and watches their `hidden` flag: a panel that opens is shown on its tab and any other open panel is hidden
 * the way its module hides it (the flag and its toggle's aria-pressed, nothing torn down, so a terminal session
 * survives a tab switch); a tab opens its panel through the module's own toggle, so the terminal still refits and takes
 * focus. The dock's height is dragged from its top edge and kept for the next visit.
 */
import { icon as fvIcon } from "../vendor/formvis/icons";

const HEIGHT_KEY = "formwav.dockHeight";
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

export function mountDock(host: HTMLElement): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const transport = pane?.querySelector<HTMLElement>(".fw-dock-anchor");
  if (!pane || !transport) return;
  const dock = document.createElement("section");
  dock.className = "fw-dock";
  dock.hidden = true;
  dock.setAttribute("aria-label", "Dock");
  dock.innerHTML = `<div class="fw-dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the dock" tabindex="0"></div><div class="fw-dock-head"><span class="fw-dock-tabs" role="tablist"></span><button type="button" class="fw-icon-btn fw-dock-close" aria-label="Close the dock" title="Close the dock">${fvIcon("close", 14)}</button></div><div class="fw-dock-body"></div>`;
  transport.before(dock);
  const tabs = dock.querySelector<HTMLElement>(".fw-dock-tabs") as HTMLElement;
  const body = dock.querySelector<HTMLElement>(".fw-dock-body") as HTMLElement;
  const grip = dock.querySelector<HTMLElement>(".fw-dock-grip") as HTMLElement;

  // The Inspector is the editor's first tab (the approved target): its toggle flips its hidden flag, as each other
  // panel's module does, so the dock's one-at-a-time rule and tabs treat it like them
  const inspector = host.querySelector<HTMLElement>(".fw-pane-inspector");
  const inspectorToggle = host.querySelector<HTMLButtonElement>(".fw-tool-tray [data-inspector]");
  inspectorToggle?.addEventListener("click", () => {
    if (!inspector) return;
    inspector.hidden = !inspector.hidden;
    inspectorToggle.setAttribute("aria-pressed", String(!inspector.hidden));
  });
  const wanted: Array<[string, string, string, string]> = [
    ["inspector", "Inspector", ".fw-pane-inspector", ".fw-tool-tray [data-inspector]"],
    ["effects", "Effects", ".fw-chain", ".fw-tool-tray [data-chain]"],
    ["synth", "Synth", ".fw-synth", ".fw-tool-tray [data-synth]"],
    ["pads", "Pads", ".fw-pads", ".fw-tool-tray [data-pads]"],
    ["mixer", "Mixer", ".fw-mixer", '.fw-tool-tray .fw-mode[title^="Show the mixer"]'],
    ["terminal", "Terminal", ".fw-term:not(.fw-agent)", '[data-action="terminal"]'],
    ["notes", "Notes", ".fw-piano", ".fw-tool-tray .fw-mode[data-piano]"],
    ["spectrum", "Spectrum", ".fw-spectrum", ".fw-tool-tray .fw-mode[data-spectrum]"],
  ];
  const docked: Docked[] = [];
  for (const [id, label, panelSel, toggleSel] of wanted) {
    const panel = host.querySelector<HTMLElement>(panelSel);
    const toggle = host.querySelector<HTMLButtonElement>(toggleSel);
    if (!panel || !toggle) continue;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "fw-dock-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.textContent = label;
    tabs.append(tab);
    body.append(panel);
    docked.push({ id, label, panel, toggle, tab });
  }
  if (docked.length === 0) return;

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
      const on = d === shown;
      if (d.tab.getAttribute("aria-selected") !== String(on)) d.tab.setAttribute("aria-selected", String(on));
    }
    if (dock.hidden !== !shown) dock.hidden = !shown;
  };
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
  const floatButton = document.createElement("button");
  floatButton.type = "button";
  floatButton.className = "fw-ibtn fw-dock-float";
  floatButton.textContent = "Float";
  floatButton.title = "Float this panel in its own window (its Dock button puts it back)";
  dock.querySelector(".fw-dock-close")?.before(floatButton);
  floatButton.addEventListener("click", () => {
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
  sync();
}
