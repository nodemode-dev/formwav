/**
 * The editor as approved (design/formwav, editor, editor-mixer and spectro): the same modules, in the approved places.
 * Every module keeps its own DOM, its commands and its events; this one only moves the finished containers (before the
 * app is revealed, so nothing is seen to move) and adds the few controls the layout asks for, each of which presses
 * something that already exists:
 *
 *   tool strip      the arrangement tray across the top of the workspace, its tools as icons, the hint and Start, End
 *                   and Length at its right
 *   timeline head   the main counter with the bar and beat under it, Tempo, Meter, Snap, Set In and Set Out (the
 *                   loop range, which is also the punch range), the zoom slider, Fit and Follow
 *   right column    Clip, Effects and Repair tabs over the panels that were dock tabs and the Inspector; the agent
 *                   opens in the same column from Ask the agent
 *   left column     the session card over the search, the Name, Type and Length list and the footer's actions
 *   action row      Split, Duplicate, Normalize, Mute, Lock and Delete under the tracks, with the hint
 *   status          the selection's names beside the engine, the notice shown as a toast (toast.ts)
 */
import type { Engine } from "../engine";
import { documentLength } from "../engine/document";
import { getZoom, onZoom, setZoom } from "./lanes";
import { commands } from "./commands";
import { setText } from "../vendor/nodemode/dom-stable";

const svg = (body: string, size = 16) => `<svg class="fw-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TOOL_ICONS: Record<string, string> = {
  select: svg('<path d="M5 3l14 8-6 2-3 6z"/>'),
  split: svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L20 18M8.5 16.5L20 6"/>'),
  fade: svg('<path d="M3 19h18V5z"/>'),
  draw: svg('<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'),
  zoom: svg('<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/>'),
};
const SPEC_ICONS = {
  spectrogram: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 16v-3M11 16V8M15 16v-5M19 16v-2"/>'),
  box: svg('<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2.5"/>'),
  lasso: svg('<path d="M12 4c4.4 0 8 2 8 4.6S16.4 13 12 13 4 11.2 4 8.6 7.6 4 12 4z"/><path d="M9 13c-1 2.4 0 5 3 6"/>'),
  paint: svg('<path d="M4 20c2.5 0 4-1.2 4-3l8-8-1-1-8 8c-1.8 0-3 1.5-3 4z"/><path d="M14 7l3-3 3 3-3 3z"/>'),
};
const PLUS = svg('<path d="M12 5v14M5 12h14"/>');
const WAVE = svg('<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>', 24);
const IMPORT = svg('<path d="M12 15V4M8 8l4-4 4 4M5 15v4h14v-4"/>');
const MIC = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');

type Side = "clip" | "effects" | "repair" | "agent";

export function mountEditorLayout(host: HTMLElement, engine: Engine): void {
  const ws = host.querySelector<HTMLElement>(".fw-workspace");
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const tray = host.querySelector<HTMLElement>(".fw-tool-tray");
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const media = host.querySelector<HTMLElement>(".fw-pane-media");
  const side = host.querySelector<HTMLElement>(".fw-pane-agent");
  const status = host.querySelector<HTMLElement>(".fw-status");
  if (!ws || !pane || !tray || !stage || !media || !side || !status) return;

  // ---- tool strip -------------------------------------------------------------------------------------------------
  ws.prepend(tray);
  const tools = tray.querySelector<HTMLElement>(".fw-tools-seg");
  // the Draw tool joins the tools, before Zoom (it makes its own button, in the tray's end)
  const draw = tray.querySelector<HTMLElement>("[data-draw]");
  if (draw) tools?.querySelector('[data-tool="zoom"]')?.before(draw);
  const iconTools = () => {
    for (const b of tools?.querySelectorAll<HTMLButtonElement>("[data-tool], [data-draw]") ?? []) {
      if (b.querySelector(".fw-ico")) continue;
      const mark = TOOL_ICONS[b.dataset.tool ?? (b.hasAttribute("data-draw") ? "draw" : "")];
      if (!mark) continue;
      b.insertAdjacentHTML("afterbegin", mark);
      b.classList.add("fw-tool-icon");
      // the label stays for assistive technology and the tooltip; the icon is what is seen
      if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", b.dataset.label ?? b.textContent?.trim() ?? "");
      b.dataset.label ??= b.textContent?.trim() ?? "";
    }
  };
  iconTools();
  if (tools) new MutationObserver(iconTools).observe(tools, { childList: true });
  const add = tray.querySelector<HTMLElement>("[data-add-track]");
  if (add && !add.querySelector(".fw-ico")) add.insertAdjacentHTML("afterbegin", PLUS);

  // ---- the spectrogram tray: the Spectrogram toggle stays in the strip; with the view on, the strip swaps its tools for
  // Log Hz and the three ways a drag selects (the toggle, the log axis and the select are the spectrogram module's own) ----
  const spec = host.querySelector<HTMLButtonElement>(".fw-spectral-toggle");
  const specLog = host.querySelector<HTMLButtonElement>(".fw-spectral-log");
  const specTool = host.querySelector<HTMLSelectElement>(".fw-spectral-tool");
  if (spec && specLog && specTool) {
    const strip = document.createElement("div");
    strip.className = "fw-spectral-strip";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", "Spectrogram");
    spec.setAttribute("aria-label", "Spectrogram");
    spec.dataset.label = "Spectrogram";
    spec.classList.add("fw-tool-icon");
    spec.innerHTML = SPEC_ICONS.spectrogram;
    const modes = document.createElement("span");
    modes.className = "fw-spectral-modes";
    const picks: Array<[string, string, string]> = [["", "Box select", SPEC_ICONS.box], ["lasso", "Lasso select", SPEC_ICONS.lasso], ["paint", "Paint select", SPEC_ICONS.paint]];
    const buttons = picks.map(([value, label, mark]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fw-mode fw-tool-icon fw-spectral-mode";
      b.dataset.value = value;
      b.setAttribute("aria-label", label);
      b.dataset.label = label;
      b.title = label;
      b.innerHTML = mark;
      b.addEventListener("click", () => {
        if (specTool.value === value) return;
        specTool.value = value;
        specTool.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return b;
    });
    modes.append(...buttons);
    strip.append(spec, specLog, modes);
    (tools ?? add)?.before(strip);
    const sync = () => {
      const on = spec.getAttribute("aria-pressed") === "true";
      if (tray.dataset.spectral !== String(on)) tray.dataset.spectral = String(on);
      for (const b of buttons) {
        const pressed = String(b.dataset.value === specTool.value);
        if (b.getAttribute("aria-pressed") !== pressed) b.setAttribute("aria-pressed", pressed);
      }
    };
    sync();
    new MutationObserver(sync).observe(spec, { attributes: true, attributeFilter: ["aria-pressed"] });
    specTool.addEventListener("change", sync);
  }

  // ---- timeline head ----------------------------------------------------------------------------------------------
  const head = document.createElement("div");
  head.className = "fw-tl-head";
  head.setAttribute("role", "group");
  head.setAttribute("aria-label", "Counter, tempo and view");
  const position = status.querySelector<HTMLElement>(".fw-position");
  const musical = status.querySelector<HTMLElement>(".fw-musical");
  const zoomGroup = tray.querySelector<HTMLElement>(".fw-zoom");
  const barBeat = document.createElement("span");
  barBeat.className = "fw-bar-beat";
  barBeat.setAttribute("aria-hidden", "true");
  position?.querySelector(".fw-position-sub")?.prepend(barBeat);
  const punch = document.createElement("div");
  punch.className = "fw-punch";
  punch.setAttribute("role", "group");
  punch.setAttribute("aria-label", "Loop and punch range");
  punch.innerHTML = `<button type="button" class="fw-tb-btn" data-set="in" title="Set the range's start at the playhead: the loop's, and where a punch records from">Set In</button><button type="button" class="fw-tb-btn" data-set="out" title="Set the range's end at the playhead: the loop's, and where a punch stops">Set Out</button>`;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "fw-zoom-slider";
  slider.min = "0";
  slider.max = "1000";
  slider.step = "1";
  slider.setAttribute("aria-label", "Zoom");
  slider.title = "Zoom the timeline";
  const ZMIN = Math.log(0.25);
  const ZMAX = Math.log(8000);
  const toSlider = () => String(Math.round(((Math.log(getZoom()) - ZMIN) / (ZMAX - ZMIN)) * 1000));
  slider.value = toSlider();
  slider.addEventListener("input", () => setZoom(Math.exp(ZMIN + (Number(slider.value) / 1000) * (ZMAX - ZMIN))));
  onZoom(() => {
    const next = toSlider();
    if (slider.value !== next) slider.value = next;
  });
  zoomGroup?.querySelector('[data-zoom="in"]')?.before(slider);
  head.append(...[position, musical, Object.assign(document.createElement("span"), { className: "fw-tl-gap" }), punch, zoomGroup].filter((n): n is HTMLElement => !!n));
  pane.prepend(head);

  punch.addEventListener("click", (e) => {
    const which = (e.target as HTMLElement).closest<HTMLElement>("[data-set]")?.dataset.set;
    if (!which) return;
    const doc = engine.get("document");
    if (!doc.tracks.length) return;
    const at = engine.get("transport").positionSamples;
    const end = documentLength(doc);
    const keep = doc.loop;
    if (which === "in") engine.dispatch({ type: "set-loop", start: at, end: keep && keep.end > at ? keep.end : Math.max(end, at + 1), enabled: keep?.enabled ?? true });
    else engine.dispatch({ type: "set-loop", start: keep && keep.start < at ? keep.start : 0, end: Math.max(at, 1), enabled: keep?.enabled ?? true });
  });

  // the bar and the beat under the counter, from the session's tempo
  const beatText = () => {
    const doc = engine.get("document");
    const t = doc.tempo ?? { bpm: 120, beatsPerBar: 4 };
    const beats = (engine.get("transport").positionSamples / doc.sampleRate) * (t.bpm / 60);
    const whole = Math.floor(beats + 1e-9);
    return `Bar ${Math.floor(whole / t.beatsPerBar) + 1}, beat ${(whole % t.beatsPerBar) + 1}`;
  };
  const paintBeat = () => setText(barBeat, beatText());
  engine.subscribe("transport", paintBeat);
  engine.subscribe("document", paintBeat);
  paintBeat();

  // ---- transport row: the small counter beside the buttons ---------------------------------------------------------
  const clock = position?.querySelector<HTMLElement>(".fw-clock");
  const tx = status.querySelector<HTMLElement>(".fw-transport-controls");
  if (clock && tx) {
    const mini = document.createElement("div");
    mini.className = "fw-tx-clock";
    mini.setAttribute("aria-hidden", "true");
    mini.innerHTML = `<span class="fw-tx-time"></span><span class="fw-tx-of"></span>`;
    tx.after(mini);
    const time = mini.querySelector<HTMLElement>(".fw-tx-time");
    const of = mini.querySelector<HTMLElement>(".fw-tx-of");
    const length = position?.querySelector<HTMLElement>(".fw-st-length");
    const copy = () => {
      setText(time, clock.textContent ?? "");
      setText(of, length?.textContent ?? "");
    };
    new MutationObserver(copy).observe(clock, { childList: true, characterData: true, subtree: true });
    if (length) new MutationObserver(copy).observe(length, { childList: true, characterData: true, subtree: true });
    copy();
  }

  // ---- right column: Clip, Effects, Repair, and the agent -----------------------------------------------------------
  const panels: Record<Exclude<Side, "agent">, HTMLElement | null> = {
    clip: host.querySelector<HTMLElement>(".fw-cliptab"),
    effects: host.querySelector<HTMLElement>(".fw-editor-panel.fw-chain"),
    repair: host.querySelector<HTMLElement>(".fw-pane-inspector"),
  };
  const agent = side.querySelector<HTMLElement>(".fw-agent");
  const tabs = document.createElement("div");
  tabs.className = "fw-side-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Inspector");
  const LABELS: Array<[Side, string]> = [["clip", "Clip"], ["effects", "Effects"], ["repair", "Repair"], ["agent", "Agent"]];
  for (const [id, label] of LABELS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fw-side-tab";
    b.dataset.side = id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", "false");
    b.textContent = label;
    if (id === "agent") b.hidden = true;
    tabs.append(b);
  }
  side.prepend(tabs);
  for (const [id, el] of Object.entries(panels)) {
    if (!el) continue;
    el.classList.add("fw-side-panel");
    el.dataset.sidePanel = id;
    side.append(el);
  }
  agent?.classList.add("fw-side-panel");
  if (agent) agent.dataset.sidePanel = "agent";
  const toggles: Record<string, HTMLButtonElement | null> = {
    clip: tray.querySelector("[data-cliptab]"),
    effects: tray.querySelector("[data-chain]"),
    repair: tray.querySelector("[data-inspector]"),
  };
  let active: Side = "clip";
  let guard = false;
  const show = (next: Side) => {
    if (next === "agent" && agent?.hidden) return;
    active = next;
    guard = true;
    for (const id of ["clip", "effects", "repair"] as const) {
      const el = panels[id];
      const on = id === next;
      if (el && el.hidden === on) el.hidden = !on;
      const t = toggles[id];
      if (t && t.getAttribute("aria-pressed") !== String(on)) t.setAttribute("aria-pressed", String(on));
    }
    guard = false;
    for (const el of side.querySelectorAll<HTMLElement>(".fw-side-panel")) {
      const off = el.dataset.sidePanel !== next;
      if (el.classList.contains("is-off") !== off) el.classList.toggle("is-off", off);
    }
    for (const b of tabs.querySelectorAll<HTMLElement>(".fw-side-tab")) {
      const on = String(b.dataset.side === next);
      if (b.getAttribute("aria-selected") !== on) b.setAttribute("aria-selected", on);
    }
  };
  tabs.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-side]")?.dataset.side as Side | undefined;
    if (id) show(id);
  });
  // a panel opened by its own toggle (a browser effect, Edit, the Inspector's chip) takes the column
  for (const id of ["clip", "effects", "repair"] as const) {
    const el = panels[id];
    if (el) new MutationObserver(() => !guard && !el.hidden && show(id)).observe(el, { attributes: true, attributeFilter: ["hidden"] });
  }
  const agentTab = tabs.querySelector<HTMLButtonElement>('[data-side="agent"]');
  const syncAgent = () => {
    if (!agent || !agentTab) return;
    if (agentTab.hidden !== agent.hidden) agentTab.hidden = agent.hidden;
    if (agent.hidden && active === "agent") show("clip");
  };
  if (agent) {
    new MutationObserver(syncAgent).observe(agent, { attributes: true, attributeFilter: ["hidden"] });
    // it opens (Ask the agent, Cmd or Ctrl /) already visible: take the column when it is asked for
    host.addEventListener("fw-ask-agent", () => queueMicrotask(() => (syncAgent(), show("agent"))));
    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && (e.metaKey || e.ctrlKey) && !e.altKey) queueMicrotask(() => (syncAgent(), show("agent")));
    });
    syncAgent();
  }
  show("clip");

  // ---- left column: the session card, the list's head and the footer ------------------------------------------------
  const search = media.querySelector<HTMLElement>(".fw-browse-search");
  const card = document.createElement("div");
  card.className = "fw-session-card";
  card.innerHTML = `<span class="fw-session-mark" aria-hidden="true">${WAVE}</span><span class="fw-session-text"><span class="fw-session-title" translate="no"></span><span class="fw-session-line"></span><span class="fw-session-line fw-session-line2"></span></span>`;
  media.querySelector(".fw-pane-header")?.after(card);
  const cols = document.createElement("div");
  cols.className = "fw-media-cols";
  cols.setAttribute("aria-hidden", "true");
  cols.innerHTML = `<span>Name</span><span>Type</span><span>Length</span>`;
  const list = media.querySelector<HTMLElement>(".fw-media-list");
  list?.before(cols);
  const foot = document.createElement("div");
  foot.className = "fw-media-foot";
  foot.innerHTML = `<button type="button" class="fw-icon-btn" data-foot="import" aria-label="Import audio" title="Import any audio or video file">${IMPORT}</button><button type="button" class="fw-icon-btn" data-foot="record" aria-label="Record into a new track" title="Record from the microphone into a new track">${MIC}</button><button type="button" class="fw-icon-btn" data-foot="add" aria-label="Add a track" title="A new empty track">${PLUS}</button><span class="fw-media-count"></span>`;
  media.append(foot);
  foot.addEventListener("click", (e) => {
    const which = (e.target as HTMLElement).closest<HTMLElement>("[data-foot]")?.dataset.foot;
    if (which === "import") host.querySelector<HTMLInputElement>(".fw-file")?.click();
    else if (which === "record") host.querySelector<HTMLButtonElement>('.fw-tbtn[data-action="record"]')?.click();
    else if (which === "add") host.querySelector<HTMLButtonElement>("[data-add-track]")?.click();
  });
  const nameInput = host.querySelector<HTMLInputElement>(".fw-session-name");
  const cardText = () => {
    const doc = engine.get("document");
    const title = nameInput?.value || "Untitled session";
    const media = Object.keys(doc.media).length;
    setText(card.querySelector(".fw-session-title"), title);
    setText(card.querySelector(".fw-session-line"), doc.tracks.length === 1 ? "1 track" : `${doc.tracks.length} tracks`);
    setText(card.querySelector(".fw-session-line2"), `${media === 1 ? "1 media file" : `${media} media files`}, ${(doc.sampleRate / 1000).toFixed(doc.sampleRate % 1000 ? 1 : 0)} kHz`);
    setText(foot.querySelector(".fw-media-count"), media === 1 ? "1 item" : `${media} items`);
  };
  engine.subscribe("document", cardText);
  nameInput?.addEventListener("input", cardText);
  if (nameInput) new MutationObserver(cardText).observe(nameInput, { attributes: true, attributeFilter: ["value"] });
  cardText();
  void search;

  // ---- action row under the tracks ------------------------------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "fw-action-row";
  actions.setAttribute("role", "toolbar");
  actions.setAttribute("aria-label", "Clip actions");
  const ACTIONS: Array<[string, string, string]> = [
    ["split", "Split", "Split the selected clips at the playhead"],
    ["duplicate", "Duplicate", "Copy the selected clips right after themselves"],
    ["normalize", "Normalize", "Normalize the selected clips to a loudness target"],
    ["mute", "Mute", "Silence the selected clips, keeping them in place (again to unmute)"],
    ["lock", "Lock", "Keep the selected clips from any edit but their gain (again to unlock)"],
    ["delete", "Delete", "Remove the selected clips"],
  ];
  actions.innerHTML = `${ACTIONS.map(([id, label, title]) => `<button type="button" class="fw-ibtn" data-act="${id}" title="${title}">${label}</button>`).join("")}<span class="fw-action-hint">Drag a clip to move it, its ends to trim, a top corner to fade. Space plays.</span>`;
  stage.after(actions);
  actions.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    const run = (id: string) => void commands.get(id)?.run({});
    if (act === "split") host.querySelector<HTMLButtonElement>('[data-clip-act="split"]')?.click();
    else if (act === "normalize") host.querySelector<HTMLButtonElement>(".fw-loud-btn")?.click();
    else if (act === "duplicate") run("edit.duplicate");
    else if (act === "mute") run("clip.mute-or-unmute");
    else if (act === "lock") run("clip.edit-lock");
    else if (act === "delete") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  });
  const selectedNow = () => !!stage.querySelector('.fw-clip[aria-selected="true"]');
  const paintActions = () => {
    const off = !selectedNow();
    for (const b of actions.querySelectorAll<HTMLButtonElement>("[data-act]")) if (b.disabled !== off) b.disabled = off;
  };
  new MutationObserver(paintActions).observe(stage, { attributes: true, attributeFilter: ["aria-selected"], subtree: true, childList: true });
  paintActions();

  // ---- status: what is selected, beside the engine ------------------------------------------------------------------
  const line = status.querySelector<HTMLElement>(".fw-st-line");
  const picked = document.createElement("span");
  picked.className = "fw-st-selected";
  picked.setAttribute("translate", "no");
  line?.querySelector(".fw-engine")?.after(picked);
  host.addEventListener("fw-selection", (e) => {
    const ids = (e as CustomEvent<string[]>).detail ?? [];
    const doc = engine.get("document");
    const track = doc.tracks.find((t) => t.clips.some((c) => ids.includes(c.id)));
    const clip = track?.clips.find((c) => ids.includes(c.id));
    setText(picked, track && clip ? `${clip.name ?? (doc.media[clip.mediaId]?.name ?? "clip").replace(/\.[^.]+$/, "")}, ${track.name}` : "");
  });
}
