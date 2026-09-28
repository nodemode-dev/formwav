import type { Engine, TransportState } from "../engine";
import type { Player } from "../audio/player";
import { encodeWav, startRecording, type Recording } from "../audio/recorder";
import { importFile } from "../io/media-client";
import { setText } from "../vendor/nodemode/dom-stable";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function mountRecord(host: HTMLElement, engine: Engine, player: Player): void {
  const record = host.querySelector<HTMLButtonElement>('.fw-tbtn[data-action="record"]');
  const stop = host.querySelector<HTMLButtonElement>('.fw-tbtn[data-action="stop"]');
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const transport = host.querySelector<HTMLElement>(".fw-transport");

  const meter = document.createElement("div");
  meter.className = "fw-meter";
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-label", "Input level");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "1");
  meter.setAttribute("aria-valuenow", "0");
  const bar = document.createElement("div");
  bar.className = "fw-meter-bar";
  meter.append(bar);
  transport?.append(meter);

  let lastScale = "";
  let lastNow = "0";
  const showLevel = (peak: number) => {
    const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const v = Math.max(0, Math.min(1, (db + 60) / 60));
    const scale = `scaleX(${v.toFixed(3)})`;
    if (scale !== lastScale) {
      lastScale = scale;
      bar.style.transform = scale;
    }
    const now = v.toFixed(1);
    if (now !== lastNow) {
      lastNow = now;
      meter.setAttribute("aria-valuenow", now);
    }
  };
  showLevel(0);

  const supported = typeof navigator.mediaDevices?.getUserMedia === "function";
  if (record) {
    if (supported) record.disabled = false;
    else record.title = "Recording needs microphone access, which this browser does not offer";
  }

  let active: Recording | null = null;
  let busy = false;
  let takes = 0;

  const begin = async () => {
    busy = true;
    try {
      setText(notice, "Waiting for the microphone");
      active = await startRecording(player, engine.get("transport").positionSamples, showLevel);
      engine.setTransport({ recording: true });
      setText(notice, "Recording");
    } catch (err) {
      active = null;
      const refused = err instanceof DOMException && err.name === "NotAllowedError";
      setText(notice, refused ? "Microphone access was refused" : `Could not start recording: ${reason(err)}`);
    } finally {
      busy = false;
    }
  };

  const finish = async () => {
    const current = active;
    if (!current) return;
    active = null;
    busy = true;
    engine.setTransport({ recording: false });
    player.stop();
    try {
      setText(notice, "Saving take");
      const take = await current.stop();
      showLevel(0);
      if (!take.frames) {
        setText(notice, "Nothing was recorded");
        return;
      }
      takes++;
      const file = new File([encodeWav(take.channels, take.sampleRate)], `Take ${takes}.wav`, { type: "audio/wav" });
      const media = await importFile(file);
      engine.dispatch({ type: "import-media", media, at: current.startPosition });
      setText(notice, `Recorded ${file.name}`);
    } catch (err) {
      setText(notice, `Could not save the take: ${reason(err)}`);
    } finally {
      busy = false;
    }
  };

  const toggle = () => {
    if (busy || !supported) return;
    if (active) void finish();
    else void begin();
  };

  record?.addEventListener("click", toggle);
  stop?.addEventListener("click", () => {
    if (active) void finish();
  });
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "r") return;
    e.preventDefault();
    toggle();
  });
  const renderRecording = (t: TransportState) => {
    const pressed = String(t.recording);
    if (record && record.getAttribute("aria-pressed") !== pressed) record.setAttribute("aria-pressed", pressed);
    const stopEnabled = t.recording || engine.get("document").tracks.length > 0;
    if (stop && stop.disabled === stopEnabled) stop.disabled = !stopEnabled;
  };
  engine.subscribe("transport", renderRecording);
  renderRecording(engine.get("transport"));
}
