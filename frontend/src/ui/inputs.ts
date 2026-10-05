export type InputDevice = { id: string; label: string };

const chosen = new Map<string, string>();
let devices: InputDevice[] = [];
let signature = "";
const listeners = new Set<() => void>();

export function trackInput(trackId: string): string {
  return chosen.get(trackId) ?? "";
}

export function setTrackInput(trackId: string, deviceId: string): void {
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
  const next = all
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d) => ({ id: d.deviceId, label: d.label || `Input ${++n}` }));
  const sig = next.map((d) => `${d.id}|${d.label}`).join("\n");
  if (sig !== signature) {
    devices = next;
    signature = sig;
    for (const id of [...chosen.keys()]) if (!next.some((d) => d.id === chosen.get(id))) chosen.delete(id);
    for (const fn of listeners) fn();
  }
  return devices;
}

if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => void refreshInputs());
}
