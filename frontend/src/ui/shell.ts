import type { Engine, LinkState, SessionDoc, TransportState } from "../engine";
import { formatPosition, frameRate, parseTimecode, timeContext, timecodeToFrames, type FrameRate, type FrameRateId, type TimeContext, type TimeFormat } from "../engine/timebase";
import { delayedIndicator, mountOnce, setText } from "../vendor/nodemode/dom-stable";
import { ICON_SIZE, icon, type IconName } from "./icons";
import { HOME_HTML } from "./home";

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
      <button type="button" class="fw-identity" aria-label="Home" title="Home: start a session or open a recent one">
        <img class="fw-logo" src="/logo-64.png" width="22" height="22" alt="" draggable="false">
        <span class="fw-name">formwav</span>
      </button>
      <div class="fw-tools" role="group" aria-label="Menus">
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">File</button>
          <div class="cv-menu fw-menu-pop" role="menu" aria-label="File" hidden>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="new" title="Start an empty session at this session's sample rate (Cmd or Ctrl N)"><span>New session</span><kbd>⌘N</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="save" title="Save (Cmd or Ctrl S)">${icon("save", ICON_SIZE.control)}<span>Save</span><kbd>⌘S</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="save-template" title="Save the tracks, buses, routing, effects and automation without the audio, to start new sessions from"><span>Save as template…</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="revert" title="Open the last saved version again, leaving the changes since"><span>Revert to saved</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="open" aria-haspopup="dialog" title="Open (Cmd or Ctrl O)">${icon("folderOpen", ICON_SIZE.control)}<span>Open…</span><kbd>⌘O</kbd></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-action="demo" title="A sixteen-bar session made in code: drums, bass, pad and keys with a reverb bus"><span>Open the demo session</span></button>
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
            <button class="fw-ibtn" type="button" role="menuitem" data-proxy=".fw-identity"><span>Home</span></button>
          </div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Track</button>
          <div class="cv-menu fw-menu-pop fw-track-pop" role="menu" aria-label="Track" hidden></div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Clip</button>
          <div class="cv-menu fw-menu-pop fw-clip-pop" role="menu" aria-label="Clip" hidden></div>
        </div>
        <div class="fw-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Event</button>
          <div class="cv-menu fw-menu-pop fw-event-pop" role="menu" aria-label="Event" hidden></div>
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
        <div class="fw-menu fw-ext-menu">
          <button type="button" class="fw-menu-btn" aria-haspopup="menu" aria-expanded="false">Extensions</button>
          <div class="cv-menu fw-menu-pop fw-ext-pop" role="menu" aria-label="Extensions" hidden>
            <div class="fw-ext-menu-commands" role="none" translate="no"></div>
            <span class="fw-menu-sep fw-ext-menu-sep" hidden></span>
            <button class="fw-ibtn" type="button" role="menuitem" data-ext-act="panel" title="Show the extensions for formwav, their permissions and their state"><span>Extensions panel</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-ext-act="reload" title="Read the installed and development extensions again"><span>Reload extensions</span></button>
            <button class="fw-ibtn" type="button" role="menuitem" data-ext-act="manage" title="Install, update and remove extensions in FormPortal"><span>Manage in FormPortal</span></button>
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
      <span class="fw-title-tools" role="group" aria-label="Theme and commands">
        <button class="fw-tt-btn" type="button" data-action="theme-toggle" aria-label="Switch to a light theme" title="Switch to a light theme"></button>
        <button class="fw-tt-btn" type="button" data-action="search-commands" aria-label="Search commands" title="Search commands (Cmd or Ctrl K)"></button>
      </span>
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
      <label class="fw-browse-search">${SEARCH_ICON}<input type="search" data-browse-search placeholder="Search" aria-label="Search media, effects and sounds" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>
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
      <div class="fw-tool-tray" role="toolbar" aria-label="Arrangement" data-tool="select"><button type="button" class="fw-tb-btn" data-add-track title="A new empty track, to record into or to fill from the browser">Add a track</button><div class="fw-seg fw-tools-seg" role="group" aria-label="Tool"><button type="button" class="fw-seg-btn" data-label="Select" data-tool="select" aria-pressed="true" title="Select, move and trim clips; drag in a clip's upper half to select a range">Select</button><button type="button" class="fw-seg-btn" data-label="Split" data-tool="split" aria-pressed="false" title="Click a clip where it should split">Split</button><button type="button" class="fw-seg-btn" data-label="Fade" data-tool="fade" aria-pressed="false" title="Drag in from a clip's start or end to fade it in or out">Fade</button><button type="button" class="fw-seg-btn" data-label="Zoom" data-tool="zoom" aria-pressed="false" title="Click to zoom in there, Alt-click to zoom out, drag across a span to fill the view with it">Zoom</button></div><div class="fw-zoom" role="group" aria-label="Zoom"><button type="button" class="fw-tb-icon" data-zoom="out" aria-label="Zoom out" title="Zoom out (-)">−</button><button type="button" class="fw-tb-icon" data-zoom="in" aria-label="Zoom in" title="Zoom in (=)">+</button><button type="button" class="fw-tb-btn fw-tb-quiet" data-zoom="fit" title="Fit the whole session in view">Fit</button><button type="button" class="fw-tb-btn fw-tb-quiet fw-follow" data-follow aria-pressed="true" title="Keep the playhead in view while playing">Follow</button></div><span class="fw-tool-hint" aria-live="polite"></span><span class="fw-st-hint"><span class="fw-st-hint-text"></span></span><div class="fw-sel-box"><div class="fw-sel" role="group" aria-label="Selection" title="The selection's start, end and length in the main counter's timebase; the playhead when nothing is selected"><span class="fw-sel-cell" data-sel="start"><span class="fw-sel-label">Start</span><output class="fw-sel-value"></output></span><span class="fw-sel-cell" data-sel="end"><span class="fw-sel-label">End</span><output class="fw-sel-value"></output></span><span class="fw-sel-cell" data-sel="length"><span class="fw-sel-label">Length</span><output class="fw-sel-value"></output></span></div></div><div class="fw-tray-store" aria-hidden="true"><div class="fw-opt-group" data-group="edit" data-label="Edit" role="group" aria-label="Edit"></div><div class="fw-opt-group fw-opt-view" data-group="view" data-label="View" role="group" aria-label="View"><button type="button" class="fw-mode" data-inspector aria-pressed="false" title="Show the Inspector: the selected clip's and the session's settings">Inspector</button><button type="button" class="fw-mode" data-transcript aria-pressed="false">Transcript</button><button type="button" class="fw-mode" data-labels aria-pressed="false">Labels</button></div></div></div>
      <main class="fw-stage" data-view="empty" tabindex="-1">
        <section class="fw-empty">
          <span class="fw-empty-mark"><img class="fw-brand-mark" src="/logo-256.png" width="${ICON_SIZE.mark}" height="${ICON_SIZE.mark}" alt="" draggable="false"></span>
          <h1 class="fw-empty-title">No session open</h1>
          <p class="fw-empty-body">Import any audio or video file, drop one here, or press Record to start a session.</p>
          <div class="fw-empty-actions"><button type="button" class="fw-ibtn fw-empty-import" data-empty-act="import">Import audio</button><button type="button" class="fw-ibtn" data-empty-act="open">Open a session</button><button type="button" class="fw-ibtn" data-empty-act="record" title="Start recording from the microphone into a new track">Record</button><button type="button" class="fw-ibtn" data-empty-act="demo" title="A sixteen-bar session made in code: drums, bass, pad and keys with a reverb bus">Try the demo</button></div>
        </section>
        <div class="fw-lanes"></div>
        <input class="fw-file" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.aifc,.caf,.wma,.webm,.mp4,.mov,.mkv,.m4v,.avi,.mxf,.aup,.aup3,.zip,.mid,.midi,.aaf,.omf,.edl,.fmw" multiple hidden>
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
  ${HOME_HTML}
  <footer class="fw-status" aria-label="Transport and status">
    <div class="fw-transport" role="group" aria-label="Transport and meters">
      <div class="fw-transport-controls" role="group" aria-label="Transport">${transportButtons()}</div>
      <div class="fw-position">
        <output class="fw-clock" role="button" tabindex="0" data-mode="time" aria-haspopup="dialog" title="The main counter: click to choose its timebase, the sub counter, the timecode rate and the rulers">00:00:00.000</output>
        <span class="fw-position-sub"><span class="fw-st-length" title="The session's length"></span><span class="fw-subcounter" hidden></span></span>
      </div>
      <div class="fw-musical" role="group" aria-label="Tempo, meter and snap">
        <button type="button" class="fw-mus" data-mus="tempo" aria-haspopup="dialog" title="The session's tempo, for bars and beats and the grid"><span class="fw-mus-label">Tempo</span><span class="fw-mus-value" data-mus-value="tempo">120</span></button>
        <button type="button" class="fw-mus" data-mus="meter" aria-haspopup="dialog" title="Beats in a bar"><span class="fw-mus-label">Meter</span><span class="fw-mus-value" data-mus-value="meter">4/4</span></button>
        <button type="button" class="fw-mus" data-mus="snap" aria-haspopup="dialog" title="What moves and trims snap to (G turns it on and off), the grid's value and the nudge's"><span class="fw-mus-label">Snap</span><span class="fw-mus-value" data-mus-value="snap">Off</span></button>
      </div>
      <button type="button" class="fw-ibtn fw-speed-btn" popovertarget="fw-speed-pop" title="Playback speed (0.25 to 4 times, pitch following, playback only)" aria-label="Playback speed"><output data-speed-out>1.00×</output></button>
      <div id="fw-speed-pop" class="fw-rec-pop" popover><label class="fw-speed" title="Play at speed: 0.25 to 4 times, pitch following (playback only); double-click for 1×">Speed <input type="range" data-speed min="-2" max="2" step="0.01" value="0" data-default="0" aria-label="Playback speed, as a power of two"></label></div>
      <button type="button" class="fw-ibtn fw-rec-btn" popovertarget="fw-rec-pop" title="Recording settings: latency compensation, Measure, pre-roll" aria-label="Recording settings">Rec</button>
      <div id="fw-rec-pop" class="fw-rec-pop" popover><label class="fw-speed" title="Recording latency compensation: each take lands this many milliseconds earlier, undoing the round trip from playback to your microphone. Measure it once with a loopback cable (the Measure button beside this field) and type it here; 0 leaves takes where they were recorded">Latency <input type="number" data-latency min="0" max="500" step="1" value="0" aria-label="Recording latency compensation in milliseconds"> ms</label>
      <label class="fw-speed" title="Pre-roll: recording rolls this long before the punch point (or the playhead) so you hear the lead-in; only what follows that point is kept">Pre-roll <input type="number" data-preroll min="0" max="10" step="0.5" value="0" aria-label="Pre-roll in seconds"> s</label>
      <label class="fw-speed" title="Post-roll: a punch keeps playing this long after the punch out point so the performer hears the tail; the take still ends at the out point">Post-roll <input type="number" data-postroll min="0" max="10" step="0.5" value="0" aria-label="Post-roll in seconds"> s</label></div>
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

/** PT-26, S6: the main counter's timebases (engine/timebase.ts); Min:Secs keeps the clock's hours-first form. */
export type ClockMode = "time" | "timecode" | "feet" | "samples" | "bars";
export const CLOCK_MODES: readonly { id: ClockMode; format: TimeFormat; label: string }[] = [
  { id: "time", format: "min_secs", label: "Min:Secs" },
  { id: "timecode", format: "timecode", label: "Timecode" },
  { id: "feet", format: "feet_frames", label: "Feet+Frames" },
  { id: "samples", format: "samples", label: "Samples" },
  { id: "bars", format: "bars_beats", label: "Bars|Beats" },
];

// The main counter's timebase, for the ruler, the Big Counter and the readouts to follow (an event tells them when it
// changes); and the rate timecode reads at in a session with none of its own: this browser's clock's rate before S6
let currentMode: ClockMode = "time";
let viewerRate: FrameRateId | undefined;
let applyMode = (mode: ClockMode) => {
  currentMode = mode;
};
export function clockMode(): ClockMode {
  return currentMode;
}
export function setClockMode(mode: ClockMode): void {
  applyMode(mode);
}

/** The frame rate timecode, Feet+Frames and a grid of frames count at: the session's, else this browser's old one. */
export function timecodeRate(doc: SessionDoc): FrameRate {
  return frameRate(doc.frameRate ?? viewerRate);
}

export function timeOf(doc: SessionDoc): TimeContext {
  return timeContext(doc, doc.frameRate ?? viewerRate);
}

/** PT-26: timecode text (hh:mm:ss:ff, ';' before the frames for drop-frame, fewer fields read from the right) as
 *  seconds at `rate`; null if unreadable. */
export function parseTimecodeSeconds(text: string, rate: FrameRate): number | null {
  const tc = parseTimecode(text);
  return tc && !tc.negative ? (timecodeToFrames(tc, rate) * rate.den) / rate.num : null;
}

export function formatClock(positionSamples: number, doc: SessionDoc, mode: ClockMode = "time"): string {
  const two = (n: number) => String(n).padStart(2, "0");
  if (mode !== "time") return formatPosition(positionSamples, CLOCK_MODES.find((m) => m.id === mode)?.format ?? "min_secs", timeOf(doc));
  const sampleRate = doc.sampleRate;
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
    if (stale) setText(host.querySelector(".fw-notice"), `Run formwav_oc_install: the audio core is v${core}`);
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

  // S6: the main counter's timebase is this browser's choice (ui/counters.ts sets it); the timecode rate the clock held
  // before S6 is kept as the rate for sessions that have none of their own
  const CLOCK_KEY = "formwav.clockMode";
  const RATE_KEY = "formwav.timecodeRate";
  const LEGACY: Record<string, FrameRateId> = { tc24: "24", tc25: "25", tc2997df: "29.97df", tc30: "30" };
  try {
    const saved = localStorage.getItem(CLOCK_KEY) ?? "";
    const legacy = LEGACY[saved];
    if (legacy) {
      localStorage.setItem(RATE_KEY, legacy);
      localStorage.setItem(CLOCK_KEY, "timecode");
    }
    if (legacy || CLOCK_MODES.some((m) => m.id === saved)) currentMode = legacy ? "timecode" : (saved as ClockMode);
    viewerRate = (localStorage.getItem(RATE_KEY) as FrameRateId | null) ?? undefined;
  } catch {
    clock?.setAttribute("data-storage", "none");
  }
  // PT-26: timecode reads from the session's timecode start (01:00:00:00 by habit)
  const renderClock = (t: TransportState) => setText(clock, formatClock(t.positionSamples, engine.get("document"), currentMode));
  engine.subscribe("document", () => renderClock(engine.get("transport")));
  applyMode = (mode) => {
    if (mode === currentMode) return;
    currentMode = mode;
    if (clock && clock.dataset.mode !== mode) clock.dataset.mode = mode;
    try {
      localStorage.setItem(CLOCK_KEY, mode);
    } catch {
      clock?.setAttribute("data-storage", "none");
    }
    renderClock(engine.get("transport"));
    document.dispatchEvent(new CustomEvent("fw:clock-mode"));
  };
  if (clock && clock.dataset.mode !== currentMode) clock.dataset.mode = currentMode;

  host.querySelector(".fw-empty-actions")?.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-empty-act]")?.dataset.emptyAct;
    if (act === "import") host.querySelector<HTMLInputElement>(".fw-file")?.click();
    else if (act === "open") host.querySelector<HTMLButtonElement>('.fw-topbar [data-action="open"]')?.click();
    else if (act === "record") host.querySelector<HTMLButtonElement>('.fw-status .fw-tbtn[data-action="record"]')?.click();
    else if (act === "demo") host.querySelector<HTMLButtonElement>('.fw-topbar [data-action="demo"]')?.click();
  });

  const notice = host.querySelector<HTMLElement>(".fw-status .fw-notice");
  if (notice) {
    const mirror = () => {
      const full = notice.textContent ?? "";
      if (full) {
        if (notice.title !== full) notice.title = full;
      } else if (notice.hasAttribute("title")) notice.removeAttribute("title");
    };
    new MutationObserver(mirror).observe(notice, { childList: true, characterData: true, subtree: true });
    mirror();
  }

  engine.subscribe("link", renderLink);
  engine.subscribe("transport", renderClock);
  renderLink(engine.get("link"));
  renderClock(engine.get("transport"));
}
