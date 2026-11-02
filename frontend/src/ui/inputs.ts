import type { Engine } from "../engine";
/** A browser input, or (native) an interface the engine captures in full: a browser takes at most two channels of one. */
export type InputDevice = { id: string; label: string; name?: string; channels?: number; native?: boolean };

const chosen = new Map<string, string>();
let devices: InputDevice[] = [];
let signature = "";
const listeners = new Set<() => void>();

export function trackInput(trackId: string): string {
  return chosen.get(trackId) ?? "";
}

/** Where the choices live: the session (Track.input, set-track-input), so they save, undo and travel; these maps are
 *  the live view, rebuilt from the document and the devices present, a missing id found again by its label. */
let bound: Engine | null = null;

function rebuild(): void {
  if (!bound) return;
  chosen.clear();
  channelChoice.clear();
  for (const t of bound.get("document").tracks) {
    const want = t.input;
    if (!want) continue;
    const here = devices.find((d) => d.id === want.device) ?? (want.label ? devices.find((d) => d.label === want.label) : undefined);
    if (here) chosen.set(t.id, here.id);
    if (want.channels?.length) channelChoice.set(t.id, [...want.channels]);
  }
  for (const fn of listeners) fn();
}

export function bindInputs(engine: Engine): void {
  bound = engine;
  engine.subscribe("document", rebuild);
  rebuild();
}

function store(trackId: string, change: { device?: string; channels?: number[] | null }): void {
  if (!bound) return;
  const track = bound.get("document").tracks.find((t) => t.id === trackId);
  if (!track) return;
  const device = change.device !== undefined ? change.device : track.input?.device ?? "";
  const channels = change.channels !== undefined ? change.channels ?? undefined : track.input?.channels;
  const label = device ? devices.find((d) => d.id === device)?.label ?? track.input?.label : undefined;
  bound.dispatch({ type: "set-track-input", trackId, input: device || channels?.length ? { ...(device ? { device, label } : {}), ...(channels?.length ? { channels } : {}) } : null });
}

export function setTrackInput(trackId: string, deviceId: string): void {
  if (bound) return store(trackId, { device: deviceId });
  if (deviceId) chosen.set(trackId, deviceId);
  else chosen.delete(trackId);
}

/** The comparison's Multitrack recording row: the channels of its device a track records (zero-based), or null for
 * the device's first one or two as before. */
const channelChoice = new Map<string, number[]>();

export function trackChannels(trackId: string): number[] | null {
  return channelChoice.get(trackId) ?? null;
}

export function setTrackChannels(trackId: string, channels: number[] | null): void {
  if (bound) return store(trackId, { channels });
  if (channels && channels.length) channelChoice.set(trackId, channels);
  else channelChoice.delete(trackId);
}

const monitored = new Set<string>();
const monitorListeners = new Set<(trackId: string, on: boolean) => void>();

export function trackMonitor(trackId: string): boolean {
  return monitored.has(trackId);
}

export function setTrackMonitor(trackId: string, on: boolean): void {
  if (on) monitored.add(trackId);
  else monitored.delete(trackId);
  for (const fn of monitorListeners) fn(trackId, on);
}

export function onMonitorChanged(fn: (trackId: string, on: boolean) => void): () => void {
  monitorListeners.add(fn);
  return () => monitorListeners.delete(fn);
}

export function inputDevices(): InputDevice[] {
  return devices;
}

export function inputDeviceNames(): string[] {
  return devices.flatMap((d) => (d.name ? [d.name] : []));
}

export function inputSignature(): string {
  return signature;
}

export function onInputsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshInputs(askPermission = false): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return devices;
  if (askPermission) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      return devices;
    }
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  let n = 0;
  const next: InputDevice[] = all
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d) => ({ id: d.deviceId, label: d.label || `Input ${++n}`, name: d.label || undefined }));
  try {
    const listed = (await (await fetch("/api/audio/inputs")).json()) as { native: boolean; inputs: { name: string; channels: number }[] };
    for (const i of listed.native ? listed.inputs : []) {
      if (i.name.startsWith("Discard all samples")) continue; // ALSA's null device is no input
      next.push({ id: `native:${i.name}`, label: `${i.name} · ${i.channels} in, through the engine`, name: i.name, channels: i.channels, native: true });
    }
  } catch {
    /* an engine without native capture, or away: browser inputs only */
  }
  const sig = next.map((d) => `${d.id}|${d.label}`).join("\n");
  if (sig !== signature) {
    devices = next;
    signature = sig;
    if (bound) rebuild();
    else {
      for (const id of [...chosen.keys()]) if (!next.some((d) => d.id === chosen.get(id))) chosen.delete(id);
      for (const fn of listeners) fn();
    }
  }
  return devices;
}

if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => void refreshInputs());
}
