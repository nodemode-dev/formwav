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
        <button class="fw-ibtn" type="button" data-action="save" title="Save (Cmd or Ctrl S)">${icon("save", ICON_SIZE.control)}<span>Save</span></button>
        <button class="fw-ibtn" type="button" data-action="open" aria-haspopup="dialog" title="Open (Cmd or Ctrl O)">${icon("folderOpen", ICON_SIZE.control)}<span>Open</span></button>
        <button class="fw-ibtn" type="button" data-action="import" title="Import any audio or video file">${icon("upload", ICON_SIZE.control)}<span>Import</span></button>
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
      <span class="fw-engine" data-state="pending" role="status" aria-live="polite">
        <span class="fw-engine-dot"></span>
        <span class="fw-engine-text"></span>
      </span>
      <button class="fw-ibtn fw-btn-export" type="button" data-action="export" title="Export the mix as a WAV file (Cmd or Ctrl Shift E)" disabled>${icon("download", ICON_SIZE.control)}<span>Export</span></button>
    </div>
  </header>
  <div class="fw-workspace">
    <aside class="fw-pane fw-pane-media" aria-label="Media and voice">
      <div class="fw-pane-header"><span class="fw-pane-tabs" role="tablist"><button type="button" class="fw-pane-tab is-active" role="tab" aria-selected="true" data-tab="media">Media</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="voice">Voice</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="transcript">Transcript</button><button type="button" class="fw-pane-tab" role="tab" aria-selected="false" data-tab="labels">Labels</button></span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
      <div class="fw-pane-body fw-media-list" data-panel="media"></div>
      <div class="fw-pane-body fw-voice-body" data-panel="voice" hidden></div>
      <div class="fw-pane-body fw-transcript-body" data-panel="transcript" hidden></div>
      <div class="fw-pane-body fw-labels-body" data-panel="labels" hidden></div>
    </aside>
    <div class="fw-pane-divider" data-side="media" role="separator" aria-orientation="vertical" aria-label="Resize the Media pane" tabindex="0"></div>
    <section class="fw-pane fw-pane-timeline" aria-label="Timeline">
      <div class="fw-tool-tray" role="toolbar" aria-label="Edit modes"></div>
      <main class="fw-stage" data-view="empty">
        <section class="fw-empty">
          <span class="fw-empty-mark">${icon("waveform", ICON_SIZE.mark)}</span>
          <h1 class="fw-empty-title">No session open</h1>
          <p class="fw-empty-body">Import any audio or video file, drop one here, or press Record to start a session.</p>
        </section>
        <div class="fw-lanes"></div>
        <input class="fw-file" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.aifc,.caf,.wma,.webm,.mp4,.mov,.mkv,.m4v,.avi,.mxf" multiple hidden>
      </main>
      <footer class="fw-transport">
        <div class="fw-transport-controls" role="group" aria-label="Transport">${transportButtons()}</div>
        <output class="fw-clock">00:00:00.000</output>
        <label class="fw-speed" title="Play at speed: faster or slower, pitch following (playback only)">Speed <select data-speed aria-label="Playback speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        <label class="fw-speed" title="Recording latency compensation: each take lands this many milliseconds earlier, undoing the round trip from playback to your microphone. Measure it once with a loopback cable (spikes/latency in the planning docs) and type it here; 0 leaves takes where they were recorded">Latency <input type="number" data-latency min="0" max="500" step="1" value="0" aria-label="Recording latency compensation in milliseconds"> ms</label>
      </footer>
    </section>
    <div class="fw-pane-divider" data-side="inspector" role="separator" aria-orientation="vertical" aria-label="Resize the Inspector pane" tabindex="0"></div>
    <aside class="fw-pane fw-pane-inspector" aria-label="Inspector">
      <div class="fw-pane-header"><span class="fw-pane-title">Inspector</span><span class="fw-pane-meta"></span><span class="fw-pane-end"></span></div>
      <div class="fw-pane-body fw-inspector-body"></div>
    </aside>
  </div>
</div>`;
}

export function formatClock(positionSamples: number, sampleRate: number): string {
  const totalMs = Math.floor((positionSamples * 1000) / sampleRate);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  const two = (n: number) => String(n).padStart(2, "0");
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

  const renderClock = (t: TransportState) => setText(clock, formatClock(t.positionSamples, t.sampleRate));

  engine.subscribe("link", renderLink);
  engine.subscribe("transport", renderClock);
  renderLink(engine.get("link"));
  renderClock(engine.get("transport"));
}
