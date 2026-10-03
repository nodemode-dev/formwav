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

interface Docked {
  id: string;
  label: string;
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  tab: HTMLButtonElement;
}

export function mountDock(host: HTMLElement): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const transport = pane?.querySelector<HTMLElement>(".fw-transport");
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

  const wanted: Array<[string, string, string, string]> = [
    ["mixer", "Mixer", ".fw-mixer", '.fw-tool-tray .fw-mode[title^="Show the mixer"]'],
    ["terminal", "Terminal", ".fw-term:not(.fw-agent)", '[data-action="terminal"]'],
    ["agent", "Agent", ".fw-agent", '[data-action="agent"]'],
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

  const sync = (opened?: Docked) => {
    if (opened) {
      for (const other of docked) {
        if (other !== opened && !other.panel.hidden) {
          other.panel.hidden = true;
          other.toggle.setAttribute("aria-pressed", "false");
        }
      }
    }
    const shown = docked.find((d) => !d.panel.hidden);
    for (const d of docked) {
      const on = d === shown;
      if (d.tab.getAttribute("aria-selected") !== String(on)) d.tab.setAttribute("aria-selected", String(on));
    }
    if (dock.hidden !== !shown) dock.hidden = !shown;
  };
  for (const d of docked) {
    new MutationObserver(() => sync(d.panel.hidden ? undefined : d)).observe(d.panel, { attributes: true, attributeFilter: ["hidden"] });
    d.tab.addEventListener("click", () => {
      if (d.panel.hidden) d.toggle.click();
    });
  }
  dock.querySelector(".fw-dock-close")?.addEventListener("click", () => docked.find((d) => !d.panel.hidden)?.toggle.click());

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
