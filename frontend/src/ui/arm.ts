/**
 * Record arming. Armed tracks are interface state, like the selection: arming does not enter undo history or the
 * saved session. A click arms one track; Shift-click adds or removes tracks, each recording from its own input in
 * the same take. The first armed track is the primary (punch, loop takes and the transport's input meter follow it).
 */
const armed = new Set<string>();
const recording = new Set<string>();
const listeners = new Set<() => void>();

export function armedTrack(): string | null {
  return armed.values().next().value ?? null;
}

export function armedTracks(): string[] {
  return [...armed];
}

export function isArmed(id: string): boolean {
  return armed.has(id);
}

export function setArmedTrack(id: string | null): void {
  if (armed.size === (id ? 1 : 0) && (!id || armed.has(id))) return;
  armed.clear();
  if (id) armed.add(id);
  for (const listener of listeners) listener();
}

export function toggleArmed(id: string): void {
  if (armed.has(id)) armed.delete(id);
  else armed.add(id);
  for (const listener of listeners) listener();
}

export function onArm(listener: () => void): void {
  listeners.add(listener);
}

/** The primary track whose header meter shows the input while a recording is running, or null. */
export function recordingTrack(): string | null {
  return recording.values().next().value ?? null;
}

export function isRecording(id: string): boolean {
  return recording.has(id);
}

export function setRecordingTrack(id: string | null): void {
  recording.clear();
  if (id) recording.add(id);
}

export function addRecordingTrack(id: string): void {
  recording.add(id);
}
