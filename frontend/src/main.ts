import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/light-mode.css";
import "./styles/shell.css";
import "./styles/workspace.css";
import "./styles/scrollbars.css";
import { createEngine } from "./engine";
import { activateAll } from "./extensions/registry";
import "./extensions/engine-link";
import { mountShell } from "./ui/shell";
import { mountSession } from "./ui/session";
import { mountTransport } from "./ui/transport";
import { mountLoop } from "./ui/loop";
import { mountExport } from "./ui/export";
import { mountNormalize } from "./ui/normalize";
import { mountTerminal } from "./ui/terminal-pane";
import { mountAgent } from "./ui/agent-pane";
import { mountRuler } from "./ui/ruler";
import { mountGrid } from "./ui/grid";
import { mountOutputMeter, mountTrackMeters } from "./ui/meter";
import { mountMixer } from "./ui/mixer";
import { mountMediaPane } from "./ui/media-pane";
import { mountInspector } from "./ui/inspector-pane";
import { mountVoicePane } from "./ui/voice-pane";
import { mountTranscriptPane } from "./ui/transcript-pane";
import { mountLabelsPane } from "./ui/labels-pane";
import { mountSpectrogramView } from "./ui/spectrogram-view";
import { mountWorkspaceLayout } from "./ui/workspace-layout";
import { mountRecord } from "./ui/record";
import { mountProjects } from "./ui/projects";
import { Player } from "./audio/player";
import { revealApp } from "./vendor/nodemode/dom-stable";
import { applyTheme } from "./vendor/formvis/themes";

applyTheme();
const engine = createEngine();
const player = new Player(engine);
const host = document.getElementById("app");
if (host) {
  mountShell(host, engine);
  mountSession(host, engine);
  mountTransport(host, engine, player);
  // Double-click a slider to reset it to its default (Audacity's controls, as a reference): the same input and change
  // events a drag fires, so each slider's own handler records the change and undo works as usual. The double-click's
  // first press moves the thumb and can record a step of its own (volume went to its midpoint, -24 dB, and one undo
  // landed there); that step is undone before the reset, so one undo returns to the value before the double-click.
  let press: { el: HTMLInputElement; depth: number; at: number } | null = null;
  host.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
      if (press && press.el === el && e.timeStamp - press.at < 600) return;
      press = { el, depth: engine.get("history").undoDepth, at: e.timeStamp };
    },
    true,
  );
  host.addEventListener("dblclick", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "range" || el.disabled || el.dataset.default === undefined) return;
    if (press && press.el === el && engine.get("history").undoDepth === press.depth + 1) engine.undo();
    press = null;
    // Always applied: after that undo the focused slider can still read the default while the document does not
    // (pan's midpoint is its default), and the reducers ignore a change to the value already held.
    el.value = el.dataset.default;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  mountLoop(host, engine);
  mountExport(host, engine);
  mountNormalize(host, engine);
  mountTerminal(host);
  mountAgent(host, engine);
  mountRuler(host, engine, player);
  mountGrid(host);
  mountOutputMeter(host, player);
  mountTrackMeters(host, engine, player);
  mountMixer(host, engine, player);
  mountMediaPane(host, engine);
  mountInspector(host, engine);
  mountVoicePane(host, engine);
  mountTranscriptPane(host, engine, player);
  mountLabelsPane(host, engine, player);
  mountSpectrogramView(host, engine);
  mountWorkspaceLayout(host);
  mountRecord(host, engine, player);
  mountProjects(host, engine, player);
}
if (import.meta.env.DEV) Object.assign(window, { __formwav: { engine, player } });
activateAll(engine);
// The suite's faces are requested by name before the reveal: fonts.ready alone resolved before Inter had been asked
// for, so on a slow network the app showed in a fallback face and shifted when Inter swapped in. Never longer than 4 s.
Promise.race([
  Promise.all(["400 13px Inter", "500 13px Inter", "600 13px Inter", '400 12px "JetBrains Mono"'].map((face) => document.fonts.load(face))).then(() => document.fonts.ready),
  new Promise((done) => setTimeout(done, 4000)),
]).then(revealApp, revealApp);
