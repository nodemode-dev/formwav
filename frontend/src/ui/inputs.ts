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
