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

/** Track and clip colours (AU-10): keys stored in the session, their shades the token sheet's --fw-color-<key>. */
export const PALETTE: readonly string[] = ["green", "blue", "amber", "red", "violet", "cyan", "pink", "slate"];

/** One note of a note clip, in frames of the clip's media (the instrument's rendering starts at media frame 0). */
export interface NoteEvent {
  at: number;
  length: number;
  /** MIDI note number, 69 being A4 */
  pitch: number;
  /** 1 to 127 */
  velocity: number;
}

export interface Clip {
  id: string;
  mediaId: string;
  /** PT-09, warp markers: the original the clip is rendered from (its media and the span it covered, in samples) and
   *  each marker as a source position in that span (src) and where it now sits in the clip (dst). */
  warp?: { source: string; sourceIn: number; sourceLength: number; markers: { src: number; dst: number }[] };
  /** PT-33: the clip's own realtime effects (Pro Tools' clip effects), its EQ and a compressor, ahead of its track's
   *  inserts; the compressor sees the clip after its clip gain, not its track's fader. */
  fx?: TrackFx[];
  /** A note clip's notes, the truth its media renders (the built-in instrument); absent on audio clips. */
  notes?: readonly NoteEvent[];
  /** A palette key for this clip alone, over its track's colour; absent follows the track. */
  color?: string;
  /** The media this clip held before any effect replaced it (RX-61's Restore original); absent until one does. */
  original?: string;
  start: number;
  length: number;
  sourceIn: number;
  gainDb: number;
  /** Audacity's clip volume envelope: dB points at the media's frames (so they stay with the audio through trims and splits), linear in gain between points and held outside them, multiplying the clip's gain. */
  envelope?: readonly { at: number; db: number }[];
  fadeIn?: number;
  fadeOut?: number;
  fadeShape?: FadeShape;
  /** Alternate takes from loop recording: source offsets into the same media, all `length` long. */
  takes?: number[];
  /** Index into `takes` of the take that plays. */
  take?: number;
  /** Clips sharing a group id select, move and delete together (Audacity's clip groups). */
  groupId?: string;
  /** Non-destructive pitch shift in semitones (Audacity's clip pitch): `mediaId` stays the original, and playback and
   * export play `pitchMediaId`, a same-length render of the original at this pitch. */
  pitch?: number;
  pitchMediaId?: string;
}

/** An automation point: time in session samples; value in dB (volume) or -1 to 1 (pan). */
export interface AutoPoint {
  time: number;
  value: number;
}

/** A realtime filter the audio core runs live in playback and export alike. */
export interface FilterFx {
  kind: "highpass" | "lowpass" | "peak" | "lowshelf" | "highshelf";
  freq: number;
  gainDb: number;
  q: number;
  bypass?: boolean;
  /** Its parameters' automation (PT-19), session frames to Hz, dB or Q; each replaces the static value it automates. */
  automation?: { freq?: AutoPoint[]; gain?: AutoPoint[]; q?: AutoPoint[] };
}

/** A realtime compressor (nonlinear, so the core runs it on the track's sum or the master's). */
export interface CompressorFx {
  kind: "compressor";
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
  bypass?: boolean;
}

export type TrackFx = FilterFx | CompressorFx;

const FX_KINDS: ReadonlySet<string> = new Set(["highpass", "lowpass", "peak", "lowshelf", "highshelf", "compressor"]);

/** Known kinds only, values clamped to the core's ranges, bypass kept only when set; for track and master alike. */
export function cleanFx(fx: readonly TrackFx[]): TrackFx[] {
  const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return fx
    .filter((f) => FX_KINDS.has(f.kind))
    .map((f): TrackFx => {
      const bypass = f.bypass ? { bypass: true } : {};
      if (f.kind === "compressor") {
        return { kind: "compressor", thresholdDb: clamp(f.thresholdDb, -60, 0, -20), ratio: clamp(f.ratio, 1, 20, 4), attackMs: clamp(f.attackMs, 0.1, 200, 10), releaseMs: clamp(f.releaseMs, 1, 2000, 150), makeupDb: clamp(f.makeupDb, 0, 24, 0), ...bypass };
      }
      // automation survives cleaning (it was rebuilt from known fields only): sorted, each value clamped like its static one
      const ranges = { freq: [20, 20000], gain: [-24, 24], q: [0.1, 18] } as const;
      const auto: { freq?: AutoPoint[]; gain?: AutoPoint[]; q?: AutoPoint[] } = {};
      for (const key of ["freq", "gain", "q"] as const) {
        const pts = f.automation?.[key];
        if (pts && pts.length) auto[key] = [...pts].sort((a, b) => a.time - b.time).map((p) => ({ time: Math.max(0, Math.round(p.time)), value: clamp(p.value, ranges[key][0], ranges[key][1], ranges[key][0]) }));
      }
      const automation = Object.keys(auto).length ? { automation: auto } : {};
      return { kind: f.kind, freq: clamp(f.freq, 20, 20000, 1000), gainDb: clamp(f.gainDb, -24, 24, 0), q: clamp(f.q, 0.1, 18, 0.707), ...bypass, ...automation };
    });
}

export interface Track {
  /** A palette key (green, blue, amber, red, violet, cyan, pink, slate) for its header bar and clips; absent is green. */
  color?: string;
  /** Realtime effects in order (Audacity's realtime stack); bypassed ones are skipped. */
  fx?: TrackFx[];
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
  /** The VCA whose gain and mute also apply to this track (its own fader stays where it is). */
  vcaId?: string;
  /** AU-30's per-track view: this track shown as a spectrogram whatever the session-wide view is. */
  view?: "spectrogram";
  /** PT-18: post-fader sends, this track's signal (after its inserts and fader) also fed to a bus at a level. */
  sends?: { busId: string; gainDb: number }[];
  clips: readonly Clip[];
}

export interface TimePoint {
  at: number;
  speed: number;
}

export interface Marker {
  id: string;
  at: number;
  label: string;
  /** A clip marker (AA-13): it moves with this clip, and is left in place, unattached, if the clip goes. */
  clipId?: string;
}

/** AA-13: after any change, a marker attached to a clip moves by however far its clip did (a move, a move to another
 * track, a group move alike); one whose clip is gone (split, deleted) stays where it was, unattached. The same document
 * comes back when nothing moved. */
export function followClips<T extends SessionDoc | null | undefined>(before: SessionDoc, after: T): T {
  // a command may return nothing (no change); dispatch checks for that after this, so it passes straight through
  if (!after || after === before || !after.markers.some((m) => m.clipId)) return after;
  const starts = (doc: SessionDoc) => new Map(doc.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.start] as const)));
  const was = starts(before);
  const now = starts(after);
  let changed = false;
  const markers = after.markers.map((m) => {
    if (!m.clipId) return m;
    const a = was.get(m.clipId);
    const b = now.get(m.clipId);
    if (b === undefined) {
      changed = true;
      const { clipId: _gone, ...free } = m;
      return free;
    }
    if (a === undefined || a === b) return m;
    changed = true;
    return { ...m, at: Math.max(0, m.at + (b - a)) };
  });
  return (changed ? { ...after, markers: [...markers].sort((x, y) => x.at - y.at) } : after) as T;
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
  /** Master fader in dB, applied after the buses; absent means 0 dB. */
  masterGainDb?: number;
  /** Realtime effects on the summed mix, before the master fader (Audacity's master stack). */
  masterFx?: TrackFx[];
  /** The session tempo, for the bars ruler, beat snapping and Quantize (set by hand or detected). */
  tempo?: { bpm: number; beatsPerBar: number };
  /** AU-07: this project's snap settings, saved with it: snapping to the grid, and the grid in bars and beats. */
  snap?: { grid: boolean; bars: boolean };
  /** The session's musical key and Camelot code, as detected (services/key.py). */
  key?: { name: string; camelot: string };
  /** Audacity's time track: playback speed over session time, linear between points, held outside them (sample position, factor 0.25 to 4). */
  timeTrack?: readonly TimePoint[];
  /** AU-36: speed interpolated logarithmically between the time track's points (a steady ratio), not linearly. */
  timeTrackLog?: boolean;
  tracks: readonly Track[];
  media: Readonly<Record<string, MediaRef>>;
  markers: readonly Marker[];
  regions?: readonly Region[];
  loop?: LoopRange;
  buses?: readonly Bus[];
  /** VCA masters (Pro Tools' VCA mixing): group faders that scale their member tracks without carrying audio. */
  vcas?: readonly Vca[];
}

/** A VCA (Pro Tools' VCA masters): a fader and mute for a group of tracks with no audio passing through it; a member
 * plays at its own fader plus the VCA's gain, and its own fader does not move. */
export interface Vca {
  id: string;
  name: string;
  gainDb: number;
  mute?: boolean;
}

export interface Bus {
  id: string;
  name: string;
  gainDb: number;
  pan?: number;
  mute?: boolean;
  /** Effects on the bus's sum (Pro Tools' routing folders process the grouped stem), filters and compressors in order. */
  fx?: TrackFx[];
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
  | { type: "import-media"; media: MediaRef; at: number; trackId?: string; clip?: { sourceIn: number; length: number; takes?: number[]; take?: number }; notes?: readonly NoteEvent[] }
  | { type: "set-clip-take"; trackId: string; clipId: string; take: number }
  | { type: "comp-range"; trackId: string; clipId: string; from: number; to: number; take: number }
  | { type: "set-automation"; trackId: string; param: "volume" | "pan"; points: AutoPoint[] }
  | { type: "set-clip-group"; clipIds: string[]; groupId: string | null }
  | { type: "set-track-fx"; trackId: string; fx: TrackFx[] }
  /** One filter's parameter automation (PT-19); empty points remove it. */
  | { type: "set-fx-automation"; trackId: string; fxIndex: number; param: "freq" | "gain" | "q"; points: AutoPoint[] }
  | { type: "set-master-fx"; fx: TrackFx[] }
  | { type: "set-bus-fx"; busId: string; fx: TrackFx[] }
  | { type: "set-tempo"; bpm: number; beatsPerBar: number }
  | { type: "set-time-track"; points: TimePoint[]; log?: boolean }
  | { type: "set-clip-envelope"; trackId: string; clipId: string; points: { at: number; db: number }[] }
  | { type: "set-key"; name: string; camelot: string }
  | { type: "clear-range"; trackId: string; start: number; end: number; ripple: boolean }
  | { type: "resample-session"; sampleRate: number; swaps: { from: string; to: MediaRef }[] }
  | { type: "set-clip-media"; trackId: string; clipId: string; media: MediaRef }
  /** A note clip's edited notes and the instrument's new rendering of them, replaced together (one undo step). */
  | { type: "set-clip-notes"; trackId: string; clipId: string; notes: readonly NoteEvent[]; media: MediaRef }
  | { type: "clear-ranges"; trackIds: string[]; ranges: { start: number; end: number }[]; ripple: boolean; smooth?: number }
  | { type: "set-range-media"; trackId: string; clipId: string; start: number; end: number; media: MediaRef; feather?: number }
  | { type: "remove-marker"; markerId: string }
  | { type: "set-marker"; markerId: string; at?: number; label?: string }
  | { type: "set-region"; regionId: string; start?: number; end?: number; label?: string }
  | { type: "remove-track"; trackId: string }
  | { type: "rename-track"; trackId: string; name: string }
  /** A palette key, or "" for the default (green for a track; the track's colour for a clip). */
  | { type: "set-track-color"; trackId: string; color: string }
  | { type: "set-clip-color"; trackId: string; clipId: string; color: string }
  | { type: "set-track-gain"; trackId: string; gainDb: number }
  | { type: "set-track-pan"; trackId: string; pan: number }
  | { type: "set-track-mute"; trackId: string; mute: boolean }
  | { type: "set-track-solo"; trackId: string; solo: boolean }
  | { type: "set-bus-mute"; busId: string; mute: boolean }
  | { type: "set-master-gain"; gainDb: number }
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
  | { type: "add-vca"; name: string }
  | { type: "remove-vca"; vcaId: string }
  | { type: "assign-vca"; trackId: string; vcaId: string | null }
  | { type: "set-vca-gain"; vcaId: string; gainDb: number }
  | { type: "set-vca-mute"; vcaId: string; mute: boolean }
  | { type: "set-bus-gain"; busId: string; gainDb: number }
  | { type: "set-bus-pan"; busId: string; pan: number }
  | { type: "split-clip"; trackId: string; clipId: string; at: number }
  | { type: "set-clip-bounds"; trackId: string; clipId: string; start: number; sourceIn: number; length: number }
  | { type: "set-clip-gain"; trackId: string; clipId: string; gainDb: number }
  | { type: "batch"; commands: Command[] }
  | { type: "move-clip"; trackId: string; clipId: string; start: number }
  | { type: "move-clip-to-track"; trackId: string; clipId: string; toTrackId: string; start: number }
  | { type: "set-clip-pitch"; trackId: string; clipId: string; semitones: number; media: MediaRef | null }
  | { type: "add-marker"; at: number; label: string; clipId?: string }
  | { type: "set-snap"; grid: boolean; bars: boolean }
  | { type: "set-track-view"; trackId: string; spectrogram: boolean }
  | { type: "set-track-send"; trackId: string; busId: string; gainDb: number | null }
  | { type: "set-clip-fx"; trackId: string; clipId: string; fx: TrackFx[] }
  | { type: "set-clip-warp"; trackId: string; clipId: string; warp: NonNullable<Clip["warp"]> | null; media?: MediaRef };

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
    case "clear-ranges": {
      const ranges = cmd.ranges
        .map((r) => ({ start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) }))
        .filter((r) => r.end > r.start)
        .sort((a, b) => b.start - a.start);
      let next = doc;
      for (const r of ranges)
        for (const trackId of cmd.trackIds) next = applyCommand(next, { type: "clear-range", trackId, start: r.start, end: r.end, ripple: cmd.ripple }, newId);
      const smooth = Math.round(cmd.smooth ?? 0);
      if (smooth <= 0 || next === doc) return next;
      // DS-04, harsh-cut avoidance: where audio now meets a cut (or, without ripple, the edges of a cleared gap), the clip
      // ending there fades out and the clip starting there fades in over `smooth` samples, at most half the clip
      const ends: number[] = [];
      const starts: number[] = [];
      let removed = 0;
      for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
        if (cmd.ripple) {
          ends.push(r.start - removed);
          starts.push(r.start - removed);
          removed += r.end - r.start;
        } else {
          ends.push(r.start);
          starts.push(r.end);
        }
      }
      const at = (list: number[], x: number) => list.some((p) => Math.abs(p - x) <= 1);
      const ease = (c: Clip, f: number | undefined) => Math.max(f ?? 0, Math.min(smooth, Math.floor(c.length / 2)));
      return {
        ...next,
        tracks: next.tracks.map((t) =>
          !cmd.trackIds.includes(t.id)
            ? t
            : {
                ...t,
                clips: t.clips.map((c) => {
                  const fadeOut = at(ends, c.start + c.length) ? ease(c, c.fadeOut) : c.fadeOut;
                  const fadeIn = at(starts, c.start) ? ease(c, c.fadeIn) : c.fadeIn;
                  return fadeOut === c.fadeOut && fadeIn === c.fadeIn ? c : { ...c, fadeIn, fadeOut };
                }),
              },
        ),
      };
    }
    case "set-range-media": {
      let changed = false;
      const next = mapTrack(doc, cmd.trackId, (t) => ({
        ...t,
        clips: t.clips.flatMap((c) => {
          if (c.id !== cmd.clipId) return [c];
          const end = c.start + c.length;
          const from = Math.max(c.start, Math.round(Math.min(cmd.start, cmd.end)));
          const to = Math.min(end, Math.round(Math.max(cmd.start, cmd.end)));
          if (to <= from) return [c];
          changed = true;
          const source = doc.media[c.mediaId];
          const ratio = source ? source.sampleRate / doc.sampleRate : 1;
          const piece = (a: number, b: number, id: string, mediaId: string): Clip => {
            const offset = Math.round((a - c.start) * ratio);
            return {
              ...c,
              id,
              mediaId,
              original: c.original ?? c.mediaId,
              start: a,
              length: b - a,
              sourceIn: c.sourceIn + offset,
              fadeIn: a === c.start ? Math.min(c.fadeIn ?? 0, b - a) : 0,
              fadeOut: b === end ? Math.min(c.fadeOut ?? 0, b - a) : 0,
              ...(c.takes ? { takes: c.takes.map((o) => o + offset) } : {}),
            };
          };
          const out: Clip[] = [];
          const hasLeft = from > c.start;
          const hasRight = to < end;
          const f = Math.max(0, Math.min(Math.round(cmd.feather ?? 0), Math.floor((to - from) / 2), hasLeft ? from - c.start : Infinity, hasRight ? end - to : Infinity));
          const fl = hasLeft ? f : 0;
          const fr = hasRight ? f : 0;
          if (hasLeft) out.push({ ...piece(c.start, from, c.id, c.mediaId), ...(fl ? { fadeOut: fl } : {}) });
          out.push({ ...piece(from - fl, to + fr, hasLeft ? newId() : c.id, cmd.media.id), ...(fl ? { fadeIn: fl } : {}), ...(fr ? { fadeOut: fr } : {}) });
          if (hasRight) out.push({ ...piece(to, end, newId(), c.mediaId), ...(fr ? { fadeIn: fr } : {}) });
          return out;
        }),
      }));
      return changed ? { ...next, media: { ...doc.media, [cmd.media.id]: cmd.media } } : doc;
    }
    case "set-clip-notes": {
      // the notes are the truth and the media their rendering: both change at once, and the clip (untrimmed, as the
      // instrument renders from the first note's time) covers the whole new rendering, release included
      const notes = cmd.notes.map((n) => ({ at: Math.max(0, Math.round(n.at)), length: Math.max(1, Math.round(n.length)), pitch: Math.min(127, Math.max(0, Math.round(n.pitch))), velocity: Math.min(127, Math.max(1, Math.round(n.velocity))) }));
      const previous = doc.tracks.find((t) => t.id === cmd.trackId)?.clips.find((c) => c.id === cmd.clipId)?.mediaId;
      const next = mapTrack(doc, cmd.trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === cmd.clipId ? { ...c, notes, mediaId: cmd.media.id, sourceIn: 0, length: sessionLength(cmd.media, doc.sampleRate) } : c)),
      }));
      if (next === doc) return doc;
      const media: Record<string, MediaRef> = { ...next.media, [cmd.media.id]: cmd.media };
      // the rendering it replaces leaves the media list once no clip plays it (undo restores the whole earlier session)
      if (previous && previous !== cmd.media.id && !next.tracks.some((t) => t.clips.some((c) => c.mediaId === previous || c.pitchMediaId === previous))) delete media[previous];
      return { ...next, media };
    }
    case "set-clip-media": {
      let changed = false;
      const old = (c: Clip) => doc.media[c.mediaId];
      const next = mapTrack(doc, cmd.trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== cmd.clipId || c.mediaId === cmd.media.id) return c;
          changed = true;
          // A timing-changing effect (tempo, stretch) returns media of another length: the clip then covers the same
          // material re-timed, so its trim, length and fades scale by the same ratio (they had been left as they
          // were, cutting a slowed clip short and leaving a sped-up one running past its audio).
          const before = old(c);
          // A pitch render was made from the old media, so new media leaves the clip unpitched (set the pitch again).
          const { pitch: _p, pitchMediaId: _pm, ...base } = c;
          const r = before && before.frames > 0 && cmd.media.frames > 0 ? cmd.media.frames / before.frames : 1;
          if (Math.abs(r - 1) < 1e-9) return { ...base, original: c.original ?? c.mediaId, mediaId: cmd.media.id };
          delete (base as { original?: string }).original; // re-timed media no longer lines up with the original
          const scale = (n: number | undefined) => (n === undefined ? undefined : Math.max(0, Math.round(n * r)));
          return { ...base, mediaId: cmd.media.id, sourceIn: scale(c.sourceIn) ?? 0, length: Math.max(1, scale(c.length) ?? c.length), fadeIn: scale(c.fadeIn), fadeOut: scale(c.fadeOut), ...(c.envelope ? { envelope: c.envelope.map((p) => ({ at: scale(p.at) ?? 0, db: p.db })) } : {}) };
        }),
      }));
      return changed ? { ...next, media: { ...doc.media, [cmd.media.id]: cmd.media } } : doc;
    }
    case "resample-session": {
      const r = cmd.sampleRate / doc.sampleRate;
      const swaps = new Map(cmd.swaps.map((s) => [s.from, s.to]));
      if (r === 1 && swaps.size === 0) return doc;
      const at = (n: number) => Math.round(n * r);
      const media: Record<string, MediaRef> = { ...doc.media };
      for (const s of cmd.swaps) {
        delete media[s.from];
        media[s.to.id] = s.to;
      }
      const tracks = doc.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          const to = swaps.get(c.mediaId);
          const from = doc.media[c.mediaId];
          const k = to && from ? to.sampleRate / from.sampleRate : 1;
          const source = (n: number) => Math.round(n * k);
          return {
            ...c,
            mediaId: to ? to.id : c.mediaId,
            start: at(c.start),
            length: Math.max(1, at(c.length)),
            sourceIn: source(c.sourceIn),
            ...(c.fadeIn !== undefined ? { fadeIn: at(c.fadeIn) } : {}),
            ...(c.fadeOut !== undefined ? { fadeOut: at(c.fadeOut) } : {}),
            ...(c.takes ? { takes: c.takes.map(source) } : {}),
          };
        }),
        ...(t.automation
          ? {
              automation: {
                volume: t.automation.volume?.map((p) => ({ ...p, time: at(p.time) })),
                pan: t.automation.pan?.map((p) => ({ ...p, time: at(p.time) })),
              },
            }
          : {}),
      }));
      return {
        ...doc,
        sampleRate: cmd.sampleRate,
        media,
        tracks,
        markers: doc.markers.map((m) => ({ ...m, at: at(m.at) })),
        ...(doc.regions ? { regions: doc.regions.map((g) => ({ ...g, start: at(g.start), end: at(g.end) })) } : {}),
        ...(doc.loop ? { loop: { ...doc.loop, start: at(doc.loop.start), end: at(doc.loop.end) } } : {}),
      };
    }
    case "set-clip-pitch": {
      const st = Math.max(-12, Math.min(12, Math.round(cmd.semitones)));
      let changed = false;
      const next = mapTrack(doc, cmd.trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== cmd.clipId) return c;
          const { pitch: _p, pitchMediaId: _m, ...rest } = c;
          const target: Clip = st === 0 || !cmd.media ? rest : { ...rest, pitch: st, pitchMediaId: cmd.media.id };
          if ((c.pitch ?? 0) === (target.pitch ?? 0) && c.pitchMediaId === target.pitchMediaId) return c;
          changed = true;
          return target;
        }),
      }));
      if (!changed) return doc;
      return st !== 0 && cmd.media ? { ...next, media: { ...doc.media, [cmd.media.id]: cmd.media } } : next;
    }
    case "move-clip-to-track": {
      if (cmd.toTrackId === cmd.trackId) return applyCommand(doc, { type: "move-clip", trackId: cmd.trackId, clipId: cmd.clipId, start: cmd.start }, newId);
      const clip = doc.tracks.find((t) => t.id === cmd.trackId)?.clips.find((c) => c.id === cmd.clipId);
      if (!clip || !doc.tracks.some((t) => t.id === cmd.toTrackId)) return doc;
      const start = Math.max(0, Math.round(cmd.start));
      // Audacity's free placement: the clip leaves its track for another, mono or stereo, where overlap replaces what
      // lay under it (the same trim clear-range makes, later clips unmoved).
      const without = mapTrack(doc, cmd.trackId, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== cmd.clipId) }));
      const cleared = applyCommand(without, { type: "clear-range", trackId: cmd.toTrackId, start, end: start + clip.length, ripple: false }, newId);
      return mapTrack(cleared, cmd.toTrackId, (t) => ({ ...t, clips: [...t.clips, { ...clip, start }].sort((a, b) => a.start - b.start) }));
    }
    case "clear-range": {
      const from = Math.max(0, Math.round(Math.min(cmd.start, cmd.end)));
      const to = Math.round(Math.max(cmd.start, cmd.end));
      const span = to - from;
      if (span <= 0) return doc;
      return mapTrack(doc, cmd.trackId, (t) => {
        let changed = false;
        const clips: Clip[] = [];
        for (const c of t.clips) {
          const end = c.start + c.length;
          if (end <= from) {
            clips.push(c);
            continue;
          }
          if (c.start >= to) {
            clips.push(cmd.ripple ? { ...c, start: c.start - span } : c);
            changed ||= cmd.ripple;
            continue;
          }
          changed = true;
          if (c.start < from) clips.push({ ...c, length: from - c.start, fadeIn: Math.min(c.fadeIn ?? 0, from - c.start), fadeOut: 0 });
          if (end > to) {
            const media = doc.media[c.mediaId];
            const ratio = media ? media.sampleRate / doc.sampleRate : 1;
            const offset = Math.round((to - c.start) * ratio);
            clips.push({
              ...c,
              id: c.start < from ? newId() : c.id,
              start: cmd.ripple ? from : to,
              sourceIn: c.sourceIn + offset,
              length: end - to,
              fadeIn: 0,
              fadeOut: Math.min(c.fadeOut ?? 0, end - to),
              ...(c.takes ? { takes: c.takes.map((o) => o + offset) } : {}),
            });
          }
        }
        return changed ? { ...t, clips } : t;
      });
    }
    case "set-fx-automation":
      return mapTrack(doc, cmd.trackId, (t) => {
        const target = t.fx?.[cmd.fxIndex];
        if (!t.fx || !target || target.kind === "compressor") return t;
        const { [cmd.param]: _old, ...others } = target.automation ?? {};
        const automation = cmd.points.length ? { ...others, [cmd.param]: cmd.points } : others;
        const next = cleanFx(t.fx.map((f, i) => (i === cmd.fxIndex ? { ...target, automation } : f)));
        return JSON.stringify(next) === JSON.stringify(t.fx) ? t : { ...t, fx: next };
      });
    case "set-track-fx":
      return mapTrack(doc, cmd.trackId, (t) => {
        const fx = cleanFx(cmd.fx);
        if (JSON.stringify(fx) === JSON.stringify(t.fx ?? [])) return t;
        const { fx: _old, ...rest } = t;
        return fx.length ? { ...rest, fx } : rest;
      });
    case "set-key": {
      const name = cmd.name.trim().slice(0, 20);
      const camelotCode = cmd.camelot.trim().slice(0, 4);
      if (!name || (doc.key && doc.key.name === name && doc.key.camelot === camelotCode)) return doc;
      return { ...doc, key: { name, camelot: camelotCode } };
    }
    case "set-clip-envelope": {
      const byAt = new Map<number, number>();
      for (const p of cmd.points) if (Number.isFinite(p.at) && p.at >= 0 && Number.isFinite(p.db)) byAt.set(Math.round(p.at), Math.round(Math.min(12, Math.max(-60, p.db)) * 10) / 10);
      const points = [...byAt].sort((a, b) => a[0] - b[0]).map(([at, db]) => ({ at, db }));
      let found = false;
      const tracks = doc.tracks.map((t) =>
        t.id !== cmd.trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id !== cmd.clipId) return c;
                found = true;
                if (!points.length) {
                  const { envelope: _cleared, ...rest } = c;
                  return rest;
                }
                return { ...c, envelope: points };
              }),
            },
      );
      return found ? { ...doc, tracks } : doc;
    }
    case "set-time-track": {
      const points = cmd.points
        .filter((p) => Number.isFinite(p.at) && p.at >= 0 && Number.isFinite(p.speed) && p.speed >= 0.25 && p.speed <= 4)
        .map((p) => ({ at: Math.round(p.at), speed: Math.round(p.speed * 1000) / 1000 }))
        .sort((a, b) => a.at - b.at);
      if (!points.length) {
        if (!doc.timeTrack) return doc;
        const { timeTrack: _cleared, timeTrackLog: _log, ...rest } = doc;
        return rest;
      }
      // AU-36: logarithmic interpolation between points (speed changing at a steady ratio, as Audacity offers)
      const { timeTrackLog: _was, ...base } = doc;
      return cmd.log ? { ...base, timeTrack: points, timeTrackLog: true } : { ...base, timeTrack: points };
    }
    case "set-tempo": {
      if (!Number.isFinite(cmd.bpm) || !Number.isFinite(cmd.beatsPerBar)) return doc;
      const bpm = Math.round(Math.min(300, Math.max(30, cmd.bpm)) * 10) / 10;
      const beatsPerBar = Math.round(Math.min(16, Math.max(1, cmd.beatsPerBar)));
      if (doc.tempo && doc.tempo.bpm === bpm && doc.tempo.beatsPerBar === beatsPerBar) return doc;
      return { ...doc, tempo: { bpm, beatsPerBar } };
    }
    case "set-bus-fx": {
      const fx = cleanFx(cmd.fx);
      let changed = false;
      const buses = (doc.buses ?? []).map((b) => {
        if (b.id !== cmd.busId || JSON.stringify(fx) === JSON.stringify(b.fx ?? [])) return b;
        changed = true;
        const { fx: _old, ...rest } = b;
        return fx.length ? { ...rest, fx } : rest;
      });
      return changed ? { ...doc, buses } : doc;
    }
    case "set-master-fx": {
      const fx = cleanFx(cmd.fx);
      if (JSON.stringify(fx) === JSON.stringify(doc.masterFx ?? [])) return doc;
      const { masterFx: _old, ...rest } = doc;
      return fx.length ? { ...rest, masterFx: fx } : rest;
    }
    case "set-clip-group": {
      const ids = new Set(cmd.clipIds);
      let changed = false;
      const tracks = doc.tracks.map((t) => {
        let touched = false;
        const clips = t.clips.map((c) => {
          if (!ids.has(c.id) || (c.groupId ?? null) === cmd.groupId) return c;
          touched = true;
          const { groupId: _old, ...rest } = c;
          return cmd.groupId ? { ...rest, groupId: cmd.groupId } : rest;
        });
        if (!touched) return t;
        changed = true;
        return { ...t, clips };
      });
      return changed ? { ...doc, tracks } : doc;
    }
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
        ...(cmd.notes && cmd.notes.length
          ? { notes: cmd.notes.map((n) => ({ at: Math.max(0, Math.round(n.at)), length: Math.max(1, Math.round(n.length)), pitch: Math.min(127, Math.max(0, Math.round(n.pitch))), velocity: Math.min(127, Math.max(1, Math.round(n.velocity))) })) }
          : {}),
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
    case "set-track-color": {
      const color = PALETTE.includes(cmd.color) ? cmd.color : undefined;
      return mapTrack(doc, cmd.trackId, (t) => {
        if (t.color === color) return t;
        const { color: _old, ...rest } = t;
        return color ? { ...rest, color } : rest;
      });
    }
    case "set-clip-color": {
      const color = PALETTE.includes(cmd.color) ? cmd.color : undefined;
      return mapTrack(doc, cmd.trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== cmd.clipId || c.color === color) return c;
          const { color: _old, ...rest } = c;
          return color ? { ...rest, color } : rest;
        }),
      }));
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
    case "add-vca": {
      const vca: Vca = { id: newId(), name: cmd.name.trim() || "VCA", gainDb: 0 };
      return { ...doc, vcas: [...(doc.vcas ?? []), vca] };
    }
    case "remove-vca": {
      const before = doc.vcas ?? [];
      const vcas = before.filter((v) => v.id !== cmd.vcaId);
      if (vcas.length === before.length) return doc;
      const tracks = doc.tracks.map((t) => (t.vcaId === cmd.vcaId ? { ...t, vcaId: undefined } : t));
      return { ...doc, vcas, tracks };
    }
    case "assign-vca": {
      const vcaId = cmd.vcaId ?? undefined;
      if (vcaId !== undefined && !(doc.vcas ?? []).some((v) => v.id === vcaId)) return doc;
      return mapTrack(doc, cmd.trackId, (t) => (t.vcaId === vcaId ? t : { ...t, vcaId }));
    }
    case "set-vca-gain":
    case "set-vca-mute": {
      let changed = false;
      const vcas = (doc.vcas ?? []).map((v) => {
        if (v.id !== cmd.vcaId) return v;
        if (cmd.type === "set-vca-gain") {
          const gainDb = Math.max(-60, Math.min(12, cmd.gainDb));
          if (v.gainDb === gainDb) return v;
          changed = true;
          return { ...v, gainDb };
        }
        if ((v.mute ?? false) === cmd.mute) return v;
        changed = true;
        return { ...v, mute: cmd.mute };
      });
      return changed ? { ...doc, vcas } : doc;
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
    case "set-track-mute":
      return mapTrack(doc, cmd.trackId, (t) => (t.mute === cmd.mute ? t : { ...t, mute: cmd.mute }));
    case "set-track-solo":
      return mapTrack(doc, cmd.trackId, (t) => (t.solo === cmd.solo ? t : { ...t, solo: cmd.solo }));
    case "set-master-gain": {
      const gainDb = Math.max(-60, Math.min(12, Math.round(cmd.gainDb * 10) / 10));
      return (doc.masterGainDb ?? 0) === gainDb ? doc : { ...doc, masterGainDb: gainDb };
    }
    case "set-bus-mute": {
      const buses = doc.buses ?? [];
      const bus = buses.find((b) => b.id === cmd.busId);
      if (!bus || (bus.mute ?? false) === cmd.mute) return doc;
      return { ...doc, buses: buses.map((b) => (b.id === cmd.busId ? { ...b, mute: cmd.mute } : b)) };
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
    case "remove-marker": {
      const markers = doc.markers.filter((m) => m.id !== cmd.markerId);
      return markers.length === doc.markers.length ? doc : { ...doc, markers };
    }
    case "set-marker": {
      let changed = false;
      const markers = doc.markers.map((m) => {
        if (m.id !== cmd.markerId) return m;
        const next = { ...m, at: cmd.at === undefined ? m.at : Math.max(0, Math.round(cmd.at)), label: cmd.label === undefined ? m.label : cmd.label };
        changed = next.at !== m.at || next.label !== m.label;
        return next;
      });
      return changed ? { ...doc, markers: [...markers].sort((a, b) => a.at - b.at) } : doc;
    }
    case "set-region": {
      let changed = false;
      const regions = (doc.regions ?? []).map((r) => {
        if (r.id !== cmd.regionId) return r;
        const start = Math.max(0, Math.round(cmd.start ?? r.start));
        const end = Math.max(start + 1, Math.round(cmd.end ?? r.end));
        const next = { ...r, start, end, label: cmd.label === undefined ? r.label : cmd.label };
        changed = next.start !== r.start || next.end !== r.end || next.label !== r.label;
        return next;
      });
      return changed ? { ...doc, regions: [...regions].sort((a, b) => a.start - b.start) } : doc;
    }
    case "set-clip-warp": {
      let changed = false;
      const next = mapTrack(doc, cmd.trackId, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== cmd.clipId) return c;
          const { warp: old, ...base } = c;
          if (!cmd.warp) {
            if (!old) return c;
            changed = true;
            return { ...base, mediaId: old.source, sourceIn: old.sourceIn, length: old.sourceLength };
          }
          const w = cmd.warp;
          const markers = w.markers
            .filter((m) => Number.isFinite(m.src) && Number.isFinite(m.dst) && m.src > 0 && m.src < w.sourceLength && m.dst > 0)
            .map((m) => ({ src: Math.round(m.src), dst: Math.round(m.dst) }))
            .sort((a, b) => a.src - b.src);
          changed = true;
          const warp = { source: w.source, sourceIn: Math.round(w.sourceIn), sourceLength: Math.round(w.sourceLength), markers };
          return cmd.media ? { ...base, warp, mediaId: cmd.media.id, sourceIn: 0, length: cmd.media.frames } : { ...base, warp };
        }),
      }));
      if (!changed) return doc;
      return cmd.media ? { ...next, media: { ...doc.media, [cmd.media.id]: cmd.media } } : next;
    }
    case "set-clip-fx":
      return mapTrack(doc, cmd.trackId, (t) => {
        const target = t.clips.find((c) => c.id === cmd.clipId);
        if (!target) return t;
        const fx = cleanFx(cmd.fx);
        if (JSON.stringify(fx) === JSON.stringify(target.fx ?? [])) return t;
        return {
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== cmd.clipId) return c;
            const { fx: _old, ...rest } = c;
            return fx.length ? { ...rest, fx } : rest;
          }),
        };
      });
    case "set-track-send": {
      if (!(doc.buses ?? []).some((b) => b.id === cmd.busId)) return doc;
      return mapTrack(doc, cmd.trackId, (t) => {
        const rest = (t.sends ?? []).filter((s) => s.busId !== cmd.busId);
        if (cmd.gainDb === null) {
          if (rest.length === (t.sends ?? []).length) return t;
          const { sends: _old, ...base } = t;
          return rest.length ? { ...base, sends: rest } : base;
        }
        const gainDb = Math.max(-60, Math.min(12, Math.round(cmd.gainDb * 10) / 10));
        if (t.sends?.some((s) => s.busId === cmd.busId && s.gainDb === gainDb)) return t;
        return { ...t, sends: [...rest, { busId: cmd.busId, gainDb }] };
      });
    }
    case "set-track-view": {
      return mapTrack(doc, cmd.trackId, (t) => {
        if ((t.view === "spectrogram") === cmd.spectrogram) return t;
        const { view: _old, ...rest } = t;
        return cmd.spectrogram ? { ...rest, view: "spectrogram" } : rest;
      });
    }
    case "set-snap": {
      if (doc.snap?.grid === cmd.grid && doc.snap?.bars === cmd.bars) return doc;
      return { ...doc, snap: { grid: cmd.grid, bars: cmd.bars } };
    }
    case "add-marker": {
      const marker: Marker = { id: newId(), at: Math.max(0, Math.round(cmd.at)), label: cmd.label, ...(cmd.clipId ? { clipId: cmd.clipId } : {}) };
      return { ...doc, markers: [...doc.markers, marker].sort((a, b) => a.at - b.at) };
    }
  }
}
