export interface MediaRef {
  id: string;
  name: string;
  sampleRate: number;
  channels: number;
  frames: number;
  format: string;
}

/** Fade shape names and the core's codes for them (native/formwav-dsp/src/render.rs `fade_curve`). */
export const FADE_SHAPES = { linear: 0, "equal-power": 1, "s-curve": 2, exponential: 3 } as const;
export type FadeShape = keyof typeof FADE_SHAPES;

export function nextFadeShape(shape: FadeShape | undefined): FadeShape {
  const order = Object.keys(FADE_SHAPES) as FadeShape[];
  return order[(order.indexOf(shape ?? "linear") + 1) % order.length];
}

/** The same curve the core applies, for drawing: 0 at the silent end, 1 at full level. */
export function fadeCurve(x: number, shape: FadeShape | undefined): number {
  const v = Math.min(1, Math.max(0, x));
  switch (shape) {
    case "equal-power":
      return Math.sin((v * Math.PI) / 2);
    case "s-curve":
      return 0.5 - 0.5 * Math.cos(v * Math.PI);
    case "exponential":
      return v * v;
    default:
      return v;
  }
}

export interface Clip {
  id: string;
  mediaId: string;
  start: number;
  length: number;
  sourceIn: number;
  gainDb: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeShape?: FadeShape;
  /** Alternate takes from loop recording: source offsets into the same media, all `length` long. */
  takes?: number[];
  /** Index into `takes` of the take that plays. */
  take?: number;
}

/** An automation point: time in session samples; value in dB (volume) or -1 to 1 (pan). */
export interface AutoPoint {
  time: number;
  value: number;
}

export interface Track {
  /** Volume (dB) and pan automation; when present each replaces the track's static fader or pan. */
  automation?: { volume?: AutoPoint[]; pan?: AutoPoint[] };
  id: string;
  name: string;
  channels: number;
  gainDb: number;
  mute: boolean;
  solo: boolean;
  pan?: number;
  busId?: string;
  clips: readonly Clip[];
}

export interface Marker {
  id: string;
  at: number;
  label: string;
}

export interface Region {
  id: string;
  start: number;
  end: number;
  label: string;
}

export interface LoopRange {
  start: number;
  end: number;
  enabled: boolean;
}

export interface SessionDoc {
  sampleRate: number;
  tracks: readonly Track[];
  media: Readonly<Record<string, MediaRef>>;
  markers: readonly Marker[];
  regions?: readonly Region[];
  loop?: LoopRange;
  buses?: readonly Bus[];
}

export interface Bus {
  id: string;
  name: string;
  gainDb: number;
  pan?: number;
  mute?: boolean;
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
  | { type: "import-media"; media: MediaRef; at: number; trackId?: string; clip?: { sourceIn: number; length: number; takes?: number[]; take?: number } }
  | { type: "set-clip-take"; trackId: string; clipId: string; take: number }
  | { type: "comp-range"; trackId: string; clipId: string; from: number; to: number; take: number }
  | { type: "set-automation"; trackId: string; param: "volume" | "pan"; points: AutoPoint[] }
  | { type: "remove-track"; trackId: string }
  | { type: "rename-track"; trackId: string; name: string }
  | { type: "set-track-gain"; trackId: string; gainDb: number }
  | { type: "set-track-pan"; trackId: string; pan: number }
  | { type: "add-clip"; trackId: string; mediaId: string; start: number; sourceIn: number; length: number }
  | { type: "paste-clip"; trackId: string; clip: Omit<Clip, "id"> }
  | { type: "remove-clip"; trackId: string; clipId: string }
  | { type: "set-clip-fades"; trackId: string; clipId: string; fadeIn: number; fadeOut: number; shape?: FadeShape }
  | { type: "crossfade"; trackId: string; leftClipId: string; rightClipId: string; shape?: FadeShape }
  | { type: "set-loop"; start: number; end: number; enabled: boolean }
  | { type: "add-region"; start: number; end: number; label: string }
  | { type: "remove-region"; regionId: string }
  | { type: "add-bus"; name: string }
  | { type: "remove-bus"; busId: string }
  | { type: "route-track"; trackId: string; busId: string | null }
  | { type: "set-bus-gain"; busId: string; gainDb: number }
  | { type: "set-bus-pan"; busId: string; pan: number }
  | { type: "split-clip"; trackId: string; clipId: string; at: number }
  | { type: "set-clip-bounds"; trackId: string; clipId: string; start: number; sourceIn: number; length: number }
  | { type: "set-clip-gain"; trackId: string; clipId: string; gainDb: number }
  | { type: "batch"; commands: Command[] }
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
    case "set-automation":
      return mapTrack(doc, cmd.trackId, (t) => {
        const [lo, hi] = cmd.param === "volume" ? [-60, 12] : [-1, 1];
        const byTime = new Map<number, number>();
        for (const p of cmd.points) {
          if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
          byTime.set(Math.max(0, Math.round(p.time)), Math.min(hi, Math.max(lo, Math.round(p.value * 100) / 100)));
        }
        const points = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
        const current = t.automation?.[cmd.param] ?? [];
        if (points.length === current.length && points.every((p, i) => p.time === current[i].time && p.value === current[i].value)) return t;
        const automation = { ...t.automation, [cmd.param]: points.length ? points : undefined };
        return { ...t, automation };
      });
    case "comp-range":
      return mapTrack(doc, cmd.trackId, (t) => {
        const index = t.clips.findIndex((c) => c.id === cmd.clipId);
        const c = t.clips[index];
        if (!c || !c.takes || c.takes.length < 2) return t;
        const takes = c.takes;
        const end = c.start + c.length;
        const from = Math.max(c.start, Math.round(Math.min(cmd.from, cmd.to)));
        const to = Math.min(end, Math.round(Math.max(cmd.from, cmd.to)));
        if (to <= from) return t;
        const take = ((Math.round(cmd.take) % takes.length) + takes.length) % takes.length;
        const current = c.take ?? takes.length - 1;
        if (take === current) return t;
        const piece = (start: number, length: number, k: number, id: string, fadeIn: number, fadeOut: number): Clip => {
          const shifted = takes.map((o) => o + (start - c.start));
          return { ...c, id, start, length, takes: shifted, take: k, sourceIn: shifted[k], fadeIn, fadeOut };
        };
        const pieces: Clip[] = [];
        if (from > c.start) pieces.push(piece(c.start, from - c.start, current, c.id, Math.min(c.fadeIn ?? 0, from - c.start), 0));
        pieces.push(
          piece(from, to - from, take, pieces.length ? newId() : c.id, from === c.start ? Math.min(c.fadeIn ?? 0, to - from) : 0, to === end ? Math.min(c.fadeOut ?? 0, to - from) : 0),
        );
        if (to < end) pieces.push(piece(to, end - to, current, newId(), 0, Math.min(c.fadeOut ?? 0, end - to)));
        return { ...t, clips: [...t.clips.slice(0, index), ...pieces, ...t.clips.slice(index + 1)] };
      });
    case "set-clip-take":
      return mapTrack(doc, cmd.trackId, (t) => {
        let changed = false;
        const clips = t.clips.map((c) => {
          if (c.id !== cmd.clipId || !c.takes || !c.takes.length) return c;
          const take = ((Math.round(cmd.take) % c.takes.length) + c.takes.length) % c.takes.length;
          if (take === (c.take ?? c.takes.length - 1) && c.sourceIn === c.takes[take]) return c;
          changed = true;
          return { ...c, take, sourceIn: c.takes[take] };
        });
        return changed ? { ...t, clips } : t;
      });
    case "import-media": {
      const sampleRate = doc.tracks.length === 0 ? cmd.media.sampleRate : doc.sampleRate;
      const shaped = cmd.clip;
      const clip: Clip = {
        id: newId(),
        mediaId: cmd.media.id,
        start: Math.max(0, Math.round(cmd.at)),
        length: shaped ? Math.max(1, Math.round(shaped.length)) : sessionLength(cmd.media, sampleRate),
        sourceIn: shaped ? Math.max(0, Math.round(shaped.sourceIn)) : 0,
        ...(shaped?.takes && shaped.takes.length > 1 ? { takes: shaped.takes.map((s) => Math.max(0, Math.round(s))), take: shaped.take ?? shaped.takes.length - 1 } : {}),
        gainDb: 0,
      };
      const media = { ...doc.media, [cmd.media.id]: cmd.media };
      const target = cmd.trackId ? doc.tracks.find((t) => t.id === cmd.trackId) : undefined;
      if (target) {
        return {
          ...doc,
          media,
          tracks: doc.tracks.map((t) => (t.id === target.id ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) } : t)),
        };
      }
      const track: Track = {
        id: newId(),
        name: cmd.media.name.replace(/\.[^.]+$/, "") || "Track",
        channels: cmd.media.channels,
        gainDb: 0,
        mute: false,
        solo: false,
        clips: [clip],
      };
      return { ...doc, sampleRate, media, tracks: [...doc.tracks, track] };
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
    case "add-bus": {
      const bus: Bus = { id: newId(), name: cmd.name.trim() || "Bus", gainDb: 0 };
      return { ...doc, buses: [...(doc.buses ?? []), bus] };
    }
    case "remove-bus": {
      const before = doc.buses ?? [];
      const buses = before.filter((b) => b.id !== cmd.busId);
      if (buses.length === before.length) return doc;
      const tracks = doc.tracks.map((t) => (t.busId === cmd.busId ? { ...t, busId: undefined } : t));
      return { ...doc, buses, tracks };
    }
    case "route-track": {
      const busId = cmd.busId ?? undefined;
      if (busId !== undefined && !(doc.buses ?? []).some((b) => b.id === busId)) return doc;
      return mapTrack(doc, cmd.trackId, (t) => (t.busId === busId ? t : { ...t, busId }));
    }
    case "set-bus-gain":
    case "set-bus-pan": {
      let changed = false;
      const buses = (doc.buses ?? []).map((b) => {
        if (b.id !== cmd.busId) return b;
        if (cmd.type === "set-bus-gain") {
          if (b.gainDb === cmd.gainDb) return b;
          changed = true;
          return { ...b, gainDb: cmd.gainDb };
        }
        const pan = Math.max(-1, Math.min(1, cmd.pan));
        if ((b.pan ?? 0) === pan) return b;
        changed = true;
        return { ...b, pan };
      });
      return changed ? { ...doc, buses } : doc;
    }
    case "set-loop": {
      const start = Math.max(0, Math.round(Math.min(cmd.start, cmd.end)));
      const end = Math.max(0, Math.round(Math.max(cmd.start, cmd.end)));
      if (end <= start) return doc;
      const current = doc.loop;
      if (current && current.start === start && current.end === end && current.enabled === cmd.enabled) return doc;
      return { ...doc, loop: { start, end, enabled: cmd.enabled } };
    }
    case "add-region": {
      const start = Math.max(0, Math.round(Math.min(cmd.start, cmd.end)));
      const end = Math.max(0, Math.round(Math.max(cmd.start, cmd.end)));
      if (end <= start) return doc;
      const region: Region = { id: newId(), start, end, label: cmd.label.trim() || "Region" };
      return { ...doc, regions: [...(doc.regions ?? []), region].sort((a, b) => a.start - b.start) };
    }
    case "remove-region": {
      const before = doc.regions ?? [];
      const regions = before.filter((r) => r.id !== cmd.regionId);
      return regions.length === before.length ? doc : { ...doc, regions };
    }
    case "batch":
      return cmd.commands.reduce((current, command) => applyCommand(current, command, newId), doc);
    case "set-clip-gain": {
      const gainDb = Math.max(-60, Math.min(12, Math.round(cmd.gainDb * 10) / 10));
      return mapTrack(doc, cmd.trackId, (t) => {
        let changed = false;
        const clips = t.clips.map((c) => {
          if (c.id !== cmd.clipId || c.gainDb === gainDb) return c;
          changed = true;
          return { ...c, gainDb };
        });
        return changed ? { ...t, clips } : t;
      });
    }
    case "split-clip":
      return mapTrack(doc, cmd.trackId, (t) => {
        const index = t.clips.findIndex((c) => c.id === cmd.clipId);
        if (index < 0) return t;
        const c = t.clips[index];
        const offset = Math.round(cmd.at) - c.start;
        if (offset <= 0 || offset >= c.length) return t;
        const media = doc.media[c.mediaId];
        const ratio = media ? media.sampleRate / doc.sampleRate : 1;
        const left: Clip = { ...c, length: offset, fadeIn: Math.min(c.fadeIn ?? 0, offset), fadeOut: 0 };
        const right: Clip = {
          ...c,
          id: newId(),
          start: c.start + offset,
          sourceIn: c.sourceIn + Math.round(offset * ratio),
          length: c.length - offset,
          fadeIn: 0,
          fadeOut: Math.min(c.fadeOut ?? 0, c.length - offset),
          ...(c.takes ? { takes: c.takes.map((t) => t + Math.round(offset * ratio)) } : {}),
        };
        return { ...t, clips: [...t.clips.slice(0, index), left, right, ...t.clips.slice(index + 1)] };
      });
    case "set-clip-bounds":
      return mapTrack(doc, cmd.trackId, (t) => {
        let changed = false;
        const clips = t.clips.map((c) => {
          if (c.id !== cmd.clipId) return c;
          const media = doc.media[c.mediaId];
          if (!media) return c;
          const start = Math.round(cmd.start);
          const sourceIn = Math.round(cmd.sourceIn);
          const length = Math.round(cmd.length);
          const available = sessionLength(media, doc.sampleRate) - Math.round((sourceIn * doc.sampleRate) / media.sampleRate);
          if (start < 0 || sourceIn < 0 || length < 1 || length > available) return c;
          if (start === c.start && sourceIn === c.sourceIn && length === c.length) return c;
          const takes = c.takes?.map((t) => t + (sourceIn - c.sourceIn));
          const mediaLength = sessionLength(media, doc.sampleRate);
          if (takes && takes.some((t) => t < 0 || t + length > mediaLength)) return c;
          changed = true;
          const fadeIn = Math.min(c.fadeIn ?? 0, length);
          return { ...c, start, sourceIn, length, fadeIn, fadeOut: Math.min(c.fadeOut ?? 0, length - fadeIn), ...(takes ? { takes } : {}) };
        });
        return changed ? { ...t, clips } : t;
      });
    case "paste-clip": {
      if (!doc.media[cmd.clip.mediaId]) return doc;
      const clip: Clip = { ...cmd.clip, id: newId(), start: Math.max(0, Math.round(cmd.clip.start)) };
      return mapTrack(doc, cmd.trackId, (t) => ({ ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) }));
    }
    case "add-clip": {
      if (!doc.media[cmd.mediaId]) return doc;
      const clip: Clip = {
        id: newId(),
        mediaId: cmd.mediaId,
        start: Math.max(0, Math.round(cmd.start)),
        length: Math.max(1, Math.round(cmd.length)),
        sourceIn: Math.max(0, Math.round(cmd.sourceIn)),
        gainDb: 0,
      };
      return mapTrack(doc, cmd.trackId, (t) => ({ ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) }));
    }
    case "remove-clip":
      return mapTrack(doc, cmd.trackId, (t) => {
        const clips = t.clips.filter((c) => c.id !== cmd.clipId);
        return clips.length === t.clips.length ? t : { ...t, clips };
      });
    case "set-clip-fades":
      return mapTrack(doc, cmd.trackId, (t) => {
        let changed = false;
        const clips = t.clips.map((c) => {
          if (c.id !== cmd.clipId) return c;
          const fadeIn = Math.max(0, Math.min(c.length, Math.round(cmd.fadeIn)));
          const fadeOut = Math.max(0, Math.min(c.length - fadeIn, Math.round(cmd.fadeOut)));
          const fadeShape = cmd.shape ?? c.fadeShape ?? "linear";
          if ((c.fadeIn ?? 0) === fadeIn && (c.fadeOut ?? 0) === fadeOut && (c.fadeShape ?? "linear") === fadeShape) return c;
          changed = true;
          return { ...c, fadeIn, fadeOut, fadeShape };
        });
        return changed ? { ...t, clips } : t;
      });
    case "crossfade":
      return mapTrack(doc, cmd.trackId, (t) => {
        const left = t.clips.find((c) => c.id === cmd.leftClipId);
        const right = t.clips.find((c) => c.id === cmd.rightClipId);
        if (!left || !right || right.start < left.start) return t;
        const span = Math.min(left.start + left.length - right.start, left.length, right.length);
        if (span <= 0) return t;
        const shape = cmd.shape ?? "equal-power";
        const clips = t.clips.map((c) =>
          c.id === left.id ? { ...c, fadeOut: span, fadeShape: shape } : c.id === right.id ? { ...c, fadeIn: span, fadeShape: shape } : c,
        );
        return { ...t, clips };
      });
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
