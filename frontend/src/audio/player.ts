import type { Engine, SessionDoc } from "../engine";
import { FADE_SHAPES, type TrackFx } from "../engine/document";
import type { WorkletBus, WorkletClip, WorkletMessage, WorkletReply } from "./player-worklet";
import workletUrl from "./player-worklet.ts?worker&url";
import { NativeNode, nativeChoice } from "./native-node";
import { foaGains, surroundGains } from "./surround";

const CORE_URL = "/core/formwav_dsp.wasm";

export interface ClipPlan {
  clips: WorkletClip[];
  end: number;
  skipped: number;
  /** PT-38, AA-11: placed clips as records of seven (index, then speaker gains), and whether the core folds its bus. */
  places?: number[];
  fold?: boolean;
  /** PT-42: the bus's format, 0 for 5.1 and 1 for first-order ambisonics. */
  surroundFormat?: number;
  buses: WorkletBus[];
  /** Master fader in dB (0 turns the master stage off). */
  masterDb: number;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Enabled effect stages as flat [kind, freq, gainDb, q, ...] in the core's codes (backend render.py FX_KINDS, core fx.rs). */
export function flatFx(fx: readonly TrackFx[] | undefined): number[] {
  const codes = { highpass: 1, lowpass: 2, peak: 3, lowshelf: 4, highshelf: 5 } as const;
  return (fx ?? []).flatMap((f) => {
    if (f.bypass || f.kind === "compressor" || f.kind === "reverb" || f.kind === "voice") return [];
    // RX-24, RX-40, RX-49: the denoiser rides the clip chain as kind 7, its reduction and sensitivity in the filter slots
    if (f.kind === "denoise") return [7, f.reductionDb, f.sensitivityDb, 0];
    if (f.kind === "echo") return [9, f.delayMs, f.feedback, f.mix];
    if (f.kind === "chorus") return [10, f.rateHz, f.depthMs, f.mix];
    if (f.kind === "limiter") return [11, f.ceilingDb, f.releaseMs, 0];
    if (f.kind === "tremolo") return [12, f.rateHz, f.depth, f.spread];
    if (f.kind === "gate") return [13, f.thresholdDb, f.releaseMs, f.rangeDb];
    if (f.kind === "phaser") return [14, f.rateHz, f.depth, f.feedback];
    if (f.kind === "flanger") return [15, f.rateHz, f.depthMs, f.feedback];
    if (f.kind === "dehum") return [17, f.baseHz, f.harmonics, f.q];
    if (f.kind === "declick") return [18, f.sensitivity, f.maxMs, 0];
    return [codes[f.kind], f.freq, f.gainDb, f.q];
  });
}

/** The filters' parameter automation (PT-19) for the clip chain flatFx builds, numbered by its stages (bypassed
 * filters and compressors skipped, as there); param 0 frequency, 1 gain, 2 Q; points flat [time, value, ...]. */
export function flatFxAuto(fx: readonly TrackFx[] | undefined): { stage: number; param: number; points: number[] }[] {
  const out: { stage: number; param: number; points: number[] }[] = [];
  let stage = 0;
  for (const f of fx ?? []) {
    if (f.bypass || f.kind === "compressor" || f.kind === "reverb" || f.kind === "voice") continue;
    if (f.kind === "denoise" || f.kind === "echo" || f.kind === "chorus" || f.kind === "limiter" || f.kind === "tremolo" || f.kind === "gate" || f.kind === "phaser" || f.kind === "flanger" || f.kind === "dehum" || f.kind === "declick") {
      stage++; // a place in the chain, nothing to automate
      continue;
    }
    (["freq", "gain", "q"] as const).forEach((key, param) => {
      const pts = f.automation?.[key];
      if (pts?.length) out.push({ stage, param, points: pts.flatMap((p) => [p.time, p.value]) });
    });
    stage++;
  }
  return out;
}

/** Enabled stages of any kind as flat [kind, a, b, c, d, e, ...] for bus and master chains (backend render.py _stage,
 * core fx.rs Stage::design): filters carry frequency, gain and Q; the compressor (6) threshold, ratio, attack, release
 * and makeup. */
export function flatStages(fx: readonly TrackFx[] | undefined): number[] {
  const codes = { highpass: 1, lowpass: 2, peak: 3, lowshelf: 4, highshelf: 5 } as const;
  return (fx ?? []).flatMap((f) => {
    if (f.bypass) return [];
    if (f.kind === "compressor") return [6, f.thresholdDb, f.ratio, f.attackMs, f.releaseMs, f.makeupDb];
    if (f.kind === "denoise") return [7, f.reductionDb, f.sensitivityDb, 0, 0, 0];
    if (f.kind === "reverb") return [8, f.room, f.damping, f.mix, f.width, 0];
    if (f.kind === "echo") return [9, f.delayMs, f.feedback, f.mix, 0, 0];
    if (f.kind === "chorus") return [10, f.rateHz, f.depthMs, f.mix, 0, 0];
    if (f.kind === "limiter") return [11, f.ceilingDb, f.releaseMs, 0, 0, 0];
    if (f.kind === "tremolo") return [12, f.rateHz, f.depth, f.spread, 0, 0];
    if (f.kind === "gate") return [13, f.thresholdDb, f.releaseMs, f.rangeDb, 0, 0];
    if (f.kind === "phaser") return [14, f.rateHz, f.depth, f.feedback, 0, 0];
    if (f.kind === "flanger") return [15, f.rateHz, f.depthMs, f.feedback, 0, 0];
    if (f.kind === "voice") return [16, f.strength, 0, 0, 0, 0];
    if (f.kind === "dehum") return [17, f.baseHz, f.harmonics, f.q, 0, 0];
    if (f.kind === "declick") return [18, f.sensitivity, f.maxMs, 0, 0, 0];
    return [codes[f.kind], f.freq, f.gainDb, f.q, 0, 0];
  });
}

/** A dB envelope's value at `t`, interpolated in linear gain between points and held outside them, as the core does. */
function envGain(points: [number, number][], t: number): number {
  if (t <= points[0][0]) return 10 ** (points[0][1] / 20);
  for (let i = 1; i < points.length; i++) {
    const [t1, d1] = points[i];
    if (t <= t1) {
      const [t0, d0] = points[i - 1];
      const g0 = 10 ** (d0 / 20);
      const g1 = 10 ** (d1 / 20);
      return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
    }
  }
  return 10 ** (points[points.length - 1][1] / 20);
}

/** AU-34: a clip envelope's gain at `t`, interpolated in dB between points (Audacity 2's clip envelopes are exponential:
 *  halfway between gains of 1 and 0.25 its own render measures 0.5004) and held outside them. */
function clipEnvGain(points: [number, number][], t: number): number {
  if (t <= points[0][0]) return 10 ** (points[0][1] / 20);
  for (let i = 1; i < points.length; i++) {
    const [t1, d1] = points[i];
    if (t <= t1) {
      const [t0, d0] = points[i - 1];
      return 10 ** ((t1 === t0 ? d1 : d0 + ((d1 - d0) * (t - t0)) / (t1 - t0)) / 20);
    }
  }
  return 10 ** (points[points.length - 1][1] / 20);
}

/**
 * A clip's envelope (session times, dB) as the flat gain points the core takes, multiplied with the track's volume
 * automation when it has some. The core interpolates in gain, so the clip's dB curve is sampled in steps of at most
 * 0.1 dB (within about 1e-5 of the curve), and with automation the product also at every breakpoint of both and eight
 * times inside each span. Points before the session start fold into one at 0.
 */
function clipEnvelope(clipPoints: [number, number][], trackFlat: number[] | undefined): number[] {
  const track: [number, number][] = [];
  for (let i = 0; trackFlat && i + 1 < trackFlat.length; i += 2) track.push([trackFlat[i], trackFlat[i + 1]]);
  const times = new Set<number>(clipPoints.map((p) => p[0]));
  for (const p of track) times.add(p[0]);
  const sorted = [...times].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    const rise = Math.abs(20 * Math.log10(clipEnvGain(clipPoints, b) / clipEnvGain(clipPoints, a)));
    const steps = Math.max(track.length ? 8 : 1, Math.ceil(rise / 0.1));
    for (let k = 1; k < steps; k++) times.add(Math.round(a + ((b - a) * k) / steps));
  }
  const at = [...times].filter((t) => t >= 0);
  if (sorted[0] < 0) at.push(0);
  const out: number[] = [];
  for (const t of [...new Set(at)].sort((a, b) => a - b)) {
    const g = clipEnvGain(clipPoints, t) * (track.length ? envGain(track, t) : 1);
    out.push(t, 20 * Math.log10(Math.max(g, 1e-6)));
  }
  return out;
}

/** AU-36: how many output samples `end` samples of session take under a time track: the integral of 1 / speed, exact
 *  for each linear or logarithmic segment, the speed held before the first point and after the last (as the worklet
 *  and the export renderer play it). */
export function timeTrackLength(end: number, points: readonly { at: number; speed: number }[] | undefined, log: boolean): number {
  if (!points || points.length < 2) return end;
  const first = points[0];
  const last = points[points.length - 1];
  if (end <= first.at) return end / first.speed;
  let total = first.at / first.speed;
  for (let i = 1; i < points.length && points[i - 1].at < end; i++) {
    const a = points[i - 1];
    const b = points[i];
    const span = b.at - a.at;
    if (span <= 0) continue;
    const len = Math.min(b.at, end) - a.at;
    const f = len / span;
    const s0 = a.speed;
    const s1 = log ? s0 * (b.speed / s0) ** f : s0 + (b.speed - s0) * f;
    if (Math.abs(s1 - s0) < 1e-12) total += len / s0;
    else total += log ? (len * (1 / s0 - 1 / s1)) / Math.log(s1 / s0) : (len * Math.log(s1 / s0)) / (s1 - s0);
  }
  if (end > last.at) total += (end - last.at) / last.speed;
  return total;
}

/** PT-33: a clip's chain in the core: its own filters, then its own compressor, then its track's filters (Pro Tools'
 *  clip effects ahead of the track's inserts). The core applies a clip's gain after its chain, so the compressor's
 *  threshold is lowered by the clip gain: compressing the clip at its clip gain is the same as compressing the file at
 *  that threshold and applying the gain after. The track's automation stage numbers move past the clip's stages. */
export function clipChain(
  clip: { fx?: readonly TrackFx[]; gainDb: number },
  trackFx: number[],
  trackAuto: { stage: number; param: number; points: number[] }[],
): { fx?: number[]; fxAuto?: { stage: number; param: number; points: number[] }[]; comp?: number[] } {
  const own = flatFx(clip.fx);
  const comp = clip.fx?.find((f): f is Extract<TrackFx, { kind: "compressor" }> => f.kind === "compressor" && !f.bypass);
  const ahead = own.length / 4 + (comp ? 1 : 0);
  const fx = [...own, ...trackFx];
  const fxAuto = trackAuto.map((a) => ({ ...a, stage: a.stage + ahead }));
  return {
    ...(fx.length ? { fx } : {}),
    ...(fxAuto.length ? { fxAuto } : {}),
    ...(comp ? { comp: [own.length / 4, comp.thresholdDb - clip.gainDb, comp.ratio, comp.attackMs, comp.releaseMs, comp.makeupDb] } : {}),
  };
}

export function planClips(doc: SessionDoc, sources: Map<string, number>): ClipPlan {
  const soloed = doc.tracks.some((t) => t.solo);
  const busIndex = new Map<string, number>();
  const mutedBuses = new Set<string>();
  const buses: WorkletBus[] = [];
  for (const bus of doc.buses ?? []) {
    if (bus.mute) {
      mutedBuses.add(bus.id);
      continue;
    }
    const id = buses.length + 1;
    busIndex.set(bus.id, id);
    const busStages = flatStages(bus.fx);
    buses.push({ id, gain: dbToGain(bus.gainDb), pan: bus.pan ?? 0, ...(busStages.length ? { stages: busStages } : {}) });
  }
  const clips: WorkletClip[] = [];
  // PT-38, AA-11: each placed clip as a record of seven numbers (its index in `clips`, then its speaker gains in SMPTE
  // order), for the core's six-channel bus when the session hears its fold-down
  const places: number[] = [];
  let end = 0;
  let skipped = 0;
  for (const track of doc.tracks) {
    const vca = track.vcaId !== undefined ? (doc.vcas ?? []).find((v) => v.id === track.vcaId) : undefined;
    if (track.mute || vca?.mute || (soloed && !track.solo) || (track.busId !== undefined && mutedBuses.has(track.busId))) continue;
    let bus = track.busId !== undefined ? busIndex.get(track.busId) ?? 0 : 0;
    let fxFlat = flatFx(track.fx);
    let fxAuto = flatFxAuto(track.fx);
    if (bus === 0 && (track.fx ?? []).some((f) => (f.kind === "compressor" || f.kind === "reverb" || f.kind === "voice") && !f.bypass)) {
      // A compressor must see the track's sum, and a reverb's tail must ring on past each clip's end (PT-22): its own
      // bus (unity, centre) carries the whole chain, as in exports.
      // (Bus chains are not automated yet, so the automation stays with the clip chain it was written for.)
      bus = buses.length + 1;
      buses.push({ id: bus, gain: 1, pan: 0, stages: flatStages(track.fx) });
      fxFlat = [];
      fxAuto = [];
    }
    const volumePoints = track.automation?.volume?.length ? track.automation.volume.flatMap((p) => [p.time, p.value]) : undefined;
    const panPoints = track.automation?.pan?.length ? track.automation.pan.flatMap((p) => [p.time, p.value]) : undefined;
    // PT-38, AA-11: a session hearing its 5.1 as a fold-down gives the core each placed clip's speaker gains, and the
    // core plays its six-channel bus folded to stereo (the engine's stereo mix does the same)
    const s = track.surround;
    const lfeGain = s?.lfeDb !== undefined && s.lfeDb > -80 ? 10 ** (s.lfeDb / 20) : 0;
    const g = s && doc.spatialFormat !== "foa" ? surroundGains(s.x, s.y) : null;
    // PT-42: an ambisonic session encodes each placed track by direction and elevation (W Y Z X, the last two slots empty)
    const record = !doc.surroundFold || !s ? null : g ? [g.L, g.R, g.C, lfeGain, g.Ls, g.Rs] : [...foaGains(s.x, s.y, s.el ?? 0), 0, 0];
    for (const clip of track.clips) {
      // A pitched clip plays its derived render (non-destructive pitch; same length as the original).
      const playId = clip.pitchMediaId && doc.media[clip.pitchMediaId] ? clip.pitchMediaId : clip.mediaId;
      const media = doc.media[playId];
      const source = sources.get(playId);
      if (!media || source === undefined) continue;
      if (media.sampleRate !== doc.sampleRate) {
        skipped++;
        continue;
      }
      const envPoints = clip.envelope?.length ? clipEnvelope(clip.envelope.map((p) => [clip.start + p.at - clip.sourceIn, p.db] as [number, number]), volumePoints) : volumePoints;
      clips.push({
        source,
        start: clip.start,
        sourceIn: clip.sourceIn,
        length: clip.length,
        gain: dbToGain((volumePoints ? 0 : track.gainDb) + (vca?.gainDb ?? 0) + clip.gainDb),
        pan: panPoints ? 0 : track.pan ?? 0,
        gainPoints: envPoints,
        panPoints,
        ...clipChain(clip, fxFlat, fxAuto),
        fadeIn: clip.fadeIn ?? 0,
        fadeOut: clip.fadeOut ?? 0,
        fadeShape: FADE_SHAPES[clip.fadeShape ?? "linear"] ?? 0,
        bus,
        track: doc.tracks.indexOf(track) + 1,
      });
      if (record) places.push(clips.length - 1, ...record);
      // PT-18, post-fader sends: the clip again, into the send's bus at the send level, with its own insert state and
      // envelopes, not metered as the track (track 0)
      const main = clips[clips.length - 1];
      for (const send of track.sends ?? []) {
        const sendBus = busIndex.get(send.busId);
        if (sendBus === undefined || mutedBuses.has(send.busId)) continue;
        clips.push({ ...main, gain: main.gain * dbToGain(send.gainDb), bus: sendBus, track: 0 });
      }
      end = Math.max(end, clip.start + clip.length);
    }
  }
  return { clips, end, skipped, buses, masterDb: doc.masterGainDb ?? 0, places, fold: !!doc.surroundFold && places.length > 0, surroundFormat: doc.spatialFormat === "foa" ? 1 : 0 };
}

function send(node: AudioWorkletNode, message: WorkletMessage, transfer: Transferable[] = []): void {
  node.port.postMessage(message, transfer);
}

function request(node: AudioWorkletNode, message: WorkletMessage, match: (reply: WorkletReply) => boolean, transfer: Transferable[] = []): Promise<WorkletReply> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent<WorkletReply>) => {
      if (!match(e.data)) return;
      node.port.removeEventListener("message", onMessage);
      resolve(e.data);
    };
    node.port.addEventListener("message", onMessage);
    node.port.start();
    send(node, message, transfer);
  });
}

/** What a streamed source needs: its size, and the frame to start from (the one under the playhead). */
interface StreamInfo {
  frames: number;
  channels: number;
  rate: number;
  from: number;
}

/** Streamed sources' progress, frames filled of frames total, by media id. */
export const streamProgress = new Map<string, [number, number]>();

/** One streamed source's fill: pieces still to fetch (in order), pieces written, and plays waiting for pieces. */
interface StreamCtl {
  chunk: number;
  total: number;
  queue: number[];
  filled: Set<number>;
  waiters: { need: number[]; resolve: () => void }[];
  running: boolean;
  /** AP-05: a source held as a window: the ring's frames, the next frame to queue, and how far ahead to keep filled */
  window?: number;
  next?: number;
  ahead?: number;
  /** bumped when a windowed source starts afresh, so a piece fetched before then is not counted as held */
  gen?: number;
}

// AP-05: a file whose floats would pass this is held as a window of WINDOW_SECONDS around the playhead, filled
// AHEAD_SECONDS ahead of it as it plays
const WINDOW_ABOVE_BYTES = 512 * 2 ** 20;
const WINDOW_SECONDS = 240;
const AHEAD_SECONDS = 150;
const streams = new WeakMap<AudioWorkletNode, Map<string, StreamCtl>>();

/**
 * Moves a streamed source's fill to `frame`: the piece holding it and the next go first, then the rest ahead of it,
 * then the rest behind; resolves when those two pieces are written (at once when they are). Null when not streamed.
 */
function focusStream(node: AudioWorkletNode, mediaId: string, frame: number): Promise<void> | null {
  const ctl = streams.get(node)?.get(mediaId);
  if (!ctl) return null;
  const first = Math.floor(Math.max(0, Math.min(frame, ctl.total - 1)) / ctl.chunk) * ctl.chunk;
  const need = [first, first + ctl.chunk].filter((s) => s < ctl.total);
  if (ctl.window && !need.every((s) => ctl.filled.has(s))) {
    // AP-05: a windowed source starts afresh at the playhead (the core begins a new range at a write that does not carry
    // on), its pieces queued in order from there as far ahead as it fills
    ctl.filled.clear();
    ctl.queue = [];
    ctl.next = first;
    ctl.gen = (ctl.gen ?? 0) + 1;
    advanceWindow(ctl, first);
    return new Promise((resolve) => ctl.waiters.push({ need, resolve }));
  }
  if (ctl.window) return Promise.resolve();
  const rest = ctl.queue.filter((s) => !need.includes(s));
  ctl.queue = [...need.filter((s) => !ctl.filled.has(s)), ...rest.filter((s) => s > first), ...rest.filter((s) => s < first)];
  if (need.every((s) => ctl.filled.has(s))) return Promise.resolve();
  return new Promise((resolve) => ctl.waiters.push({ need, resolve }));
}

/** AP-05: queues a windowed source's next pieces in order up to `ahead` past `frame` (the playhead's frame in it), and
 *  forgets pieces its ring no longer holds, so a seek back to them fetches them again. */
function advanceWindow(ctl: StreamCtl, frame: number): void {
  if (!ctl.window || ctl.next === undefined) return;
  const until = Math.min(ctl.total, frame + (ctl.ahead ?? 0));
  while (ctl.next < until) {
    if (!ctl.filled.has(ctl.next) && !ctl.queue.includes(ctl.next)) ctl.queue.push(ctl.next);
    ctl.next += ctl.chunk;
  }
  const keepFrom = ctl.next - ctl.window;
  for (const s of ctl.filled) if (s < keepFrom) ctl.filled.delete(s);
}

/** Fetches a streamed source's queued pieces one at a time, releasing waiters as their pieces land (and all of them if it stops). */
async function pump(ctl: StreamCtl, mediaId: string, fetchAt: (start: number) => Promise<void>): Promise<void> {
  if (ctl.running) return;
  ctl.running = true;
  while (ctl.queue.length) {
    const s = ctl.queue.shift() as number;
    if (ctl.filled.has(s)) continue;
    const gen = ctl.gen;
    try {
      await fetchAt(s);
    } catch (err) {
      console.warn(`formwav: streaming ${mediaId} stopped at frame ${s}:`, err);
      break;
    }
    if (ctl.gen !== gen) continue; // AP-05: a seek started the window afresh while this piece was on its way
    ctl.filled.add(s);
    ctl.waiters = ctl.waiters.filter((w) => (w.need.every((n) => ctl.filled.has(n)) ? (w.resolve(), false) : true));
  }
  ctl.running = false;
  for (const w of ctl.waiters) w.resolve();
  ctl.waiters = [];
}

/**
 * A long file played before it has all arrived: the core allocates it silent at full length and 2 s pieces are
 * written into it (each a short copy on the audio thread), the two at `from` first; it counts as loaded once those
 * two are in, and play and seek refocus the fill on the playhead. With `wait` every piece is written first.
 */
async function streamInto(node: AudioWorkletNode, sources: Map<string, number>, mediaId: string, nextId: () => number, info: StreamInfo, wait: boolean, where?: () => number | null): Promise<void> {
  const id = nextId();
  // AP-05: a file whose floats would pass WINDOW_ABOVE_BYTES is held as a window around the playhead
  const windowed = info.frames * info.channels * 4 > WINDOW_ABOVE_BYTES;
  const window = windowed ? WINDOW_SECONDS * info.rate : 0;
  const reply = await request(node, { type: "alloc", id, rate: info.rate, channels: info.channels, frames: info.frames, ...(windowed ? { window } : {}) }, (r) => r.type === "loaded" && r.id === id);
  if (reply.type === "loaded" && reply.frames < 0) throw new Error("the audio core could not hold this file");
  const chunk = info.rate * 2;
  const ctl: StreamCtl = { chunk, total: info.frames, queue: [], filled: new Set(), waiters: [], running: false };
  if (windowed) {
    ctl.window = window;
    ctl.ahead = AHEAD_SECONDS * info.rate;
    ctl.next = Math.floor(info.from / chunk) * chunk;
    ctl.gen = 0;
    advanceWindow(ctl, info.from);
  } else for (let s = 0; s < info.frames; s += chunk) ctl.queue.push(s);
  let byMedia = streams.get(node);
  if (!byMedia) streams.set(node, (byMedia = new Map()));
  byMedia.set(mediaId, ctl);
  streamProgress.set(mediaId, [0, info.frames]);
  let filled = 0;
  const fetchAt = async (start: number) => {
    const res = await fetch(`/api/media/${mediaId}/pcm?start=${start}&frames=${chunk}`);
    if (!res.ok) throw new Error(`audio request answered ${res.status}`);
    const data = new Float32Array(await res.arrayBuffer());
    send(node, { type: "write", id, offset: start, data }, [data.buffer]);
    filled += data.length / Math.max(1, info.channels);
    streamProgress.set(mediaId, [filled, info.frames]);
  };
  const ready = focusStream(node, mediaId, info.from);
  const filling = pump(ctl, mediaId, fetchAt);
  if (windowed && where) {
    // AP-05: twice a second the window is filled on ahead of the playhead (and lets go behind it)
    const timer = setInterval(() => {
      if (streams.get(node)?.get(mediaId) !== ctl) return clearInterval(timer);
      const at = where();
      if (at === null) return;
      advanceWindow(ctl, at);
      void pump(ctl, mediaId, fetchAt);
    }, 500);
  }
  await (wait && !windowed ? filling : ready);
  sources.set(mediaId, id);
}

/** Refocuses every streamed source a clip plays at `position` on that frame; resolves when their pieces there are in. */
function focusAll(node: AudioWorkletNode, doc: SessionDoc, position: number): Promise<unknown> {
  const waits: Promise<void>[] = [];
  for (const track of doc.tracks)
    for (const clip of track.clips)
      if (position >= clip.start && position < clip.start + clip.length) {
        const ready = focusStream(node, clip.mediaId, clip.sourceIn + (position - clip.start));
        if (ready) waits.push(ready);
      }
  return Promise.all(waits);
}

/** The stream description of a media from the session: its size, and the frame a clip of it plays at `position`, else 0. */
function streamInfo(doc: SessionDoc, mediaId: string, position: number): StreamInfo | undefined {
  const media = doc.media[mediaId];
  if (!media || !media.frames || media.sampleRate !== doc.sampleRate) return undefined;
  let from = 0;
  for (const track of doc.tracks)
    for (const clip of track.clips)
      if (clip.mediaId === mediaId && position >= clip.start && position < clip.start + clip.length) from = clip.sourceIn + (position - clip.start);
  return { frames: media.frames, channels: media.channels || 1, rate: media.sampleRate, from };
}

async function loadInto(node: AudioWorkletNode, sources: Map<string, number>, mediaId: string, nextId: () => number, info?: StreamInfo, wait = false, where?: () => number | null): Promise<void> {
  if (sources.has(mediaId)) return;
  if ((node as unknown) instanceof NativeNode) {
    const id = nextId();
    await (node as unknown as NativeNode).loadSource(id, mediaId);
    sources.set(mediaId, id);
    return;
  }
  if (info && info.frames > 60 * info.rate) return streamInto(node, sources, mediaId, nextId, info, wait, where);
  const res = await fetch(`/api/media/${mediaId}/audio`);
  if (!res.ok) throw new Error(`audio request answered ${res.status}`);
  const bytes = await res.arrayBuffer();
  const id = nextId();
  const reply = await request(node, { type: "load", id, bytes }, (r) => r.type === "loaded" && r.id === id, [bytes]);
  if (reply.type === "loaded" && reply.frames < 0) throw new Error("the audio core could not decode this file");
  sources.set(mediaId, id);
}

/** AU-22: where playback goes on this machine: the output device ("" the system default), its rate (0 the session's)
 *  and the device channels the player's left and right go to (counted from 0). */
export interface OutputChoice {
  deviceId: string;
  rate: number;
  map: [number, number];
}
const OUTPUT_KEY = "formwav.output";
const OUTPUT_RATES = new Set([0, 44100, 48000, 88200, 96000]);
export function loadOutput(): OutputChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTPUT_KEY) ?? "{}") as Partial<OutputChoice>;
    const map: [number, number] = Array.isArray(raw.map) && raw.map.length === 2 && raw.map.every((c) => Number.isInteger(c) && c >= 0 && c < 32) ? [raw.map[0], raw.map[1]] : [0, 1];
    return { deviceId: typeof raw.deviceId === "string" ? raw.deviceId : "", rate: OUTPUT_RATES.has(Number(raw.rate)) ? Number(raw.rate) : 0, map };
  } catch {
    return { deviceId: "", rate: 0, map: [0, 1] };
  }
}
/** Sends a context to an output device; a device that has gone leaves it on the default rather than failing play. */
async function setSink(ctx: AudioContext, deviceId: string): Promise<void> {
  const sinkable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  try {
    await sinkable.setSinkId?.(deviceId);
  } catch {
    await sinkable.setSinkId?.("").catch(() => undefined);
  }
}

async function makeNode(ctx: BaseAudioContext, core: ArrayBuffer): Promise<AudioWorkletNode> {
  const device = nativeChoice();
  if (device !== null) return (await NativeNode.open(ctx.sampleRate, device)) as unknown as AudioWorkletNode;
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, "formwav-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(ctx.destination);
  const bytes = core.slice(0);
  const reply = await request(node, { type: "init", bytes }, (r) => r.type === "ready" || r.type === "error", [bytes]);
  if (reply.type === "error") throw new Error(`the audio core failed to start: ${reply.message}`);
  return node;
}

export class Player {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private module: Promise<ArrayBuffer> | null = null;
  private sources = new Map<string, number>();
  private counter = 0;
  private lastPlan: ClipPlan = { clips: [], end: 0, skipped: 0, buses: [], masterDb: 0 };
  private pending = new Map<string, Promise<void>>();

  constructor(private readonly engine: Engine) {
    engine.subscribe("document", (doc) => {
      if (this.node) this.sendPlan(this.node, doc);
      this.prefetch(doc);
    });
  }

  private lastIntegrated = Number.NEGATIVE_INFINITY;
  private levelListeners = new Set<(left: number, right: number, tracks: number[], loudness: number[] | null, buses: number[], correlation: number | null) => void>();

  /** Master peaks, per-track peaks as [left, right] pairs in the document's track order, [M, S, I] loudness in LUFS (null on stop), and per-bus peak pairs in the document's bus order. */
  onOutputLevel(listener: (left: number, right: number, tracks: number[], loudness: number[] | null, buses: number[], correlation: number | null) => void): void {
    this.levelListeners.add(listener);
  }

  private surroundListeners = new Set<(peaks: number[] | null) => void>();

  /** PT-38, AA-11: the 5.1 bus's six peaks (L R C LFE Ls Rs) while it plays folded, null otherwise. */
  onSurroundLevel(listener: (peaks: number[] | null) => void): void {
    this.surroundListeners.add(listener);
  }

  private emitLevel(left: number, right: number, tracks: number[], loudness: number[] | null, buses: number[] = [], correlation: number | null = null): void {
    for (const listener of this.levelListeners) listener(left, right, tracks, loudness, buses, correlation);
  }

  get skipped(): number {
    return this.lastPlan.skipped;
  }

  private core(): Promise<ArrayBuffer> {
    if (!this.module) {
      this.module = fetch(CORE_URL).then((res) => {
        if (!res.ok) throw new Error(`the audio core is missing (${res.status}); run ./formwav_oc_install (build_macos_app builds it too)`);
        return res.arrayBuffer();
      });
      this.module.catch(() => (this.module = null));
    }
    return this.module;
  }

  private nextId = (): number => ++this.counter;

  private load(node: AudioWorkletNode, mediaId: string): Promise<void> {
    let loading = this.pending.get(mediaId);
    if (!loading) {
      // AP-05: a windowed source keeps filling ahead of the playhead's frame in it (a clip of it under the playhead)
      const where = () => {
        const doc = this.engine.get("document");
        const at = this.engine.get("transport").positionSamples;
        for (const t of doc.tracks) for (const c of t.clips) if (c.mediaId === mediaId && at >= c.start && at < c.start + c.length) return c.sourceIn + (at - c.start);
        return null;
      };
      loading = loadInto(node, this.sources, mediaId, this.nextId, streamInfo(this.engine.get("document"), mediaId, this.engine.get("transport").positionSamples), false, where);
      this.pending.set(mediaId, loading);
      loading.catch(() => this.pending.delete(mediaId));
    }
    return loading;
  }

  private prefetch(doc: SessionDoc): void {
    const missing = Object.keys(doc.media).filter((id) => !this.pending.has(id));
    if (!missing.length || !doc.tracks.length) return;
    this.ensure()
      .then((node) => Promise.all(missing.map((id) => this.load(node, id))))
      .then(() => {
        if (this.node) this.sendPlan(this.node, this.engine.get("document"));
      })
      .catch(() => undefined);
  }

  private sendPlan(node: AudioWorkletNode, doc: SessionDoc): void {
    this.lastPlan = planClips(doc, this.sources);
    const loop = doc.loop?.enabled && doc.loop.end > doc.loop.start ? doc.loop : null;
    send(node, { type: "clips", clips: this.lastPlan.clips, end: this.open || loop ? 0 : this.lastPlan.end, buses: this.lastPlan.buses, masterDb: this.lastPlan.masterDb, masterFx: flatStages(doc.masterFx), timeTrack: doc.timeTrack?.length ? doc.timeTrack.flatMap((p) => [p.at, p.speed]) : undefined, timeTrackLog: doc.timeTrackLog === true, places: this.lastPlan.places, fold: this.lastPlan.fold, surroundFormat: this.lastPlan.surroundFormat });
    send(node, { type: "loop", start: loop?.start ?? 0, end: loop?.end ?? 0 });
  }

  private latestPosition: Extract<WorkletReply, { type: "position" }> | null = null;
  private positionTimer: ReturnType<typeof setTimeout> | null = null;

  private idleQuiet: ReturnType<typeof setTimeout> | null = null;

  private handlePosition(reply: Extract<WorkletReply, { type: "position" }>): void {
    this.engine.setTransport({ positionSamples: reply.position });
    this.lastIntegrated = reply.loudness[2];
    if (this.engine.get("transport").playing) this.emitLevel(reply.peakLeft, reply.peakRight, reply.trackPeaks, reply.loudness, reply.busPeaks, reply.correlation ?? null);
    else {
      // AU-37: the live instrument played with the transport stopped, measured by the core's idle render; the
      // worklet reports only while it sounds, so the meter falls to silence a moment after its last report
      this.emitLevel(reply.peakLeft, reply.peakRight, [], [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, reply.loudness[2]]);
      if (this.idleQuiet !== null) clearTimeout(this.idleQuiet);
      this.idleQuiet = setTimeout(() => {
        this.idleQuiet = null;
        if (!this.engine.get("transport").playing) this.emitLevel(0, 0, [], [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, this.lastIntegrated]);
      }, 200);
    }
    const six = this.engine.get("transport").playing && reply.surroundPeaks?.length === 6 ? reply.surroundPeaks : null;
    for (const listener of this.surroundListeners) listener(six);
  }

  private onReply = (e: MessageEvent<WorkletReply>): void => {
    const reply = e.data;
    if (reply.type === "position") {
      this.latestPosition = reply;
      if (this.positionTimer === null) {
        this.positionTimer = setTimeout(() => {
          this.positionTimer = null;
          const latest = this.latestPosition;
          this.latestPosition = null;
          if (latest) this.handlePosition(latest);
        }, 16);
      }
    }
    else if (reply.type === "ended") {
      this.engine.setTransport({ positionSamples: reply.position, playing: false });
      this.emitLevel(0, 0, [], [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, this.lastIntegrated]);
    }
  };

  private starting: Promise<AudioWorkletNode> | null = null;

  // AU-22: the output device, rate and channel map chosen on this machine, the routing node they make, and the rate
  // of the session the context serves
  private output: OutputChoice = loadOutput();
  private outputTap: AudioNode | null = null;
  private sessionRate = 0;

  /** The output as chosen: device id ("" the system default), rate (0 the session's) and channel map. */
  get outputChoice(): OutputChoice {
    return { ...this.output, map: [...this.output.map] as [number, number] };
  }

  /** The last node before the device (the channel map's merger, or the player itself), for meters and checks. */
  get outputNode(): AudioNode | null {
    return this.outputTap ?? this.node;
  }

  /** The player's two channels to the device's channels as mapped ([left's, right's], counted from 0). */
  private route(): void {
    const ctx = this.ctx;
    const node = this.node;
    if (!ctx || !node || !(node instanceof AudioWorkletNode)) return;
    node.disconnect();
    try {
      this.outputTap?.disconnect();
    } catch {
      // the previous output's context has closed
    }
    this.outputTap = null;
    const [l, r] = this.output.map;
    if (l === 0 && r === 1) {
      node.connect(ctx.destination);
      return;
    }
    const channels = Math.max(2, Math.min(ctx.destination.maxChannelCount, Math.max(l, r) + 1));
    ctx.destination.channelCount = channels;
    ctx.destination.channelCountMode = "explicit";
    ctx.destination.channelInterpretation = "discrete";
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(channels);
    node.connect(split);
    split.connect(merge, 0, Math.min(l, channels - 1));
    split.connect(merge, 1, Math.min(r, channels - 1));
    merge.connect(ctx.destination);
    this.outputTap = merge;
  }

  /** Sets the output device, rate or channel map, kept on this machine; the device and map apply at once, a new rate
   *  rebuilds the output for the next play. */
  async setOutput(next: Partial<OutputChoice>): Promise<void> {
    const before = this.output;
    this.output = { ...before, ...next, map: [...(next.map ?? before.map)] as [number, number] };
    try {
      localStorage.setItem(OUTPUT_KEY, JSON.stringify(this.output));
    } catch {
      // storage refused: the choice lasts for this visit
    }
    if (!this.ctx) return;
    if (this.output.rate !== before.rate) {
      await this.resetOutput();
      return;
    }
    if (this.output.deviceId !== before.deviceId) await setSink(this.ctx, this.output.deviceId);
    if (this.output.map.join() !== before.map.join()) this.route();
  }

  /** Drops the current output (worklet or native) so the next play builds the one now chosen; the session is untouched. */
  async resetOutput(): Promise<void> {
    if (this.node) send(this.node, { type: "stop" });
    if ((this.node as unknown) instanceof NativeNode) (this.node as unknown as NativeNode).close();
    if (this.ctx) await this.ctx.close();
    this.ctx = null;
    this.node = null;
    this.sources.clear();
    this.pending.clear();
  }

  private ensure(): Promise<AudioWorkletNode> {
    const rate = this.engine.get("document").sampleRate;
    // AU-22: the context runs at the chosen output rate, or the session's; a session at another rate rebuilds it
    if (this.ctx && this.node && this.ctx.sampleRate === (this.output.rate || rate) && this.sessionRate === rate) return Promise.resolve(this.node);
    if (!this.starting) {
      this.starting = this.start(rate).finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async start(rate: number): Promise<AudioWorkletNode> {
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.node = null;
      this.sources.clear();
      this.pending.clear();
    }
    // AU-22: the output device and its rate as chosen on this machine (the session's rate unless one is chosen)
    const ctx = new AudioContext({ sampleRate: this.output.rate || rate, latencyHint: "interactive" });
    if (this.output.deviceId) await setSink(ctx, this.output.deviceId);
    const node = await makeNode(ctx, await this.core());
    node.port.addEventListener("message", this.onReply);
    this.ctx = ctx;
    this.node = node;
    this.sessionRate = rate;
    this.route();
    if (ctx.sampleRate !== rate) send(node, { type: "rate-ratio", value: rate / ctx.sampleRate });
    if (this.speed !== 1) send(node, { type: "speed", value: this.speed });
    return node;
  }

  private speed = 1;

  /** Play-at-speed (Audacity's varispeed): 0.25 to 4 times, pitch following speed; playback only, exports unchanged. */
  setSpeed(value: number): void {
    this.speed = Math.min(4, Math.max(0.25, value));
    if (this.node) send(this.node, { type: "speed", value: this.speed });
  }

  private open = false;

  /** AU-37: a note on the live instrument (velocity 0 ends it), heard whether the transport runs or not; the audio
   *  graph is started if this is the first sound, as play starts it. */
  async liveNote(pitch: number, velocity: number): Promise<void> {
    const node = await this.ensure();
    await this.ctx?.resume();
    send(node, { type: "live-note", pitch: Math.max(0, Math.min(127, Math.round(pitch))), velocity: Math.max(0, Math.min(127, Math.round(velocity))) });
  }

  /** AP-05: the audio core's memory in bytes (null before it runs), so a long file's bound can be measured. */
  async coreMemory(): Promise<number | null> {
    if (!this.node) return null;
    const reply = await request(this.node, { type: "stats" }, (r) => r.type === "stats");
    return reply.type === "stats" ? reply.bytes : null;
  }

  /** Releases every live note (a panic, or the input going away). */
  liveAllOff(): void {
    if (this.node) send(this.node, { type: "live-all-off" });
  }

  async play(open = false): Promise<void> {
    this.open = open;
    const node = await this.ensure();
    await this.ctx?.resume();
    const doc = this.engine.get("document");
    await Promise.all(Object.keys(doc.media).map((id) => this.load(node, id)));
    this.sendPlan(node, this.engine.get("document"));
    // Audacity's loop rule: with looping on, playback that starts outside the loop starts at its beginning (it had
    // played straight past the loop from a playhead after its end). Recording's open playback keeps its pre-roll.
    let at = this.engine.get("transport").positionSamples;
    const loop = doc.loop;
    if (!open && loop?.enabled && loop.end > loop.start && (at < loop.start || at >= loop.end)) {
      at = loop.start;
      this.engine.setTransport({ positionSamples: at });
    }
    await focusAll(node, doc, at);
    send(node, { type: "seek", position: at });
    send(node, { type: "play" });
    this.engine.setTransport({ playing: true });
  }

  stop(): void {
    this.open = false;
    if (this.node) send(this.node, { type: "stop" });
    this.emitLevel(0, 0, [], null);
    this.engine.setTransport({ playing: false });
  }

  private tapNode: AnalyserNode | null = null;
  /** RX-43's live view: an analyser on the player's output, made on the current audio context and fed by the current
   * node (a fresh one whenever the context has been rebuilt); null before the player opens, or when the output is
   * native (no browser node to tap). */
  analyser(): AnalyserNode | null {
    const node = this.node as unknown as AudioNode | null;
    if (!this.ctx || !node || typeof node.connect !== "function") return null;
    if (!this.tapNode || this.tapNode.context !== this.ctx) {
      this.tapNode = this.ctx.createAnalyser();
      this.tapNode.smoothingTimeConstant = 0.6;
      node.connect(this.tapNode);
    }
    return this.tapNode;
  }

  async context(): Promise<AudioContext> {
    await this.ensure();
    if (!this.ctx) throw new Error("the audio context did not start");
    return this.ctx;
  }

  toggle(): Promise<void> {
    if (this.engine.get("transport").playing) {
      this.stop();
      return Promise.resolve();
    }
    return this.play();
  }

  seek(position: number): void {
    if (this.node) void focusAll(this.node, this.engine.get("document"), position);
    const at = Math.max(0, Math.round(position));
    this.engine.setTransport({ positionSamples: at });
    if (this.node) send(this.node, { type: "seek", position: at });
  }

  async bounce(): Promise<Float32Array[]> {
    const doc = this.engine.get("document");
    const sources = new Map<string, number>();
    let counter = 0;
    const end = planClips(doc, new Map(Object.keys(doc.media).map((id) => [id, 0]))).end;
    // AU-36: under a time track the session plays for the integral of 1 / speed, so the offline render is that long
    // (a slowed session would otherwise be cut off at its unwarped length)
    const timeTrack = doc.timeTrack?.length ? doc.timeTrack.flatMap((p) => [p.at, p.speed]) : undefined;
    const length = Math.max(1, Math.ceil(timeTrackLength(end, timeTrack ? doc.timeTrack : undefined, doc.timeTrackLog === true)) + (timeTrack ? 128 : 0));
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: doc.sampleRate });
    const node = await makeNode(ctx, await this.core());
    await Promise.all(Object.keys(doc.media).map((id) => loadInto(node, sources, id, () => ++counter, streamInfo(doc, id, 0), true)));
    const plan = planClips(doc, sources);
    send(node, { type: "clips", clips: plan.clips, end: plan.end, buses: plan.buses, masterDb: plan.masterDb, masterFx: flatStages(doc.masterFx), timeTrack, timeTrackLog: doc.timeTrackLog === true, places: plan.places, fold: plan.fold, surroundFormat: plan.surroundFormat });
    send(node, { type: "play" });
    await request(node, { type: "seek", position: 0 }, (r) => r.type === "position");
    const rendered = await ctx.startRendering();
    return [rendered.getChannelData(0), rendered.getChannelData(1)];
  }
}
