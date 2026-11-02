import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/light-mode.css";
import "./styles/shell.css";
import "./styles/workspace.css";
import "./styles/frame.css";
import "./styles/surfaces.css";
import "./styles/canvas.css";
import "./styles/scrollbars.css";
import "./styles/terminal-dock.css";
import "./styles/home.css";
import "./styles/prefs.css";
import "./styles/desktop.css";
import "./styles/form-family.css";
import { createEngine } from "./engine";
import { activateAll } from "./extensions/registry";
import "./extensions/engine-link";
import { mountShell } from "./ui/shell";
import { mountCounters } from "./ui/counters";
import { mountSession } from "./ui/session";
import { mountTransport } from "./ui/transport";
import { mountLoop } from "./ui/loop";
import { mountExport } from "./ui/export";
import { mountNormalize } from "./ui/normalize";
import { mountTerminalDock } from "./ui/terminal-dock";
import { mountAgent } from "./ui/agent-pane";
import { mountRuler } from "./ui/ruler";
import { mountGrid } from "./ui/grid";
import { mountOutputMeter, mountTrackMeters } from "./ui/meter";
import { mountDrawTool } from "./ui/draw-tool";
import { mountPicture } from "./ui/picture";
import { mountPictureLane } from "./ui/picture-lane";
import { mountMidiInput } from "./ui/midi-input";
import { mountMixer } from "./ui/mixer";
import { mountMediaPane } from "./ui/media-pane";
import { mountModelsPane } from "./ui/models-pane";
import { mountInspector } from "./ui/inspector-pane";
import { mountVoicePane } from "./ui/voice-pane";
import { mountTranscriptPane } from "./ui/transcript-pane";
import { mountLabelsPane } from "./ui/labels-pane";
import { mountSpectrogramView } from "./ui/spectrogram-view";
import { mountWorkspaceLayout } from "./ui/workspace-layout";
import { mountRecord } from "./ui/record";
import { mountLatencyProbe } from "./ui/latency-probe";
import { mountStatusBar } from "./ui/status-bar";
import { mountFileMenu } from "./ui/file-menu";
import { mountThemeMenu } from "./ui/theme-menu";
import { mountTitleTools } from "./ui/title-tools";
import { mountHome } from "./ui/home";
import { mountPreferences } from "./ui/prefs";
import { desktopReady, mountDesktop } from "./ui/desktop";
import { mountLanguage, startI18n } from "./ui/i18n";
import { mountEditorTabs } from "./ui/editor-tabs";
import { mountClipTab } from "./ui/clip-tab";
import { mountBrowserEffects } from "./ui/browser-effects";
import { mountBrowser } from "./ui/browser";
import { mountMusical } from "./ui/musical";
import { commands, mountPalette } from "./ui/commands";
import { mountShortcutsPanel } from "./ui/shortcuts-panel";
import { mountAutosave } from "./ui/autosave";
import { mountToolbar } from "./ui/toolbar";
import { mountEditing } from "./ui/editing";
import { mountDock } from "./ui/dock";
import { mountOutputSelect, outputDeviceNames } from "./ui/output-select";
import { renderNotes } from "./audio/notes";
import { mountPianoRoll } from "./ui/piano-roll";
import { mountNoteEvents } from "./ui/note-events";
import { mountSpectrum } from "./ui/spectrum";
import { mountScore } from "./ui/score";
import { mountEnvelopeEdit } from "./ui/envelope-edit";
import { mountProjects } from "./ui/projects";
import { mountCloud } from "./ui/cloud";
import { bindInputs, inputDeviceNames } from "./ui/inputs";
import { mountRoom } from "./ui/room";
import { mountShare } from "./ui/share";
import { mountAgents } from "./ui/agents";
import { Player, type OutputChoice } from "./audio/player";
import { revealApp } from "./vendor/nodemode/dom-stable";
import { applyTheme } from "./vendor/formvis/themes";

// The engine refuses a change (POST, PUT, PATCH, DELETE under /api) without x-formwav-local, which a foreign page
// cannot send; every request this app makes goes through fetch, so the header is added here once, for its own origin.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || method === "GET" || method === "HEAD") return nativeFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("x-formwav-local", "1");
  return nativeFetch(input, { ...init, headers });
};

applyTheme();
const engine = createEngine();
const player = new Player(engine);
// AU-22: the Inspector's output device, rate and channel map reach the player
document.addEventListener("fw-output", (e) => void player.setOutput((e as CustomEvent<Partial<OutputChoice>>).detail));
const host = document.getElementById("app");
const i18nReady = startI18n(() => {
  const doc = engine.get("document");
  return [
    ...doc.tracks.flatMap((t) => [t.name, ...t.clips.map((c) => c.name ?? "")]),
    ...Object.values(doc.media).map((m) => m.name),
    ...(doc.buses ?? []).map((b) => b.name),
    ...(doc.vcas ?? []).map((v) => v.name),
    ...doc.markers.map((m) => m.label),
    ...(doc.regions ?? []).map((r) => r.label),
    document.querySelector<HTMLInputElement>(".fw-session-name")?.value ?? "",
    ...inputDeviceNames(),
    ...outputDeviceNames(),
  ];
});
if (host) {
  mountShell(host, engine);
  mountCounters(host, engine);
  mountSession(host, engine);
  mountTransport(host, engine, player);
  // Double-click a slider to reset it to its default: the same input and change
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
  mountAgent(host, engine);
  mountRuler(host, engine, player);
  mountPictureLane(host, engine, player); // PLAN_v13 S15: the picture's frames along the timeline
  mountGrid(host, engine);
  mountOutputMeter(host, player);
  mountTrackMeters(host, engine, player);
  mountMixer(host, engine, player);
  // AU-37: MIDI inputs play the live instrument and record into note clips; a kept or failed take is told on the notice line
  mountMidiInput(engine, player, (text) => {
    const line = host.querySelector<HTMLElement>(".fw-notice");
    if (line && line.textContent !== text) line.textContent = text;
  });
  mountDrawTool(host, engine); // AU-13: the Draw tool, drawing samples in the lanes at sample zoom
  mountPicture(host, engine); // PT-26: a video in step with the transport, for sound to picture
  const notesEditor = mountPianoRoll(host, engine);
  if (notesEditor) mountNoteEvents(host, engine, notesEditor);
  mountSpectrum(host, engine, player);
  mountScore(host, engine);
  mountEnvelopeEdit(host, engine);
  mountMediaPane(host, engine, player);
  mountModelsPane(host, engine);
  mountInspector(host, engine);
  mountVoicePane(host, engine);
  mountTranscriptPane(host, engine, player);
  mountLabelsPane(host, engine, player);
  mountSpectrogramView(host, engine);
  mountWorkspaceLayout(host);
  mountRecord(host, engine, player);
  mountLatencyProbe(host);
  mountStatusBar(host, engine);
  mountOutputSelect(host, player);
  mountFileMenu(host);
  mountThemeMenu(host);
  mountTitleTools(host);
  mountDesktop(host); // the desktop app's chrome; nothing in a browser
  mountLanguage(host);
  mountClipTab(host, engine);
  mountEditorTabs(host, engine, player);
  mountBrowserEffects(host, engine);
  mountBrowser(host, engine);
  mountDock(host, engine);
  mountTerminalDock(host, engine);
  host.querySelector<HTMLButtonElement>(".fw-tool-tray [data-cliptab]")?.click();
  bindInputs(engine); // track inputs live in the session (Track.input)
  mountProjects(host, engine, player);
  mountHome(host, engine); // formvis's Home: at launch with no session, from the brand and View > Home
  mountCloud(host, engine);
  mountRoom(host, engine);
  mountShare(host, engine);
  mountAgents(host);
  mountPreferences(host); // formvis's Preferences: Settings > Preferences…, Cmd or Ctrl comma
  mountMusical(host, engine);
  mountToolbar(host, engine);
  mountEditing(host, engine, player);
  mountPalette(host, engine); // PLAN_v14 W2: the command registry's palette, Cmd or Ctrl K
  commands.gather(host);
  mountShortcutsPanel(host); // PLAN_v13 S13: View > Keyboard shortcuts, or ?
  mountAutosave(host, engine); // PLAN_v14 W4: unsaved work kept every 30 s and offered back on the next start
}
if (import.meta.env.DEV) Object.assign(window, { __formwav: { engine, player, renderNotes } });
activateAll(engine);
// the desktop app's splash ends once the page has painted (app_ready, two frames after app-ready is set)
const reveal = () => {
  revealApp();
  requestAnimationFrame(() => requestAnimationFrame(desktopReady));
};
// The suite's faces are requested by name before the reveal: fonts.ready alone resolved before Inter had been asked
// for, so on a slow network the app showed in a fallback face and shifted when Inter swapped in. Never longer than 4 s.
Promise.race([
  Promise.all(["400 13px Inter", "500 13px Inter", "600 13px Inter", '400 12px "JetBrains Mono"', '700 24px "JetBrains Mono"'].map((face) => document.fonts.load(face))).then(() => document.fonts.ready).then(() => i18nReady),
  new Promise((done) => setTimeout(done, 4000)),
]).then(reveal, reveal);
