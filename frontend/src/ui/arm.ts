/**
 * Record arming. The armed track is interface state, like the selection: arming does not enter undo
 * history or the saved session. One track at a time; recording goes into it at the playhead.
 */
let armed: string | null = null;
let recording: string | null = null;
const listeners = new Set<() => void>();

export function armedTrack(): string | null {
  return armed;
}

export function setArmedTrack(id: string | null): void {
  if (armed === id) return;
  armed = id;
  for (const listener of listeners) listener();
}

export function onArm(listener: () => void): void {
  listeners.add(listener);
}

/** The track whose header meter shows the input while a recording is running, or null. */
export function recordingTrack(): string | null {
  return recording;
}

export function setRecordingTrack(id: string | null): void {
  recording = id;
}
