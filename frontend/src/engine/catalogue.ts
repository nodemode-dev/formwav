import type { Command, SessionDoc } from "./document";
import { describeCommand } from "./describe";

/** S12: every document command's parameters as the reducer types them (engine/document.ts), so an agent can build one
 *  by hand: positions and lengths in samples at the session's rate, levels in dB, pans -1 to 1, ticks at 960 a quarter.
 *  Typed against the Command union, so a new command type does not build until it is listed here. */
export const COMMAND_PARAMS: Record<Command["type"], string> = {
  "import-media": `media: MediaRef; at: number; trackId?: string; clip?: { sourceIn: number; length: number; takes?: number[]; take?: number }; notes?: readonly NoteEvent[]; controllers?: readonly ControlEvent[]; midiChannel?: number; stem?: { of: string; part: string }; by?: "agent"`,
  "add-track": "name?: string; channels?: number",
  "set-synth": "patch: Partial<SynthPatch>",
  "set-clip-take": "trackId: string; clipId: string; take: number",
  "comp-range": "trackId: string; clipId: string; from: number; to: number; take: number",
  "set-automation": `trackId: string; param: "volume" | "pan" | "mute" | "trim"; points: AutoPoint[]`,
  "set-vca-automation": "vcaId: string; points: AutoPoint[]",
  "set-master-automation": "points: AutoPoint[]",
  "set-send-automation": "trackId: string; busId: string; points: AutoPoint[]",
  "coalesce-vca": "vcaId: string",
  "set-clip-group": "clipIds: string[]; groupId: string | null",
  "set-track-fx": "trackId: string; fx: TrackFx[]",
  "set-fx-automation": `trackId: string; fxIndex: number; param: "freq" | "gain" | "q"; points: AutoPoint[]`,
  "set-master-fx": "fx: TrackFx[]",
  "set-bus-fx": "busId: string; fx: TrackFx[]",
  "set-tempo": "bpm: number; beatsPerBar: number",
  "set-tempo-change": "tick: number; bpm: number | null",
  "set-meter-change": "bar: number; num: number; den: number; remove?: boolean",
  "set-key-change": "tick: number; key: string | null",
  "set-tempo-map": "changes: readonly TempoChange[]; label?: string",
  "set-time-track": "points: TimePoint[]; log?: boolean",
  "set-clip-envelope": "trackId: string; clipId: string; points: { at: number; db: number }[]",
  "set-clip-type": `trackId: string; clipId: string; soundType: "dialogue" | "music" | "effects" | "ambience" | null`,
  "new-playlist": "trackId: string; duplicate: boolean",
  "set-track-surround": "trackId: string; surround: { x: number; y: number; lfeDb?: number; el?: number; path?: { at: number; x: number; y: number; el?: number }[]; bed?: boolean } | null",
  "set-surround-fold": "on: boolean",
  "set-spatial-format": `format: "5.1" | "foa"`,
  "set-track-midi-fx": "trackId: string; midiFx: MidiFx[]",
  "set-timecode-start": "seconds: number",
  "set-picture": "picture: { id: string (the movie's SHA-256, from POST /api/pictures); name: string; size: number; start: number (samples); burnIn?: boolean } | null",
  "set-picture-start": "start: number (session samples where the picture's first frame sits)",
  "set-picture-burn-in": "on: boolean",
  "set-frame-rate": "rate: FrameRateId | null",
  "set-track-instrument": "trackId: string; instrument: { kind: 'sampler'; media: string; root: number } | { kind: 'plugin'; id: string; name: string } | { kind: 'subtractive' | 'drums'; values: Record<string, number> (engine/instruments.ts names) } | null",
  "switch-playlist": "trackId: string; name: string",
  "comp-from-playlist": "trackId: string; name: string; start: number; end: number",
  "set-key": "name: string; camelot: string",
  "clear-range": `trackId: string; start: number; end: number; ripple: boolean; follow?: "tracks"`,
  "resample-session": "sampleRate: number; swaps: { from: string; to: MediaRef }[]",
  "set-clip-media": "trackId: string; clipId: string; media: MediaRef",
  "set-clip-notes": "trackId: string; clipId: string; notes: readonly NoteEvent[]; media: MediaRef",
  "clear-ranges": `trackIds: string[]; ranges: { start: number; end: number }[]; ripple: boolean; smooth?: number; follow?: "tracks" | "session"`,
  "set-range-media": "trackId: string; clipId: string; start: number; end: number; media: MediaRef; feather?: number",
  "remove-marker": "markerId: string",
  "set-marker": "markerId: string; at?: number; label?: string; number?: number; comment?: string; color?: string",
  "set-region": "regionId: string; start?: number; end?: number; label?: string; number?: number; comment?: string; color?: string",
  "remove-track": "trackId: string",
  "rename-track": "trackId: string; name: string",
  "set-track-color": "trackId: string; color: string",
  "set-clip-color": "trackId: string; clipId: string; color: string",
  "set-clip-ara": "trackId: string; clipId: string; ara: ClipAra | null",
  "set-track-input": "trackId: string; input: TrackInput | null",
  "restore": "patch: RestorePatch",
  "save-pattern": "pattern: StepPattern",
  "set-launcher-slot": "trackId: string; scene: number; mediaId: string | null",
  "set-launcher": `scenes?: number; quantize?: LauncherState["quantize"]`,
  "delete-pattern": "id: string",
  "set-track-gain": "trackId: string; gainDb: number",
  "set-track-pan": "trackId: string; pan: number",
  "set-track-mute": "trackId: string; mute: boolean",
  "set-track-solo": "trackId: string; solo: boolean; exclusive?: boolean",
  "set-track-solo-safe": "trackId: string; soloSafe: boolean",
  "set-track-trim": "trackId: string; trimDb: number",
  "set-track-invert": "trackId: string; invert: boolean",
  "set-track-automation-off": "trackId: string; off: boolean",
  "clear-solos": "",
  "clear-mutes": "",
  "set-pan-law": `law: "0" | "-3" | "-4.5" | "-6"`,
  "set-media-folder": "mediaIds: string[]; folder: string | null",
  "bypass-fx-category": "trackIds: string[]; category: FxCategory; bypass: boolean",
  "set-bus-mute": "busId: string; mute: boolean",
  "set-master-gain": "gainDb: number",
  "add-clip": "trackId: string; mediaId: string; start: number; sourceIn: number; length: number",
  "paste-clip": `trackId: string; clip: Omit<Clip, "id">; media?: MediaRef`,
  "remove-clip": "trackId: string; clipId: string",
  "launch-clip": "trackId: string; mediaId: string; at: number; repeats: number",
  "stop-launched": "trackId: string; at: number",
  "set-clip-fades": "trackId: string; clipId: string; fadeIn: number; fadeOut: number; shape?: FadeShape; outShape?: FadeShape | null",
  "set-clips-mute": "clipIds: string[]; mute: boolean",
  "set-clips-gain-bypass": "clipIds: string[]; bypass: boolean",
  "set-clips-lock": `clipIds: string[]; lock: "time" | "edit" | null`,
  "rename-clip": "trackId: string; clipId: string; name: string",
  "duplicate-track": "trackId: string",
  "move-track": "trackId: string; to: number",
  "set-tracks-hidden": "trackIds: string[]; hidden: boolean",
  "set-track-height": `trackId: string; height: "small" | "medium" | "large" | "jumbo"`,
  "set-track-comments": "trackId: string; comments: string",
  "set-tracks-inactive": "trackIds: string[]; inactive: boolean",
  "commit-track": "trackId: string; media: MediaRef; length: number",
  "crossfade": "trackId: string; leftClipId: string; rightClipId: string; shape?: FadeShape",
  "set-loop": "start: number; end: number; enabled: boolean",
  "add-region": "start: number; end: number; label: string",
  "remove-region": "regionId: string",
  "add-bus": "name: string",
  "remove-bus": "busId: string",
  "route-track": "trackId: string; busId: string | null",
  "route-bus": "busId: string; to: string | null",
  "set-send-options": "trackId: string; busId: string; pre?: boolean; mute?: boolean; pan?: number | null",
  "set-group": "group: TrackGroup",
  "remove-group": "groupId: string",
  "add-vca": "name: string",
  "remove-vca": "vcaId: string",
  "assign-vca": "trackId: string; vcaId: string | null",
  "set-vca-gain": "vcaId: string; gainDb: number",
  "set-vca-mute": "vcaId: string; mute: boolean",
  "set-bus-gain": "busId: string; gainDb: number",
  "set-bus-pan": "busId: string; pan: number",
  "split-clip": "trackId: string; clipId: string; at: number",
  "insert-time": `trackIds: string[]; at: number; length: number; follow?: "tracks" | "session"`,
  "move-range": "trackIds: string[]; start: number; end: number; to: number",
  "set-clip-bounds": "trackId: string; clipId: string; start: number; sourceIn: number; length: number",
  "set-clip-gain": "trackId: string; clipId: string; gainDb: number",
  "batch": "commands: Command[]; label?: string; whole?: boolean",
  "move-clip": "trackId: string; clipId: string; start: number",
  "move-clip-to-track": "trackId: string; clipId: string; toTrackId: string; start: number",
  "set-clip-pitch": "trackId: string; clipId: string; semitones: number; media: MediaRef | null",
  "add-marker": "at: number; label: string; clipId?: string",
  "set-snap": "grid: boolean; bars: boolean; value?: string; nudge?: string",
  "set-track-view": "trackId: string; spectrogram: boolean",
  "set-track-send": "trackId: string; busId: string; gainDb: number | null",
  "set-clip-fx": "trackId: string; clipId: string; fx: TrackFx[]",
  "set-clip-warp": `trackId: string; clipId: string; warp: NonNullable<Clip["warp"]> | null; media?: MediaRef`,
};

export interface CommandEntry {
  type: Command["type"];
  label: string;
  params: string;
}

/** The catalogue: each command type, the History words it makes on a session, and its parameters. */
export function commandCatalogue(doc: SessionDoc): CommandEntry[] {
  return (Object.keys(COMMAND_PARAMS) as Command["type"][]).map((type) => ({ type, label: labelOf(type, doc), params: COMMAND_PARAMS[type] }));
}

function labelOf(type: Command["type"], doc: SessionDoc): string {
  try {
    return describeCommand({ type } as Command, doc);
  } catch {
    return type;
  }
}

export function isCommandType(type: unknown): type is Command["type"] {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(COMMAND_PARAMS, type);
}
