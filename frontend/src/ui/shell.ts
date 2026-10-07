import type { Engine, LinkState, TransportState } from "../engine";
import { delayedIndicator, mountOnce, setText } from "../vendor/nodemode/dom-stable";
import { ICON_SIZE, icon, type IconName } from "./icons";

const TRANSPORT: { name: IconName; label: string; action: string; built: boolean }[] = [
  { name: "skipBack", label: "Go to start", action: "to-start", built: true },
  { name: "play", label: "Play", action: "play", built: true },
  { name: "stop", label: "Stop", action: "stop", built: true },
  { name: "record", label: "Record", action: "record", built: true },
  { name: "loop", label: "Loop", action: "loop", built: true },
];

const panelIcon = (divider: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="${divider}"></path></svg>`;
export const PANEL_ICONS = { browser: panelIcon("M9 4v16"), editor: panelIcon("M3 14h18"), agent: panelIcon("M15 4v16") };
const SEARCH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>`;

function transportButtons(): string {
  return TRANSPORT.map(
    (b) =>
      `<button class="fw-tbtn" type="button" disabled data-action="${b.action}" aria-label="${b.label}" title="${b.built ? b.label : `${b.label} · not built yet`}">${icon(b.name, ICON_SIZE.transport)}</button>`,
  ).join("");
}

function shellHtml(): string {
  return `
<div class="fw-shell">
  <header class="fw-topbar">
    <div class="fw-titlebar-left">
      <div class="fw-identity">
        <svg class="fw-logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4"></path><path d="M8 6v12"></path><path d="M12 3v18"></path><path d="M16 7v10"></path><path d="M20 10v4"></path></svg>
        <span class="fw-name">formwav</span>
      </div>
      <div class="fw-tools" role="group" aria-label="Menus">
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">File</button>
          <div class="cv-menu fw-menu-pop" role="menu" aria-label="File" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="save" title="Save (Cmd or Ctrl S)">${icon("save", ICON_SIZE.control)}<span>Save</span><kbd>⌘S</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="open" aria-haspopup="dialog" title="Open (Cmd or Ctrl O)">${icon("folderOpen", ICON_SIZE.control)}<span>Open…</span><kbd>⌘O</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="cloud" aria-haspopup="dialog" title="Open from or save to Google Drive or Dropbox"><span>Cloud…</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="import" title="Import any audio or video file">${icon("upload", ICON_SIZE.control)}<span>Import…</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-topbar [data-action="export"]'><span>Export…</span><kbd>⇧⌘E</kbd></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Edit</button>
          <div class="cv-menu fw-menu-pop fw-edit-pop" role="menu" aria-label="Edit" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-topbar [data-action="undo"]'><span>Undo</span><kbd>⌘Z</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-topbar [data-action="redo"]'><span>Redo</span><kbd>⇧⌘Z</kbd></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">View</button>
          <div class="cv-menu fw-menu-pop fw-view-pop" role="menu" aria-label="View" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-panel-toggle[data-pane="media"]'><span>Browser</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-panel-toggle[data-pane="editor"]'><span>Editor</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='[data-action="agent"]'><span>Agent</span></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Transport</button>
          <div class="cv-menu fw-menu-pop fw-transport-pop" role="menu" aria-label="Transport" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-status [data-action="play"]'><span>Play or pause</span><kbd>Space</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-status [data-action="stop"]'><span>Stop</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-status [data-action="record"]'><span>Record</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-status [data-action="loop"]'><span>Loop</span></button>
          </div>
        </div>
        <div class="fw-menu fw-settings-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Settings</button>
          <div class="cv-menu fw-menu-pop fw-settings-pop" role="menu" aria-label="Settings" hidden></div>
        </div>
      </div>
      <div class="fw-doc">
        <input class="fw-session-name" type="text" value="Untitled session" aria-label="Session name" maxlength="80" spellcheck="false" autocomplete="off">
        <span class="fw-doc-state" aria-live="polite">Nothing to save yet</span>
      </div>
    </div>
    <div class="fw-topbar-mid"></div>
    <div class="fw-topbar-actions">
      <label class="fw-theme-pick fw-head-theme">Theme <select data-theme-pick aria-label="Theme"></select></label>
      <div class="fw-swatches fw-head-swatches" role="group" aria-label="Accent colour"></div>
      <span class="fw-history" role="group" aria-label="Undo and redo">
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="undo" aria-label="Undo" title="Undo (Cmd or Ctrl Z)" disabled>${icon("undo", ICON_SIZE.control)}</button>
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="redo" aria-label="Redo" title="Redo (Cmd or Ctrl Shift Z)" disabled>${icon("redo", ICON_SIZE.control)}</button>
      </span>
      <button class="fw-ibtn fw-btn-export" type="button" data-action="export" title="Export the mix as a WAV file (Cmd or Ctrl Shift E)" disabled><span>Export</span></button>
      <span class="fw-panel-toggles" role="group" aria-label="Panels">
        <button type="button" class="fw-panel-toggle" data-pane="media" aria-pressed="true" aria-label="Show or hide the browser" title="Show or hide the browser">${PANEL_ICONS.browser}</button>
        <button type="button" class="fw-panel-toggle" data-pane="editor" aria-pressed="false" aria-label="Show or hide the editor" title="Show or hide the editor">${PANEL_ICONS.editor}</button>
      </span>
    </div>
  </header>
  <div class="fw-workspace">
    <aside class="fw-pane fw-pane-media" aria-label="Browser">
      <div class="fw-pane-header"><span class="fw-pane-tabs" role="tablist"><button type="button" class="fw-pane-tab is-active" role="tab" aria-selected="true" data-tab="media">Media</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="effects">Effects</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="sounds">Sounds</button></span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
      <label class="fw-browse-search">${SEARCH_ICON}<input type="search" data-browse-search placeholder="Search media, effects, sounds" aria-label="Search media, effects and sounds" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>
      <div class="fw-pane-body fw-browse" data-panel="media">
        <p class="fw-browse-hint">Click adds to the selected track, or drag onto any track</p>
        <span class="fw-browse-head">In this session</span>
        <div class="fw-media-list"></div>
        <span class="fw-browse-head">Effects</span>
        <div class="fw-fx-groups" role="list"></div>
        <section class="fw-agent-card" aria-label="Made by the agent">
          <span class="fw-agent-card-title">Made by the agent</span>
          <span class="fw-agent-card-text">Nothing yet. Describe a sound or an effect and the agent builds it for this session.</span>
          <button type="button" class="fw-ibtn" data-ask-agent="Build a sound for this session: ">Build one with the agent</button>
        </section>
      </div>
      <div class="fw-pane-body fw-browse fw-browse-effects" data-panel="effects" hidden></div>
      <div class="fw-pane-body fw-browse fw-create-body" data-panel="sounds" hidden>
        <section class="fw-insp-section fw-voice-wrap"><div class="fw-insp-head">Speech on this computer</div><div class="fw-voice-body"></div></section>
      </div>
    </aside>
    <div class="fw-pane-divider" data-side="media" role="separator" aria-orientation="vertical" aria-label="Resize the Media pane" tabindex="0"></div>
    <section class="fw-pane fw-pane-timeline" aria-label="Timeline">
      <div class="fw-tool-tray" role="toolbar" aria-label="Arrangement" data-tool="select"><button type="button" class="fw-tb-btn" data-add-track title="A new empty track, to record into or to fill from the browser">Add a track</button><div class="fw-seg fw-tools-seg" role="group" aria-label="Tool"><button type="button" class="fw-seg-btn" data-label="Select" data-tool="select" aria-pressed="true" title="Select, move and trim clips; drag in a clip's upper half to select a range">Select</button><button type="button" class="fw-seg-btn" data-label="Split" data-tool="split" aria-pressed="false" title="Click a clip where it should split">Split</button><button type="button" class="fw-seg-btn" data-label="Fade" data-tool="fade" aria-pressed="false" title="Drag in from a clip's start or end to fade it in or out">Fade</button></div><div class="fw-zoom" role="group" aria-label="Zoom"><button type="button" class="fw-tb-icon" data-zoom="out" aria-label="Zoom out" title="Zoom out (-)">−</button><button type="button" class="fw-tb-icon" data-zoom="in" aria-label="Zoom in" title="Zoom in (=)">+</button><button type="button" class="fw-tb-btn fw-tb-quiet" data-zoom="fit" title="Fit the whole session in view">Fit</button><button type="button" class="fw-tb-btn fw-tb-quiet fw-follow" data-follow aria-pressed="true" title="Keep the playhead in view while playing">Follow</button></div><span class="fw-tool-hint" aria-live="polite"></span><span class="fw-st-hint"></span><div class="fw-tray-store" aria-hidden="true"><div class="fw-opt-group" data-group="edit" data-label="Edit" role="group" aria-label="Edit"></div><div class="fw-opt-group fw-opt-view" data-group="view" data-label="View" role="group" aria-label="View"><button type="button" class="fw-mode" data-inspector aria-pressed="false" title="Show the Inspector: the selected clip's and the session's settings">Inspector</button><button type="button" class="fw-mode" data-transcript aria-pressed="false">Transcript</button><button type="button" class="fw-mode" data-labels aria-pressed="false">Labels</button></div></div></div>
      <main class="fw-stage" data-view="empty">
        <section class="fw-empty">
          <span class="fw-empty-mark">${icon("waveform", ICON_SIZE.mark)}</span>
          <h1 class="fw-empty-title">No session open</h1>
          <p class="fw-empty-body">Import any audio or video file, drop one here, or press Record to start a session.</p>
          <div class="fw-empty-actions"><button type="button" class="fw-ibtn fw-empty-import" data-empty="import">Import audio</button><button type="button" class="fw-ibtn" data-empty="open">Open a session</button></div>
        </section>
        <div class="fw-lanes"></div>
        <input class="fw-file" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.aifc,.caf,.wma,.webm,.mp4,.mov,.mkv,.m4v,.avi,.mxf,.aup,.aup3,.zip,.mid,.midi,.aaf,.edl" multiple hidden>
      </main>
      <section class="fw-pane fw-pane-inspector" aria-label="Inspector" hidden>
        <div class="fw-pane-header"><span class="fw-pane-title">Inspector</span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
        <div class="fw-pane-body fw-inspector-body"></div>
      </section>
      <section class="fw-editor-panel fw-transcript-panel" aria-label="Transcript" hidden><div class="fw-transcript-body"></div></section>
      <section class="fw-editor-panel fw-labels-panel" aria-label="Labels" hidden><div class="fw-labels-body"></div></section>
      <footer class="fw-dock-anchor" aria-hidden="true"></footer>
    </section>
    <div class="fw-pane-divider" data-side="inspector" role="separator" aria-orientation="vertical" aria-label="Resize the agent column" tabindex="0"></div>
    <aside class="fw-pane fw-pane-agent" aria-label="Agent"><div class="fw-agent-anchor"></div></aside>
  </div>
  <footer class="fw-status" aria-label="Transport and status">
    <div class="fw-transport" role="group" aria-label="Transport and meters">
      <div class="fw-transport-controls" role="group" aria-label="Transport">${transportButtons()}</div>
      <div class="fw-position">
        <output class="fw-clock" role="button" tabindex="0" data-mode="time" title="Click to switch the clock between time and timecode at 24, 25 or 30 frames per second">00:00:00.000</output>
        <span class="fw-position-sub"><span class="fw-st-length" title="The session's length"></span></span>
      </div>
      <div class="fw-musical" role="group" aria-label="Tempo, meter and snap">
        <button type="button" class="fw-mus" data-mus="tempo" aria-haspopup="dialog" title="The session's tempo, for bars and beats and the grid"><span class="fw-mus-label">Tempo</span><span class="fw-mus-value" data-mus-value="tempo">120</span></button>
        <button type="button" class="fw-mus" data-mus="meter" aria-haspopup="dialog" title="Beats in a bar"><span class="fw-mus-label">Meter</span><span class="fw-mus-value" data-mus-value="meter">4/4</span></button>
        <button type="button" class="fw-mus" data-mus="snap" title="What moves and trims snap to: off, the ruler's ticks, or beats (G)"><span class="fw-mus-label">Snap</span><span class="fw-mus-value" data-mus-value="snap">Off</span></button>
      </div>
      <button type="button" class="fw-ibtn fw-speed-btn" popovertarget="fw-speed-pop" title="Playback speed (0.25 to 4 times, pitch following, playback only)" aria-label="Playback speed"><output data-speed-out>1.00×</output></button>
      <div id="fw-speed-pop" class="fw-rec-pop" popover><label class="fw-speed" title="Play at speed: 0.25 to 4 times, pitch following (playback only); double-click for 1×">Speed <input type="range" data-speed min="-2" max="2" step="0.01" value="0" data-default="0" aria-label="Playback speed, as a power of two"></label></div>
      <button type="button" class="fw-ibtn fw-rec-btn" popovertarget="fw-rec-pop" title="Recording settings: latency compensation, Measure, pre-roll" aria-label="Recording settings">Rec</button>
      <div id="fw-rec-pop" class="fw-rec-pop" popover><label class="fw-speed" title="Recording latency compensation: each take lands this many milliseconds earlier, undoing the round trip from playback to your microphone. Measure it once with a loopback cable (the Measure button beside this field) and type it here; 0 leaves takes where they were recorded">Latency <input type="number" data-latency min="0" max="500" step="1" value="0" aria-label="Recording latency compensation in milliseconds"> ms</label>
      <label class="fw-speed" title="Pre-roll: recording rolls this long before the punch point (or the playhead) so you hear the lead-in; only what follows that point is kept">Pre-roll <input type="number" data-preroll min="0" max="10" step="0.5" value="0" aria-label="Pre-roll in seconds"> s</label></div>
    </div>
    <div class="fw-st-info">
      <span class="fw-notice" role="status" aria-live="polite"></span>
      <div class="fw-st-line">
        <span class="fw-engine" data-state="pending" role="status" aria-live="polite"><span class="fw-engine-dot"></span><span class="fw-engine-text"></span></span>
        <span class="fw-st-rate" title="The session's sample rate"></span>
        <label class="fw-st-output" title="Where playback is heard: the browser's own audio, or the engine's native output on a device"><span class="fw-vh">Output</span><select data-output aria-label="Output"></select></label>
      </div>
    </div>
  </footer>
</div>`;
}

export type ClockMode = "time" | "tc24" | "tc25" | "tc2997df" | "tc30";
export const CLOCK_MODES: ClockMode[] = ["time", "tc24", "tc25", "tc2997df", "tc30"];

// PT-26: the clock's mode, for the ruler to label in the same timecode (an event tells it when the mode changes)
let currentMode: ClockMode = "time";
export function clockMode(): ClockMode {
  return currentMode;
}

/** PT-26: timecode text (hh:mm:ss:ff, or hh:mm:ss;ff for drop-frame) as seconds, in `mode`'s rate; null if unreadable. */
export function parseTimecode(text: string, mode: ClockMode): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[:;.](\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, mi, s, f] = m.slice(1).map(Number);
  if (mode === "tc2997df") {
    // SMPTE drop-frame: frame numbers 00 and 01 skipped at each minute but every tenth
    const minutes = h * 60 + mi;
    return (((h * 3600 + mi * 60 + s) * 30 + f - 2 * (minutes - Math.floor(minutes / 10))) * 1001) / 30000;
  }
  const fps = mode === "tc24" ? 24 : mode === "tc25" ? 25 : 30;
  return h * 3600 + mi * 60 + s + f / fps;
}

export function formatClock(positionSamples: number, sampleRate: number, mode: ClockMode = "time", startSeconds = 0): string {
  const two = (n: number) => String(n).padStart(2, "0");
  if (mode === "tc2997df") {
    // PT-26: 29.97 drop-frame (SMPTE): real frames counted at 30000/1001 a second, numbered skipping 00 and 01 at each
    // minute but every tenth, written with ';' before the frames
    const frame = Math.floor((positionSamples / sampleRate + startSeconds) * (30000 / 1001) + 1e-6);
    const tens = Math.floor(frame / 17982);
    const rest = frame % 17982;
    const n = frame + 18 * tens + (rest > 1 ? 2 * Math.floor((rest - 2) / 1798) : 0);
    return `${two(Math.floor(n / 108000))}:${two(Math.floor(n / 1800) % 60)}:${two(Math.floor(n / 30) % 60)};${two(n % 30)}`;
  }
  if (mode !== "time") {
    const fps = mode === "tc24" ? 24 : mode === "tc25" ? 25 : 30;
    const totalFrames = Math.floor((positionSamples / sampleRate + startSeconds) * fps + 1e-6);
    const f = totalFrames % fps;
    const s = Math.floor(totalFrames / fps) % 60;
    const m = Math.floor(totalFrames / (fps * 60)) % 60;
    const h = Math.floor(totalFrames / (fps * 3600));
    return `${two(h)}:${two(m)}:${two(s)}:${two(f)}`;
  }
  const totalMs = Math.floor((positionSamples * 1000) / sampleRate);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  return `${two(h)}:${two(m)}:${two(s)}.${String(ms).padStart(3, "0")}`;
}

export function mountShell(host: HTMLElement, engine: Engine): void {
  mountOnce(host, shellHtml());
  const chip = host.querySelector<HTMLElement>(".fw-engine");
  const chipText = host.querySelector<HTMLElement>(".fw-engine-text");
  const clock = host.querySelector<HTMLElement>(".fw-clock");

  let connectingShown = false;
  let finalLink: LinkState | null = null;

  const writeFinal = () => {
    if (!chip || !finalLink) return;
    const core = finalLink.coreVersion;
    const stale = finalLink.status === "ready" && !!core && core !== "missing" && core !== finalLink.engineVersion;
    const state = stale ? "stale" : finalLink.status;
    if (chip.dataset.state !== state) chip.dataset.state = state;
    setText(chipText, finalLink.status === "ready" ? "Engine connected" : "Engine offline");
    const title = stale
      ? `The audio core is from v${core} and the engine is v${finalLink.engineVersion}: run formwav_oc_install to rebuild it`
      : finalLink.status === "ready"
        ? `The engine, version ${finalLink.engineVersion ?? "unknown"}, is running on this computer`
        : "The engine is not answering; start it with the formwav launcher";
    if (chip.title !== title) chip.title = title;
    if (stale) setText(host.querySelector(".fw-notice"), `Run formwav_oc_install: the audio core is from v${core}, this formwav is v${finalLink.engineVersion}`);
  };

  const dismissConnecting = delayedIndicator(
    () => {
      connectingShown = true;
      setText(chipText, "Connecting");
    },
    writeFinal,
  );

  const renderLink = (link: LinkState) => {
    if (link.status === "pending") return;
    finalLink = link;
    dismissConnecting();
    if (!connectingShown) writeFinal();
  };

  const CLOCK_KEY = "formwav.clockMode";
  let clockMode: ClockMode = "time";
  try {
    const saved = localStorage.getItem(CLOCK_KEY);
    if (saved && CLOCK_MODES.includes(saved as ClockMode)) clockMode = saved as ClockMode;
  } catch {
    clock?.setAttribute("data-storage", "none");
  }
  currentMode = clockMode;
  // PT-26: timecode reads from the session's timecode start (Pro Tools' session start, 01:00:00:00 by habit)
  const renderClock = (t: TransportState) => setText(clock, formatClock(t.positionSamples, t.sampleRate, clockMode, engine.get("document").timecodeStart ?? 0));
  engine.subscribe("document", () => renderClock(engine.get("transport")));
  const cycleClock = () => {
    clockMode = CLOCK_MODES[(CLOCK_MODES.indexOf(clockMode) + 1) % CLOCK_MODES.length];
    currentMode = clockMode;
    document.dispatchEvent(new CustomEvent("fw:clock-mode"));
    if (clock && clock.dataset.mode !== clockMode) clock.dataset.mode = clockMode;
    try {
      localStorage.setItem(CLOCK_KEY, clockMode);
    } catch {
      clock?.setAttribute("data-storage", "none");
    }
    renderClock(engine.get("transport"));
  };
  if (clock && clock.dataset.mode !== clockMode) clock.dataset.mode = clockMode;
  clock?.addEventListener("click", cycleClock);
  clock?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cycleClock();
    }
  });

  host.querySelector(".fw-empty-actions")?.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-empty]")?.dataset.empty;
    if (act === "import") host.querySelector<HTMLInputElement>(".fw-file")?.click();
    else if (act === "open") host.querySelector<HTMLButtonElement>('.fw-topbar [data-action="open"]')?.click();
  });

  engine.subscribe("link", renderLink);
  engine.subscribe("transport", renderClock);
  renderLink(engine.get("link"));
  renderClock(engine.get("transport"));
}
