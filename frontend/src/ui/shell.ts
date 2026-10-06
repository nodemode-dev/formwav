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
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-topbar [data-action="export"]'><span>Export…</span><kbd>⇧⌘E</kbd></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Edit</button>
          <div class="cv-menu fw-menu-pop" role="menu" aria-label="Edit" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tools [data-action="undo"]'><span>Undo</span><kbd>⌘Z</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tools [data-action="redo"]'><span>Redo</span><kbd>⇧⌘Z</kbd></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">View</button>
          <div class="cv-menu fw-menu-pop" role="menu" aria-label="View" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray [data-cliptab]'><span>Clip</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray [data-inspector]'><span>Inspector</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray [data-chain]'><span>Effects</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray [data-synth]'><span>Synth</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray [data-pads]'><span>Pads</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray .fw-mode[title^="Show the mixer"]'><span>Mixer</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray .fw-mode[data-piano]'><span>Notes</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-tool-tray .fw-mode[data-spectrum]'><span>Spectrum</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='[data-action="agent"]'><span>Agent</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='[data-action="terminal"]'><span>Terminal</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy='.fw-panel-toggle[data-pane="media"]'><span>Media pane</span></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Transport</button>
          <div class="cv-menu fw-menu-pop" role="menu" aria-label="Transport" hidden>
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
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="undo" aria-label="Undo" title="Undo" disabled>${icon("undo", ICON_SIZE.control)}</button>
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="redo" aria-label="Redo" title="Redo" disabled>${icon("redo", ICON_SIZE.control)}</button>
      </div>
    </div>
    <div class="fw-topbar-mid">
      <input class="fw-session-name" type="text" value="Untitled session" aria-label="Session name" maxlength="80" spellcheck="false" autocomplete="off">
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
      <div class="fw-tool-tray" role="toolbar" aria-label="Timeline options"><div class="fw-opt-group" data-group="edit" data-label="Edit" role="group" aria-label="Edit"></div><div class="fw-opt-group fw-opt-view" data-group="view" data-label="View" role="group" aria-label="View"><button type="button" class="fw-mode" data-inspector aria-pressed="false" title="Show the Inspector: the selected clip's and the session's settings">Inspector</button></div></div>
      <main class="fw-stage" data-view="empty">
        <section class="fw-empty">
          <span class="fw-empty-mark">${icon("waveform", ICON_SIZE.mark)}</span>
          <h1 class="fw-empty-title">No session open</h1>
          <p class="fw-empty-body">Import any audio or video file, drop one here, or press Record to start a session.</p>
        </section>
        <div class="fw-lanes"></div>
        <input class="fw-file" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.aifc,.caf,.wma,.webm,.mp4,.mov,.mkv,.m4v,.avi,.mxf,.aup,.aup3,.zip,.mid,.midi,.aaf,.edl" multiple hidden>
      </main>
      <section class="fw-pane fw-pane-inspector" aria-label="Inspector" hidden>
        <div class="fw-pane-header"><span class="fw-pane-title">Inspector</span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
        <div class="fw-pane-body fw-inspector-body"></div>
      </section>
      <footer class="fw-dock-anchor" aria-hidden="true"></footer>
    </section>
    <div class="fw-pane-divider" data-side="inspector" role="separator" aria-orientation="vertical" aria-label="Resize the agent column" tabindex="0"></div>
    <aside class="fw-pane fw-pane-agent" aria-label="Agent"><div class="fw-agent-anchor"></div></aside>
  </div>
  <footer class="fw-status" aria-label="Transport and status">
    <div class="fw-transport" role="group" aria-label="Transport and meters">
      <div class="fw-transport-controls" role="group" aria-label="Transport">${transportButtons()}</div>
      <output class="fw-clock" role="button" tabindex="0" data-mode="time" title="Click to switch the clock between time and timecode at 24, 25 or 30 frames per second">00:00:00.000</output>
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
        <span class="fw-st-tracks"></span>
        <span class="fw-st-length" title="The session's length"></span>
        <label class="fw-st-output" title="Where playback is heard: the browser's own audio, or the engine's native output on a device">Output <select data-output aria-label="Output"></select></label>
        <span class="fw-st-hint"></span>
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

  engine.subscribe("link", renderLink);
  engine.subscribe("transport", renderClock);
  renderLink(engine.get("link"));
  renderClock(engine.get("transport"));
}
