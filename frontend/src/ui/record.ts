import type { Engine, TransportState } from "../engine";
import type { Player } from "../audio/player";
import { encodeWav, startRecording, type Recording, type Take } from "../audio/recorder";
import { onMonitorChanged, trackInput, trackMonitor } from "./inputs";
import { importFile } from "../io/media-client";
import { setText } from "../vendor/nodemode/dom-stable";
import { addRecordingTrack, armedTrack, armedTracks, recordingTrack, setRecordingTrack } from "./arm";
import { punchEnabled } from "./grid";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function mountRecord(host: HTMLElement, engine: Engine, player: Player): void {
  const record = host.querySelector<HTMLButtonElement>('.fw-tbtn[data-action="record"]');
  const stop = host.querySelector<HTMLButtonElement>('.fw-tbtn[data-action="stop"]');
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const transport = host.querySelector<HTMLElement>(".fw-transport");
  const latencyField = host.querySelector<HTMLInputElement>("[data-latency]");
  const LATENCY_KEY = "formwav.recordLatencyMs";
  const latencyMs = (): number => Math.min(500, Math.max(0, Number(latencyField?.value) || 0));
  try {
    const saved = localStorage.getItem(LATENCY_KEY);
    if (latencyField && saved !== null && latencyField.value !== saved) latencyField.value = saved;
  } catch {
    latencyField?.setAttribute("data-storage", "none");
  }
  latencyField?.addEventListener("change", () => {
    if (latencyField.value !== String(latencyMs())) latencyField.value = String(latencyMs());
    try {
      localStorage.setItem(LATENCY_KEY, latencyField.value);
    } catch {
      latencyField.setAttribute("data-storage", "none");
    }
  });
  // Punch and roll, lead-in recording (AU-19): recording rolls this long before the punch point, or before the
  // playhead, so the performer hears the lead-in; only what follows that point is kept
  const prerollField = host.querySelector<HTMLInputElement>("[data-preroll]");
  const PREROLL_KEY = "formwav.prerollSeconds";
  const prerollSeconds = (): number => Math.min(10, Math.max(0, Number(prerollField?.value) || 0));
  try {
    const saved = localStorage.getItem(PREROLL_KEY);
    if (prerollField && saved !== null && prerollField.value !== saved) prerollField.value = saved;
  } catch {
    prerollField?.setAttribute("data-storage", "none");
  }
  prerollField?.addEventListener("change", () => {
    if (prerollField.value !== String(prerollSeconds())) prerollField.value = String(prerollSeconds());
    try {
      localStorage.setItem(PREROLL_KEY, prerollField.value);
    } catch {
      prerollField.setAttribute("data-storage", "none");
    }
  });

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

  /** An extra armed track's input level, drawn on its own lane meter. */
  const laneLevel = (trackId: string) => (peak: number) => {
    const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const scale = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;
    for (const laneBar of host.querySelectorAll<HTMLElement>(`.fw-lane[data-key="${trackId}"] .fw-lane-meter .fw-out-bar`)) {
      if (laneBar.style.transform !== scale) laneBar.style.transform = scale;
    }
  };
  let active: Recording | null = null;
  let extras: { trackId: string; rec: Recording }[] = [];
  onMonitorChanged((trackId, on) => {
    if (active && trackId === armedTrack()) active.setMonitor(on);
    for (const x of extras) if (x.trackId === trackId) x.rec.setMonitor(on);
  });
  let punchRange: { start: number; end: number } | null = null;
  /** With a pre-roll and no punch or loop range: the frame where the kept take begins (the playhead at Record). */
  let leadIn: number | null = null;
  let loopRange: { start: number; end: number } | null = null;
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
      loopRange = !punchRange && doc.loop?.enabled && doc.loop.end > Math.max(doc.loop.start, position) ? { start: doc.loop.start, end: doc.loop.end } : null;
      // the roll: playback and capture start the pre-roll before the punch point (or the playhead); the take keeps
      // only the punch range, or with no punch range only what follows the playhead (lead-in recording)
      const roll = Math.round(prerollSeconds() * doc.sampleRate);
      const recordAt = punchRange ? punchRange.start : position;
      const rollFrom = roll > 0 ? Math.max(0, recordAt - roll) : position;
      leadIn = roll > 0 && !punchRange && !loopRange ? recordAt : null;
      // startRecording plays from the player's current position and only labels the take with the one it is given:
      // the player must be at the roll point first, or the label and the audio disagree
      if (rollFrom !== position) player.seek(rollFrom);
      lastPosition = rollFrom;
      active = await startRecording(player, rollFrom, showLevel, armed ? trackInput(armed.id) : "", armed ? trackMonitor(armed.id) : false);
      const missed: string[] = [];
      for (const id of armedTracks().slice(1)) {
        const track = doc.tracks.find((t) => t.id === id);
        if (!track) continue;
        try {
          extras.push({ trackId: id, rec: await startRecording(player, rollFrom, laneLevel(id), trackInput(id), trackMonitor(id), false) });
          addRecordingTrack(id);
        } catch {
          missed.push(track.name);
        }
      }
      engine.setTransport({ recording: true });
      const seconds = (s: number) => (s / doc.sampleRate).toFixed(3);
      const more = extras.length ? ` and ${extras.length} more track${extras.length === 1 ? "" : "s"}` : "";
      const skipped = missed.length ? `; ${missed.join(", ")} could not open ${missed.length === 1 ? "its" : "their"} input` : "";
      setText(
        notice,
        (punchRange && armed
          ? `Punching in ${seconds(punchRange.start)} to ${seconds(punchRange.end)} s on ${armed.name}${more}`
          : loopRange
            ? `Loop recording ${seconds(loopRange.start)} to ${seconds(loopRange.end)} s${armed ? ` on ${armed.name}${more}` : ""}: each pass is a take`
            : armed
              ? `Recording into ${armed.name}${more}`
              : punchEnabled()
                ? "Recording (arm a track to punch in)"
                : "Recording") + skipped,
      );
    } catch (err) {
      active = null;
      for (const x of extras) void x.rec.stop();
      extras = [];
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
    const others = extras;
    extras = [];
    busy = true;
    engine.setTransport({ recording: false });
    player.stop();
    try {
      setText(notice, others.length ? `Saving ${others.length + 1} takes` : "Saving take");
      const take = await current.stop();
      const otherTakes = await Promise.all(others.map((x) => x.rec.stop()));
      showLevel(0);
      for (const x of others) laneLevel(x.trackId)(0);
      if (!take.frames) {
        setText(notice, "Nothing was recorded");
        return;
      }
      const punch = punchRange;
      punchRange = null;
      const lead = leadIn;
      leadIn = null;
      const loop = loopRange;
      loopRange = null;
      const lag = Math.round((latencyMs() / 1000) * take.sampleRate);
      const commands: Parameters<Engine["dispatch"]>[0][] = [];
      /** One take onto one track, `offset` frames after the primary's first sample; a string says why nothing was placed. */
      const place = async (t: Take, target: string | null, offset: number): Promise<string | { name: string; shape?: { takes: number[] } }> => {
        const start = current.startPosition + offset;
        const drop = Math.max(0, lag - start);
        const origin = start - lag + drop;
        const frames = t.frames - drop;
        if (frames <= 0) return "The take is shorter than the latency compensation; nothing was recorded";
        let channels = drop ? t.channels.map((c) => c.subarray(drop)) : t.channels;
        let at = origin;
        if (punch && target) {
          const from = Math.max(0, punch.start - origin);
          const to = Math.min(frames, punch.end - origin);
          if (to <= from) return "Stopped before the punch range; nothing was recorded";
          channels = channels.map((c) => c.slice(from, to));
          at = origin + from;
        } else if (lead !== null) {
          // lead-in recording: the pre-roll was heard, not kept; the take begins at the playhead where Record was pressed
          const from = Math.max(0, lead - origin);
          if (from >= frames) return "Stopped during the pre-roll; nothing was recorded";
          channels = channels.map((c) => c.subarray(from));
          at = origin + from;
        }
        takes++;
        const file = new File([encodeWav(channels, t.sampleRate)], `Take ${takes}.wav`, { type: "audio/wav" });
        const session = engine.get("document");
        const media = await importFile(file, session.tracks.length ? session.sampleRate : undefined);
        let shape: { sourceIn: number; length: number; takes: number[]; take: number } | undefined;
        if (!punch && loop) {
          const length = loop.end - loop.start;
          const first = origin <= loop.start ? loop.start - origin : loop.end - origin;
          const offsets: number[] = [];
          for (let o = first; o + length <= frames; o += length) offsets.push(o);
          if (offsets.length) {
            shape = { sourceIn: offsets[offsets.length - 1], length, takes: offsets, take: offsets.length - 1 };
            at = loop.start;
          }
        }
        const cuts = (punch || shape) && target ? punchCommands(target, at, at + (shape ? shape.length : channels[0].length)) : [];
        commands.push(...cuts, { type: "import-media", media, at, trackId: target ?? undefined, clip: shape });
        return { name: file.name, shape };
      };
      const target = recordingTrack();
      const main = await place(take, target, 0);
      if (typeof main === "string") {
        setText(notice, main);
        return;
      }
      let placed = 0;
      for (let i = 0; i < others.length; i++) {
        const t = otherTakes[i];
        if (!t.frames) continue;
        const aligned = (t.startFrame ?? -1) >= 0 && (take.startFrame ?? -1) >= 0;
        if (typeof (await place(t, others[i].trackId, aligned ? (t.startFrame as number) - (take.startFrame as number) : 0)) !== "string") placed++;
      }
      engine.dispatch({ type: "batch", commands });
      const shifted = lag ? ` (shifted ${latencyMs()} ms earlier for latency)` : "";
      const more = placed ? ` and ${placed} more take${placed === 1 ? "" : "s"} on their tracks` : "";
      setText(
        notice,
        punch && target
          ? `Punched in ${main.name}${more}${shifted}`
          : main.shape
            ? `Recorded ${main.shape.takes.length} take${main.shape.takes.length === 1 ? "" : "s"} in ${main.name}${more}; the last one plays${shifted}`
            : `Recorded ${main.name}${more}${shifted}`,
      );
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
