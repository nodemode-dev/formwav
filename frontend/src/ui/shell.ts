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
    <div class="fw-identity">
      <img class="fw-logo" src="/favicon-32.png" width="20" height="20" alt="">
      <span class="fw-name">formwav</span>
    </div>
    <div class="fw-topbar-mid">
      <div class="fw-tools" role="group" aria-label="Session">
        <input class="fw-session-name" type="text" value="Untitled session" aria-label="Session name" maxlength="80" spellcheck="false" autocomplete="off">
        <button class="fw-ibtn" type="button" data-action="save" title="Save (Cmd or Ctrl S)">${icon("save", ICON_SIZE.control)}<span>Save</span></button>
        <button class="fw-ibtn" type="button" data-action="open" aria-haspopup="dialog" title="Open (Cmd or Ctrl O)">${icon("folderOpen", ICON_SIZE.control)}<span>Open</span></button>
        <button class="fw-ibtn" type="button" data-action="import">${icon("upload", ICON_SIZE.control)}<span>Import</span></button>
        <button class="fw-ibtn" type="button" data-action="export" title="Export the mix as a WAV file (Cmd or Ctrl Shift E)" disabled>${icon("download", ICON_SIZE.control)}<span>Export</span></button>
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="undo" aria-label="Undo" title="Undo" disabled>${icon("undo", ICON_SIZE.control)}</button>
        <button class="fw-ibtn fw-ibtn-icon" type="button" data-action="redo" aria-label="Redo" title="Redo" disabled>${icon("redo", ICON_SIZE.control)}</button>
      </div>
      <span class="fw-notice" role="status" aria-live="polite"></span>
    </div>
    <div class="fw-topbar-actions">
      <span class="fw-engine" data-state="pending" role="status" aria-live="polite">
        <span class="fw-engine-dot"></span>
        <span class="fw-engine-text"></span>
      </span>
    </div>
  </header>
  <main class="fw-stage" data-view="empty">
    <section class="fw-empty">
      <span class="fw-empty-mark">${icon("waveform", ICON_SIZE.mark)}</span>
      <h1 class="fw-empty-title">No session open</h1>
      <p class="fw-empty-body">Import a WAV file, drop one here, or press Record to start a session.</p>
    </section>
    <div class="fw-lanes"></div>
    <input class="fw-file" type="file" accept=".wav,audio/wav,audio/x-wav,audio/wave" multiple hidden>
  </main>
  <footer class="fw-transport">
    <div class="fw-transport-controls" role="group" aria-label="Transport">${transportButtons()}</div>
    <output class="fw-clock">00:00:00.000</output>
  </footer>
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
