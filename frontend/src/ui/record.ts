import type { Engine, TransportState } from "../engine";
import type { Player } from "../audio/player";
import { encodeWav, startRecording, type Recording } from "../audio/recorder";
import { importFile } from "../io/media-client";
import { setText } from "../vendor/nodemode/dom-stable";
import { armedTrack, recordingTrack, setRecordingTrack } from "./arm";
import { punchEnabled } from "./grid";

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
  const label = document.createElement("span");
  label.className = "fw-meter-label";
  label.textContent = "IN";
  transport?.append(label, meter);

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
    const target = recordingTrack();
    if (target) {
      for (const laneBar of host.querySelectorAll<HTMLElement>(`.fw-lane[data-key="${target}"] .fw-lane-meter .fw-out-bar`)) {
        if (laneBar.style.transform !== scale) laneBar.style.transform = scale;
      }
    }
  };
  showLevel(0);

  const supported = typeof navigator.mediaDevices?.getUserMedia === "function";
  if (record) {
    if (supported) record.disabled = false;
    else record.title = "Recording needs microphone access, which this browser does not offer";
  }

  let active: Recording | null = null;
  let punchRange: { start: number; end: number } | null = null;
  let lastPosition = 0;

  /** Cut the track's clips at the punch in and out points: keep what lies outside, remove what lies inside. */
  const punchCommands = (trackId: string, from: number, to: number): Parameters<Engine["dispatch"]>[0][] => {
    const commands: Parameters<Engine["dispatch"]>[0][] = [];
    for (const c of engine.get("document").tracks.find((t) => t.id === trackId)?.clips ?? []) {
      const end = c.start + c.length;
      if (end <= from || c.start >= to) continue;
      if (c.start < from) {
        commands.push({ type: "set-clip-bounds", trackId, clipId: c.id, start: c.start, sourceIn: c.sourceIn, length: from - c.start });
        commands.push({ type: "set-clip-fades", trackId, clipId: c.id, fadeIn: Math.min(c.fadeIn ?? 0, from - c.start), fadeOut: 0 });
      } else commands.push({ type: "remove-clip", trackId, clipId: c.id });
      if (end > to) {
        commands.push({
          type: "paste-clip",
          trackId,
          clip: { mediaId: c.mediaId, start: to, length: end - to, sourceIn: c.sourceIn + (to - c.start), gainDb: c.gainDb, fadeIn: 0, fadeOut: Math.min(c.fadeOut ?? 0, end - to), fadeShape: c.fadeShape },
        });
      }
    }
    return commands;
  };
  let busy = false;
  let takes = 0;

  const begin = async () => {
    busy = true;
    try {
      setText(notice, "Waiting for the microphone");
      const doc = engine.get("document");
      const armed = doc.tracks.find((t) => t.id === armedTrack());
      setRecordingTrack(armed?.id ?? null);
      const position = engine.get("transport").positionSamples;
      punchRange = punchEnabled() && armed && doc.loop && doc.loop.end > Math.max(doc.loop.start, position) ? { start: doc.loop.start, end: doc.loop.end } : null;
      lastPosition = position;
      active = await startRecording(player, position, showLevel);
      engine.setTransport({ recording: true });
      const seconds = (s: number) => (s / doc.sampleRate).toFixed(3);
      setText(
        notice,
        punchRange && armed
          ? `Punching in ${seconds(punchRange.start)} to ${seconds(punchRange.end)} s on ${armed.name}`
          : armed
            ? `Recording into ${armed.name}`
            : punchEnabled()
              ? "Recording (arm a track to punch in)"
              : "Recording",
      );
    } catch (err) {
      active = null;
      punchRange = null;
      setRecordingTrack(null);
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
      const punch = punchRange;
      punchRange = null;
      const target = recordingTrack();
      let channels = take.channels;
      let at = current.startPosition;
      if (punch && target) {
        const from = Math.max(0, punch.start - current.startPosition);
        const to = Math.min(take.frames, punch.end - current.startPosition);
        if (to <= from) {
          setText(notice, "Stopped before the punch range; nothing was recorded");
          return;
        }
        channels = take.channels.map((c) => c.slice(from, to));
        at = current.startPosition + from;
      }
      takes++;
      const file = new File([encodeWav(channels, take.sampleRate)], `Take ${takes}.wav`, { type: "audio/wav" });
      const media = await importFile(file);
      const cuts = punch && target ? punchCommands(target, at, at + channels[0].length) : [];
      engine.dispatch({ type: "batch", commands: [...cuts, { type: "import-media", media, at, trackId: target ?? undefined }] });
      setText(notice, punch && target ? `Punched in ${file.name}` : `Recorded ${file.name}`);
    } catch (err) {
      setText(notice, `Could not save the take: ${reason(err)}`);
    } finally {
      busy = false;
      setRecordingTrack(null);
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
  engine.subscribe("transport", (t) => {
    const range = punchRange;
    if (!active || busy || !range) return;
    const wrapped = t.positionSamples < lastPosition;
    lastPosition = t.positionSamples;
    if (t.positionSamples >= range.end || wrapped) void finish();
  });
  renderRecording(engine.get("transport"));
}
