import type { Command, SessionDoc } from "./document";

/** One edit in the session's history, as the History tab lists it. */
export interface HistoryEntry {
  id: number;
  label: string;
  by: "you" | "agent";
  at: number;
}

type Words = [withTrack: string, without: string];

/** Every command's words; `{t}` is the track's name. A Record, so a new command type cannot go without them. */
const WORDS: Record<Command["type"], Words> = {
  "import-media": ["Added {m}", "Added {m}"],
  "add-track": ["Added a track", "Added a track"],
  "set-synth": ["Changed the synth", "Changed the synth"],
  "set-clip-take": ["Picked a take on {t}", "Picked a take"],
  "comp-range": ["Comped takes on {t}", "Comped takes"],
  "set-automation": ["Drew automation on {t}", "Drew automation"],
  "set-vca-automation": ["Drew VCA automation", "Drew VCA automation"],
  "set-master-automation": ["Drew master automation", "Drew master automation"],
  "set-send-automation": ["Drew send automation on {t}", "Drew send automation"],
  "coalesce-vca": ["Coalesced a VCA into its tracks", "Coalesced a VCA into its tracks"],
  "route-bus": ["Routed a bus", "Routed a bus"],
  "set-send-options": ["Changed a send on {t}", "Changed a send"],
  "set-group": ["Grouped tracks", "Grouped tracks"],
  "remove-group": ["Ungrouped tracks", "Ungrouped tracks"],
  "set-clip-group": ["Grouped clips", "Grouped clips"],
  "set-track-fx": ["Changed the effects on {t}", "Changed the effects"],
  "set-fx-automation": ["Drew effect automation on {t}", "Drew effect automation"],
  "set-master-fx": ["Changed the master effects", "Changed the master effects"],
  "set-bus-fx": ["Changed a bus's effects", "Changed a bus's effects"],
  "set-tempo": ["Changed the tempo", "Changed the tempo"],
  "set-tempo-change": ["Changed the tempo map", "Changed the tempo map"],
  "set-meter-change": ["Changed the meter map", "Changed the meter map"],
  "set-key-change": ["Changed the key map", "Changed the key map"],
  "set-tempo-map": ["Changed the tempo map", "Changed the tempo map"],
  "set-time-track": ["Changed the time track", "Changed the time track"],
  "set-clip-envelope": ["Changed a clip's volume line on {t}", "Changed a clip's volume line"],
  "set-clip-type": ["Set a clip's sound type on {t}", "Set a clip's sound type"],
  "new-playlist": ["Started a playlist on {t}", "Started a playlist"],
  "set-track-surround": ["Placed {t} in surround", "Placed a track in surround"],
  "set-surround-fold": ["Changed the surround fold-down", "Changed the surround fold-down"],
  "set-spatial-format": ["Changed the spatial format", "Changed the spatial format"],
  "set-track-midi-fx": ["Changed the MIDI effects on {t}", "Changed the MIDI effects"],
  "set-timecode-start": ["Changed the start timecode", "Changed the start timecode"],
  "set-frame-rate": ["Changed the frame rate", "Changed the frame rate"],
  "set-track-instrument": ["Changed the instrument on {t}", "Changed the instrument"],
  "switch-playlist": ["Switched playlists on {t}", "Switched playlists"],
  "comp-from-playlist": ["Comped from a playlist on {t}", "Comped from a playlist"],
  "set-key": ["Changed the key", "Changed the key"],
  "clear-range": ["Cleared a range on {t}", "Cleared a range"],
  "resample-session": ["Changed the sample rate", "Changed the sample rate"],
  "set-clip-media": ["Replaced a clip's audio on {t}", "Replaced a clip's audio"],
  "set-clip-notes": ["Edited notes on {t}", "Edited notes"],
  "clear-ranges": ["Cleared ranges", "Cleared ranges"],
  "set-range-media": ["Processed a range on {t}", "Processed a range"],
  "remove-marker": ["Removed a marker", "Removed a marker"],
  "set-marker": ["Changed a marker", "Changed a marker"],
  "set-region": ["Changed a region", "Changed a region"],
  "remove-track": ["Removed {t}", "Removed a track"],
  "rename-track": ["Renamed {t}", "Renamed a track"],
  "set-track-color": ["Recoloured {t}", "Recoloured a track"],
  "set-clip-color": ["Recoloured a clip on {t}", "Recoloured a clip"],
  "set-clip-ara": ["Analysed a clip on {t}", "Analysed a clip"],
  "set-track-input": ["Changed the input of {t}", "Changed a track's input"],
  restore: ["Restored the original audio", "Restored the original audio"],
  "save-pattern": ["Saved a pattern", "Saved a pattern"],
  "set-launcher-slot": ["Filled a launcher slot on {t}", "Filled a launcher slot"],
  "set-launcher": ["Changed the launcher", "Changed the launcher"],
  "delete-pattern": ["Deleted a pattern", "Deleted a pattern"],
  "set-track-gain": ["Changed the volume of {t}", "Changed a track's volume"],
  "set-track-pan": ["Panned {t}", "Panned a track"],
  "set-track-mute": ["Muted {t}", "Muted a track"],
  "set-track-solo": ["Soloed {t}", "Soloed a track"],
  "set-track-solo-safe": ["Made {t} solo safe", "Made a track solo safe"],
  "set-track-trim": ["Trimmed the input of {t}", "Trimmed a track's input"],
  "set-track-invert": ["Inverted the polarity of {t}", "Inverted a track's polarity"],
  "set-track-automation-off": ["Turned off the automation of {t}", "Turned off a track's automation"],
  "clear-solos": ["Cleared every solo", "Cleared every solo"],
  "clear-mutes": ["Cleared every mute", "Cleared every mute"],
  "set-pan-law": ["Changed the pan law", "Changed the pan law"],
  "set-media-folder": ["Moved media to a folder", "Moved media to folders"],
  "bypass-fx-category": ["Bypassed inserts", "Bypassed inserts"],
  "set-bus-mute": ["Muted a bus", "Muted a bus"],
  "set-master-gain": ["Changed the master volume", "Changed the master volume"],
  "add-clip": ["Added a clip on {t}", "Added a clip"],
  "paste-clip": ["Pasted a clip on {t}", "Pasted a clip"],
  "remove-clip": ["Removed a clip from {t}", "Removed a clip"],
  "launch-clip": ["Launched a clip on {t}", "Launched a clip"],
  "stop-launched": ["Stopped the launcher on {t}", "Stopped the launcher"],
  "set-clip-fades": ["Changed fades on {t}", "Changed fades"],
  "set-clips-mute": ["Muted clips", "Muted clips"],
  "set-clips-gain-bypass": ["Bypassed clip gain", "Bypassed clip gain"],
  "set-clips-lock": ["Locked clips", "Locked clips"],
  "rename-clip": ["Renamed a clip on {t}", "Renamed a clip"],
  "duplicate-track": ["Duplicated {t}", "Duplicated a track"],
  "move-track": ["Moved {t}", "Moved a track"],
  "set-tracks-hidden": ["Hid tracks", "Hid tracks"],
  "set-track-height": ["Changed the height of {t}", "Changed a track's height"],
  "set-track-comments": ["Changed the comments of {t}", "Changed a track's comments"],
  "set-tracks-inactive": ["Made tracks inactive", "Made tracks inactive"],
  "commit-track": ["Committed {t}", "Committed a track"],
  crossfade: ["Crossfaded clips on {t}", "Crossfaded clips"],
  "set-loop": ["Changed the loop", "Changed the loop"],
  "add-region": ["Added a region", "Added a region"],
  "remove-region": ["Removed a region", "Removed a region"],
  "add-bus": ["Added a bus", "Added a bus"],
  "remove-bus": ["Removed a bus", "Removed a bus"],
  "route-track": ["Routed {t}", "Routed a track"],
  "add-vca": ["Added a VCA", "Added a VCA"],
  "remove-vca": ["Removed a VCA", "Removed a VCA"],
  "assign-vca": ["Assigned {t} to a VCA", "Assigned a VCA"],
  "set-vca-gain": ["Changed a VCA's level", "Changed a VCA's level"],
  "set-vca-mute": ["Muted a VCA", "Muted a VCA"],
  "set-bus-gain": ["Changed a bus's level", "Changed a bus's level"],
  "set-bus-pan": ["Panned a bus", "Panned a bus"],
  "split-clip": ["Split a clip on {t}", "Split a clip"],
  "insert-time": ["Inserted time", "Inserted time"],
  "move-range": ["Moved a range", "Moved a range"],
  "set-clip-bounds": ["Trimmed a clip on {t}", "Trimmed a clip"],
  "set-clip-gain": ["Changed a clip's gain on {t}", "Changed a clip's gain"],
  batch: ["Made changes", "Made changes"],
  "move-clip": ["Moved a clip on {t}", "Moved a clip"],
  "move-clip-to-track": ["Moved a clip off {t}", "Moved a clip to another track"],
  "set-clip-pitch": ["Changed a clip's pitch on {t}", "Changed a clip's pitch"],
  "add-marker": ["Added a marker", "Added a marker"],
  "set-snap": ["Changed snapping", "Changed snapping"],
  "set-track-view": ["Changed the view of {t}", "Changed a track's view"],
  "set-track-send": ["Changed a send on {t}", "Changed a send"],
  "set-clip-fx": ["Changed a clip's effects on {t}", "Changed a clip's effects"],
  "set-clip-warp": ["Warped a clip on {t}", "Warped a clip"],
};

/** A command in a few plain words for the History tab, with its track's name read from the session before it ran. */
export function describeCommand(command: Command, before: SessionDoc): string {
  if (command.type === "batch") return command.label ?? (command.commands.length ? describeCommand(command.commands[0], before) : WORDS.batch[1]);
  if (command.type === "set-tempo-map" && command.label) return command.label;
  const [withTrack, without] = WORDS[command.type];
  const trackId = "trackId" in command ? command.trackId : undefined;
  const track = trackId ? before.tracks.find((t) => t.id === trackId) : undefined;
  let words = track ? withTrack.replace("{t}", track.name) : without;
  if (command.type === "import-media") words = words.replace("{m}", command.media.name || "audio");
  if (command.type === "set-track-mute" && !command.mute) words = words.replace("Muted", "Unmuted");
  if (command.type === "set-track-solo" && !command.solo) words = words.replace("Soloed", "Unsoloed");
  if (command.type === "set-track-solo-safe" && !command.soloSafe) words = words.replace("Made", "Took").replace("solo safe", "out of solo safe");
  if (command.type === "set-track-invert" && !command.invert) words = words.replace("Inverted", "Restored");
  if (command.type === "set-track-automation-off" && !command.off) words = words.replace("Turned off", "Turned on");
  if (command.type === "bypass-fx-category" && !command.bypass) words = words.replace("Bypassed", "Switched on");
  if (command.type === "set-clips-mute" && !command.mute) words = "Unmuted clips";
  if (command.type === "set-clips-gain-bypass" && !command.bypass) words = "Restored clip gain";
  if (command.type === "set-clips-lock") words = command.lock === "time" ? "Time-locked clips" : command.lock ? "Edit-locked clips" : "Unlocked clips";
  if (command.type === "set-tracks-hidden" && !command.hidden) words = "Showed hidden tracks";
  if (command.type === "set-tracks-inactive" && !command.inactive) words = "Made tracks active";
  return words;
}
