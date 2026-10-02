import type { Engine, LinkState, TransportState } from "../engine";
import { delayedIndicator, mountOnce, setText } from "../vendor/nodemode/dom-stable";
import { ICON_SIZE, icon, type IconName } from "./icons";
import { icon as fvIcon } from "../vendor/formvis/icons";

const TRANSPORT: { name: IconName; label: string; action: string; built: boolean }[] = [
  { name: "skipBack", label: "Go to start", action: "to-start", built: true },
  { name: "play", label: "Play", action: "play", built: true },
  { name: "stop", label: "Stop", action: "stop", built: true },
  { name: "record", label: "Record", action: "record", built: true },
  { name: "loop", label: "Loop", action: "loop", built: true },
];

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
        <img class="fw-logo" src="/favicon-32.png" width="20" height="20" alt="">
        <span class="fw-name">formwav</span>
      </div>
      <div class="fw-tools" role="group" aria-label="Session">
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">File</button>
          <div class="cv-menu fw-menu-pop" role="menu" aria-label="File" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="save" title="Save (Cmd or Ctrl S)">${icon("save", ICON_SIZE.control)}<span>Save</span><kbd>⌘S</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="open" aria-haspopup="dialog" title="Open (Cmd or Ctrl O)">${icon("folderOpen", ICON_SIZE.control)}<span>Open…</span><kbd>⌘O</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="import" title="Import any audio or video file">${icon("upload", ICON_SIZE.control)}<span>Import…</span></button>
          </div>
        </div>
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="undo" aria-label="Undo" title="Undo" disabled>${icon("undo", ICON_SIZE.control)}</button>
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="redo" aria-label="Redo" title="Redo" disabled>${icon("redo", ICON_SIZE.control)}</button>
      </div>
    </div>
    <div class="fw-topbar-mid">
      <input class="fw-session-name" type="text" value="Untitled session" aria-label="Session name" maxlength="80" spellcheck="false" autocomplete="off">
      <span class="fw-notice" role="status" aria-live="polite"></span>
    </div>
    <div class="fw-topbar-actions">
      <button type="button" class="fw-panel-toggle" data-pane="media" aria-pressed="true" aria-label="Media pane" title="Show or hide the Media pane">${fvIcon("collapseLeft", 16)}</button>
      <button type="button" class="fw-panel-toggle" data-pane="inspector" aria-pressed="true" aria-label="Inspector pane" title="Show or hide the Inspector pane">${fvIcon("collapseRight", 16)}</button>
      <button class="fw-ibtn fw-btn-export" type="button" data-action="export" title="Export the mix as a WAV file (Cmd or Ctrl Shift E)" disabled>${icon("download", ICON_SIZE.control)}<span>Export</span></button>
    </div>
  </header>
  <div class="fw-workspace">
    <aside class="fw-pane fw-pane-media" aria-label="Media and voice">
      <div class="fw-pane-header"><span class="fw-pane-tabs" role="tablist"><button type="button" class="fw-pane-tab is-active" role="tab" aria-selected="true" data-tab="media">Media</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="voice">Voice</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="transcript">Transcript</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="labels">Labels</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="create">Create</button></span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
      <div class="fw-pane-body fw-media-list" data-panel="media"></div>
      <div class="fw-pane-body fw-voice-body" data-panel="voice" hidden></div>
      <div class="fw-pane-body fw-transcript-body" data-panel="transcript" hidden></div>
      <div class="fw-pane-body fw-labels-body" data-panel="labels" hidden></div>
      <div class="fw-pane-body fw-create-body" data-panel="create" hidden></div>
    </aside>
    <div class="fw-pane-divider" data-side="media" role="separator" aria-orientation="vertical" aria-label="Resize the Media pane" tabindex="0"></div>
    <section class="fw-pane fw-pane-timeline" aria-label="Timeline">
      <div class="fw-tool-tray" role="toolbar" aria-label="Timeline options"><div class="fw-opt-group" data-group="edit" data-label="Edit" role="group" aria-label="Edit"></div><div class="fw-opt-group fw-opt-view" data-group="view" data-label="View" role="group" aria-label="View"></div></div>
      <main class="fw-stage" data-view="empty">
        <section class="fw-empty">
          <span class="fw-empty-mark">${icon("waveform", ICON_SIZE.mark)}</span>
          <h1 class="fw-empty-title">No session open</h1>
          <p class="fw-empty-body">Import any audio or video file, drop one here, or press Record to start a session.</p>
        </section>
        <div class="fw-lanes"></div>
        <input class="fw-file" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.aifc,.caf,.wma,.webm,.mp4,.mov,.mkv,.m4v,.avi,.mxf,.aup,.zip" multiple hidden>
      </main>
      <footer class="fw-transport">
        <div class="fw-transport-controls" role="group" aria-label="Transport">${transportButtons()}</div>
        <output class="fw-clock" role="button" tabindex="0" data-mode="time" title="Click to switch the clock between time and timecode at 24, 25 or 30 frames per second">00:00:00.000</output>
        <label class="fw-speed" title="Play at speed: faster or slower, pitch following (playback only)">Speed <select data-speed aria-label="Playback speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        <label class="fw-speed" title="Recording latency compensation: each take lands this many milliseconds earlier, undoing the round trip from playback to your microphone. Measure it once with a loopback cable (the Measure button beside this field) and type it here; 0 leaves takes where they were recorded">Latency <input type="number" data-latency min="0" max="500" step="1" value="0" aria-label="Recording latency compensation in milliseconds"> ms</label>
      </footer>
    </section>
    <div class="fw-pane-divider" data-side="inspector" role="separator" aria-orientation="vertical" aria-label="Resize the Inspector pane" tabindex="0"></div>
    <aside class="fw-pane fw-pane-inspector" aria-label="Inspector">
      <div class="fw-pane-header"><span class="fw-pane-title">Inspector</span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
      <div class="fw-pane-body fw-inspector-body"></div>
      <div class="fw-insp-strip"><button type="button" class="fw-panel-toggle fw-strip-expand" data-pane="inspector" aria-label="Show the Inspector" title="Show the Inspector">${fvIcon("collapseLeft", 16)}</button><span class="fw-strip-label" aria-hidden="true">Inspector</span></div>
    </aside>
  </div>
  <footer class="fw-status" aria-label="Status">
    <span class="fw-engine" data-state="pending" role="status" aria-live="polite"><span class="fw-engine-dot"></span><span class="fw-engine-text"></span></span>
    <span class="fw-st-rate" title="The session's sample rate"></span>
    <span class="fw-st-tracks"></span>
    <span class="fw-st-length" title="The session's length"></span>
    <label class="fw-st-output" title="Where playback is heard: the browser's own audio, or the engine's native output on a device">Output <select data-output aria-label="Output"></select></label>
    <span class="fw-st-hint"></span>
  </footer>
</div>`;
}

export type ClockMode = "time" | "tc24" | "tc25" | "tc30";
export const CLOCK_MODES: ClockMode[] = ["time", "tc24", "tc25", "tc30"];

export function formatClock(positionSamples: number, sampleRate: number, mode: ClockMode = "time"): string {
  const two = (n: number) => String(n).padStart(2, "0");
  if (mode !== "time") {
    const fps = mode === "tc24" ? 24 : mode === "tc25" ? 25 : 30;
    const totalFrames = Math.floor((positionSamples * fps) / sampleRate);
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
    if (chip.dataset.state !== finalLink.status) chip.dataset.state = finalLink.status;
    setText(chipText, finalLink.status === "ready" ? `Engine ${finalLink.engineVersion ?? ""}`.trim() : "Engine offline");
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
  const renderClock = (t: TransportState) => setText(clock, formatClock(t.positionSamples, t.sampleRate, clockMode));
  const cycleClock = () => {
    clockMode = CLOCK_MODES[(CLOCK_MODES.indexOf(clockMode) + 1) % CLOCK_MODES.length];
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

  engine.subscribe("link", renderLink);
  engine.subscribe("transport", renderClock);
  renderLink(engine.get("link"));
  renderClock(engine.get("transport"));
}
