export interface MediaRef {
  id: string;
  name: string;
  sampleRate: number;
  channels: number;
  frames: number;
  format: string;
}

export interface Clip {
  id: string;
  mediaId: string;
  start: number;
  length: number;
  sourceIn: number;
  gainDb: number;
}

export interface Track {
  id: string;
  name: string;
  channels: number;
  gainDb: number;
  mute: boolean;
  solo: boolean;
  pan?: number;
  clips: readonly Clip[];
}

export interface Marker {
  id: string;
  at: number;
  label: string;
}

export interface SessionDoc {
  sampleRate: number;
  tracks: readonly Track[];
  media: Readonly<Record<string, MediaRef>>;
  markers: readonly Marker[];
}

export interface FrequencyBand {
  lowHz: number;
  highHz: number;
}

export interface Selection {
  start: number;
  end: number;
  trackIds: readonly string[];
  band: FrequencyBand | null;
}

export type Command =
  | { type: "import-media"; media: MediaRef; at: number }
  | { type: "remove-track"; trackId: string }
  | { type: "rename-track"; trackId: string; name: string }
  | { type: "set-track-gain"; trackId: string; gainDb: number }
  | { type: "set-track-pan"; trackId: string; pan: number }
  | { type: "move-clip"; trackId: string; clipId: string; start: number }
  | { type: "add-marker"; at: number; label: string };

export function emptyDocument(sampleRate: number): SessionDoc {
  return { sampleRate, tracks: [], media: {}, markers: [] };
}

export function sessionLength(media: MediaRef, sessionRate: number): number {
  return Math.round((media.frames * sessionRate) / media.sampleRate);
}

export function documentLength(doc: SessionDoc): number {
  let longest = 0;
  for (const track of doc.tracks) for (const clip of track.clips) longest = Math.max(longest, clip.start + clip.length);
  return longest;
}

function mapTrack(doc: SessionDoc, trackId: string, fn: (t: Track) => Track): SessionDoc {
  let changed = false;
  const tracks = doc.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const next = fn(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...doc, tracks } : doc;
}

export function applyCommand(doc: SessionDoc, cmd: Command, newId: () => string): SessionDoc {
  switch (cmd.type) {
    case "import-media": {
      const sampleRate = doc.tracks.length === 0 ? cmd.media.sampleRate : doc.sampleRate;
      const clip: Clip = {
        id: newId(),
        mediaId: cmd.media.id,
        start: Math.max(0, Math.round(cmd.at)),
        length: sessionLength(cmd.media, sampleRate),
        sourceIn: 0,
        gainDb: 0,
      };
      const track: Track = {
        id: newId(),
        name: cmd.media.name.replace(/\.[^.]+$/, "") || "Track",
        channels: cmd.media.channels,
        gainDb: 0,
        mute: false,
        solo: false,
        clips: [clip],
      };
      return { ...doc, sampleRate, media: { ...doc.media, [cmd.media.id]: cmd.media }, tracks: [...doc.tracks, track] };
    }
    case "remove-track": {
      const tracks = doc.tracks.filter((t) => t.id !== cmd.trackId);
      return tracks.length === doc.tracks.length ? doc : { ...doc, tracks };
    }
    case "rename-track": {
      const name = cmd.name.trim();
      return name ? mapTrack(doc, cmd.trackId, (t) => (t.name === name ? t : { ...t, name })) : doc;
    }
    case "set-track-gain":
      return mapTrack(doc, cmd.trackId, (t) => (t.gainDb === cmd.gainDb ? t : { ...t, gainDb: cmd.gainDb }));
    case "set-track-pan": {
      const pan = Math.max(-1, Math.min(1, cmd.pan));
      return mapTrack(doc, cmd.trackId, (t) => ((t.pan ?? 0) === pan ? t : { ...t, pan }));
    }
    case "move-clip": {
      const start = Math.max(0, Math.round(cmd.start));
      return mapTrack(doc, cmd.trackId, (t) => {
        let moved = false;
        const clips = t.clips.map((c) => {
          if (c.id !== cmd.clipId || c.start === start) return c;
          moved = true;
          return { ...c, start };
        });
        return moved ? { ...t, clips } : t;
      });
    }
    case "add-marker": {
      const marker: Marker = { id: newId(), at: Math.max(0, Math.round(cmd.at)), label: cmd.label };
      return { ...doc, markers: [...doc.markers, marker].sort((a, b) => a.at - b.at) };
    }
  }
}
