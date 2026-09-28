import type { Engine, LinkState, TransportState } from "../engine";
import { delayedIndicator, mountOnce, setText } from "../vendor/nodemode/dom-stable";
import { ICON_SIZE, icon, type IconName } from "./icons";

const TRANSPORT: { name: IconName; label: string }[] = [
  { name: "skipBack", label: "Go to start" },
  { name: "play", label: "Play" },
  { name: "stop", label: "Stop" },
  { name: "record", label: "Record" },
  { name: "loop", label: "Loop" },
];

function transportButtons(): string {
  return TRANSPORT.map(
    (b) =>
      `<button class="fw-tbtn" type="button" disabled aria-label="${b.label}" title="${b.label} · arrives in v0.2.0">${icon(b.name, ICON_SIZE.transport)}</button>`,
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
    <div class="fw-topbar-mid"></div>
    <div class="fw-topbar-actions">
      <span class="fw-engine" data-state="pending" role="status" aria-live="polite">
        <span class="fw-engine-dot"></span>
        <span class="fw-engine-text"></span>
      </span>
    </div>
  </header>
  <main class="fw-stage">
    <section class="fw-empty">
      <span class="fw-empty-mark">${icon("waveform", ICON_SIZE.mark)}</span>
      <h1 class="fw-empty-title">No session open</h1>
      <p class="fw-empty-body">Importing, recording and editing arrive in v0.2.0. This build brings up the shell, the engine link and the themes.</p>
    </section>
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
