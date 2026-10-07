/**
 * formcut's workspace behaviour (formcut v2.2.2 ui/workspace-layout.ts), for formwav's three panes: the dividers
 * resize Media and Inspector in pixels (a drag is a pixel gesture), the titlebar toggles show or hide them, and the
 * arrangement is remembered. Sizes are clamped on apply, so a narrow window cannot strand a pane or squeeze the timeline.
 */
const KEY = "formwav.panes";
const MIN_SIDE = 200;
const MIN_TIMELINE = 360;
const STEP = 16;

import { applyDockFloating, dockFloating, type FloatState } from "./dock";

interface Layout {
  media: number;
  inspector: number;
  showMedia: boolean;
  showInspector: boolean;
  /** AU-09: the panels a saved layout floats, and where. */
  floating?: FloatState[];
}
type Side = "media" | "inspector";

const DEFAULTS: Layout = { media: 240, inspector: 296, showMedia: true, showInspector: true };

function read(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Layout>) };
  } catch {
    /* private mode or a bad value: the defaults are right */
  }
  return { ...DEFAULTS };
}

export function mountWorkspaceLayout(host: HTMLElement): void {
  const ws = host.querySelector<HTMLElement>(".fw-workspace");
  if (!ws) return;
  let layout = read();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* storage refused: the layout still applies for this visit */
    }
  };
  const agent = ws.querySelector<HTMLElement>(".fw-pane-agent > .fw-agent");
  const shown = (side: Side) => (side === "media" ? layout.showMedia : !!agent && !agent.hidden);
  const clamp = (side: Side, width: number) => {
    const other: Side = side === "media" ? "inspector" : "media";
    const room = ws.clientWidth - 14 - (shown(other) ? layout[other] + 7 : 0) - 7 - MIN_TIMELINE;
    return Math.round(Math.max(MIN_SIDE, Math.min(width, Math.max(MIN_SIDE, room))));
  };
  const setVar = (name: string, value: string) => {
    if (ws.style.getPropertyValue(name) !== value) ws.style.setProperty(name, value);
  };
  const apply = () => {
    // One pane at a time, each against the other's current width, so resizing one never squeezes the other.
    layout = { ...layout, media: clamp("media", layout.media) };
    layout = { ...layout, inspector: clamp("inspector", layout.inspector) };
    // The width variables are inline, which outranks the stylesheet, so a hidden pane is zeroed here.
    setVar("--fw-media-w", shown("media") ? `${layout.media}px` : "0px");
    setVar("--fw-inspector-w", shown("inspector") ? `${layout.inspector}px` : "0px");
    for (const side of ["media", "inspector"] as Side[]) {
      const state = shown(side) ? "on" : "off";
      if (ws.dataset[side] !== state) ws.dataset[side] = state;
      const toggle = host.querySelector<HTMLElement>(`.fw-panel-toggle[data-pane="${side}"]`);
      if (toggle && toggle.getAttribute("aria-pressed") !== String(shown(side))) toggle.setAttribute("aria-pressed", String(shown(side)));
    }
  };

  let drag: { side: Side; x0: number; w0: number; el: HTMLElement } | null = null;
  ws.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".fw-pane-divider");
    const side = el?.dataset.side as Side | undefined;
    if (!el || !side) return;
    e.preventDefault();
    drag = { side, x0: e.clientX, w0: layout[side], el };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  });
  ws.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const delta = e.clientX - drag.x0;
    layout = { ...layout, [drag.side]: drag.w0 + (drag.side === "media" ? delta : -delta) };
    apply();
  });
  const end = () => {
    if (!drag) return;
    drag.el.classList.remove("is-dragging");
    drag = null;
    save();
  };
  ws.addEventListener("pointerup", end);
  ws.addEventListener("pointercancel", end);
  ws.addEventListener("keydown", (e) => {
    const side = (e.target as HTMLElement).closest<HTMLElement>(".fw-pane-divider")?.dataset.side as Side | undefined;
    if (!side || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const grow = (e.key === "ArrowRight") === (side === "media");
    layout = { ...layout, [side]: layout[side] + (grow ? STEP : -STEP) };
    apply();
    save();
  });
  host.addEventListener("click", (e) => {
    const side = (e.target as HTMLElement).closest<HTMLElement>(".fw-panel-toggle")?.dataset.pane as Side | undefined;
    if (!side) return;
    layout = side === "media" ? { ...layout, showMedia: !layout.showMedia } : { ...layout, showInspector: !layout.showInspector };
    apply();
    save();
  });
  // Audacity's saved workspaces: preset layouts and named ones the owner saves, kept with the browser's storage.
  const SAVED = "formwav.layouts";
  const PRESETS: Record<string, Partial<Layout>> = {
    Default: { ...DEFAULTS },
    "Timeline only": { showMedia: false, showInspector: false },
    Editing: { showMedia: false, showInspector: true },
    Transcript: { media: 380, showMedia: true, showInspector: false },
  };
  const readSaved = (): Record<string, Layout> => {
    try {
      return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Record<string, Layout>;
    } catch {
      return {};
    }
  };
  const tray = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  const menu = document.createElement("select");
  menu.className = "fw-layout-select";
  menu.setAttribute("aria-label", "Workspace layout");
  const fill = () => {
    const saved = Object.keys(readSaved());
    menu.replaceChildren(
      new Option("Layout", ""),
      ...Object.keys(PRESETS).map((name) => new Option(name, `preset:${name}`)),
      ...saved.map((name) => new Option(name, `saved:${name}`)),
      new Option("Save current layout...", "save"),
    );
    menu.value = "";
  };
  menu.addEventListener("change", () => {
    const [kind, name] = [menu.value.split(":")[0], menu.value.slice(menu.value.indexOf(":") + 1)];
    if (menu.value === "save") {
      const label = window.prompt("Name this layout")?.trim();
      if (label) {
        try {
          localStorage.setItem(SAVED, JSON.stringify({ ...readSaved(), [label]: { ...layout, floating: dockFloating() } }));
        } catch {
          /* storage refused */
        }
      }
    } else if (kind === "preset" && PRESETS[name]) {
      layout = { ...layout, ...PRESETS[name] };
      apply();
      save();
    } else if (kind === "saved") {
      const chosen = readSaved()[name];
      if (chosen) {
        const { floating, ...panes } = chosen;
        layout = { ...DEFAULTS, ...panes };
        apply();
        save();
        applyDockFloating(floating ?? []);
      }
    }
    fill();
  });
  if (tray) {
    fill();
    tray.append(menu);
  }

  window.addEventListener("resize", apply);
  if (agent) new MutationObserver(apply).observe(agent, { attributes: true, attributeFilter: ["hidden"] });
  apply();
}
