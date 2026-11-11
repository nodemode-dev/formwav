/**
 * PLAN_v13 S6, the five timebases: the fifteen frame rates (each a ratio, so 29.97 is 30000/1001), SMPTE timecode
 * (drop-frame leaves out the first two labels of every minute, four at 59.94, except each tenth minute), Feet+Frames
 * for 35 mm film (16 frames a foot), Bars|Beats at the session's one tempo and n/4 meter (960 ticks a quarter, until a
 * tempo map), Min:Secs and Samples; a position or a length written in each and read back. Positions are session
 * samples.
 */
import type { SessionDoc } from "./document";
import { barBeatAt as mapBarBeat, barStartTick, hasMap, meterAtTick, sampleToTick, tempoMap, tickToSample, ticksPerBar, ticksPerBeat, type TempoMap } from "./tempo";

export type FrameRateId = "23.976" | "24" | "25" | "29.97" | "29.97df" | "30" | "47.952" | "48" | "50" | "59.94" | "59.94df" | "60" | "100" | "119.88" | "120";

export interface FrameRate {
  id: FrameRateId;
  label: string;
  num: number;
  den: number;
  drop: boolean;
}

const RATES: [FrameRateId, number, number][] = [
  ["23.976", 24000, 1001],
  ["24", 24, 1],
  ["25", 25, 1],
  ["29.97", 30000, 1001],
  ["29.97df", 30000, 1001],
  ["30", 30, 1],
  ["47.952", 48000, 1001],
  ["48", 48, 1],
  ["50", 50, 1],
  ["59.94", 60000, 1001],
  ["59.94df", 60000, 1001],
  ["60", 60, 1],
  ["100", 100, 1],
  ["119.88", 120000, 1001],
  ["120", 120, 1],
];

export const FRAME_RATES: readonly FrameRate[] = RATES.map(([id, num, den]) => {
  const drop = id.endsWith("df");
  return { id, num, den, drop, label: drop ? `${id.replace("df", "")} drop` : id };
});

/** A session with no rate of its own counts 30 non-drop, as formwav's clock and grid did before rates were saved. */
export const DEFAULT_FRAME_RATE: FrameRateId = "30";

export function frameRate(id: string | null | undefined): FrameRate {
  const found = FRAME_RATES.find((r) => r.id === id) ?? FRAME_RATES.find((r) => r.id === DEFAULT_FRAME_RATE);
  return found as FrameRate;
}

/** The frames each labelled second counts (30 for 29.97, 24 for 23.976). */
export const nominal = (r: FrameRate) => Math.round(r.num / r.den);

/** floor(a / b) in exact integer arithmetic, however large the operands. */
function floorDiv(a: bigint, b: bigint): number {
  const q = a / b;
  return Number(a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q);
}

const big = (v: number) => BigInt(Math.round(v));

/** Half away from zero, as a rounding of a position should be whichever side of zero it lies. */
const roundHalfAway = (v: number) => (Number.isFinite(v) ? Math.sign(v) * Math.round(Math.abs(v)) : 0);

/** The whole frame a sample position falls in. */
export function framesAt(samples: number, r: FrameRate, sampleRate: number): number {
  return floorDiv(big(samples) * big(r.num), big(sampleRate) * big(r.den));
}

/** The sample position where frame `f` starts (the nearest sample to it). */
export function samplesAtFrame(f: number, r: FrameRate, sampleRate: number): number {
  return floorDiv(2n * big(f) * big(sampleRate) * big(r.den) + big(r.num), 2n * big(r.num));
}

export interface Timecode {
  negative: boolean;
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
}

/** The labels dropped at the start of each minute (but every tenth) for a drop-frame rate, else none. */
const droppedPerMinute = (r: FrameRate) => (r.drop ? (nominal(r) >= 60 ? 4 : 2) : 0);

export function timecodeFromFrames(frames: number, r: FrameRate): Timecode {
  const fps = Math.max(1, nominal(r));
  const dropped = droppedPerMinute(r);
  let label = Math.abs(frames);
  if (dropped) {
    const minute = fps * 60;
    const block = minute * 10 - dropped * 9;
    const blocks = Math.floor(label / block);
    const into = label % block;
    const laterMinutes = into < minute ? 0 : Math.floor((into - minute) / (minute - dropped)) + 1;
    label += dropped * (9 * blocks + laterMinutes);
  }
  const seconds = Math.floor(label / fps);
  return { negative: frames < 0, hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds / 60) % 60, seconds: seconds % 60, frames: label % fps };
}

export function timecodeToFrames(tc: Timecode, r: FrameRate): number {
  const fps = Math.max(1, nominal(r));
  const minutes = tc.hours * 60 + tc.minutes;
  const labelled = (minutes * 60 + tc.seconds) * fps + tc.frames;
  const count = labelled - droppedPerMinute(r) * (minutes - Math.floor(minutes / 10));
  return tc.negative ? -count : count;
}

const two = (n: number) => String(n).padStart(2, "0");

export function formatTimecode(tc: Timecode, r: FrameRate): string {
  const sign = tc.negative ? "-" : "";
  return `${sign}${two(tc.hours)}:${two(tc.minutes)}:${two(tc.seconds)}${r.drop ? ";" : ":"}${two(tc.frames)}`;
}

/** HH:MM:SS:FF, with ';' or '.' as separators too and fewer fields counted from the frames up; null otherwise. */
export function parseTimecode(text: string): Timecode | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const fields = (negative ? trimmed.slice(1) : trimmed).split(/[:;.]/).map((f) => f.trim());
  if (fields.length > 4 || !fields.every((f) => /^\+?\d+$/.test(f))) return null;
  const [frames = 0, seconds = 0, minutes = 0, hours = 0] = fields.map(Number).reverse();
  return { negative, hours, minutes, seconds, frames };
}

const FRAMES_PER_FOOT = 16;

/** Feet and frames for 35 mm film. */
export function feetFrames(samples: number, r: FrameRate, sampleRate: number): [number, number] {
  const f = framesAt(samples, r, sampleRate);
  const feet = Math.floor(f / FRAMES_PER_FOOT);
  return [feet, f - feet * FRAMES_PER_FOOT];
}

export type TimeFormat = "bars_beats" | "min_secs" | "timecode" | "feet_frames" | "samples";

export const TIME_FORMATS: readonly { id: TimeFormat; label: string }[] = [
  { id: "bars_beats", label: "Bars|Beats" },
  { id: "min_secs", label: "Min:Secs" },
  { id: "timecode", label: "Timecode" },
  { id: "feet_frames", label: "Feet+Frames" },
  { id: "samples", label: "Samples" },
];

/** What a position is read against: the sample rate, the tempo and meter, the frame rate and the timecode start. */
export interface TimeContext {
  sampleRate: number;
  bpm: number;
  beatsPerBar: number;
  rate: FrameRate;
  startSeconds: number;
  /** S11: the session's tempo and meter map, when it has more than one tempo or meter */
  map?: TempoMap;
}

export function timeContext(doc: SessionDoc, rate?: string | null): TimeContext {
  const tempo = doc.tempo ?? { bpm: 120, beatsPerBar: 4 };
  return { sampleRate: doc.sampleRate, bpm: tempo.bpm, beatsPerBar: tempo.beatsPerBar, rate: frameRate(rate ?? doc.frameRate), startSeconds: doc.timecodeStart ?? 0, ...(hasMap(doc) ? { map: tempoMap(doc) } : {}) };
}

/** The session's timecode start as a whole frame count at `r` (the start is itself a frame's label). */
const firstFrame = (ctx: TimeContext, r = ctx.rate) => Math.round((ctx.startSeconds * r.num) / r.den);

export const TICKS_PER_QUARTER = 960;

export interface BarBeat {
  bar: number;
  beat: number;
  tick: number;
}

const tickLength = (ctx: TimeContext) => (ctx.sampleRate * 60) / (ctx.bpm * TICKS_PER_QUARTER);
const barTicks = (ctx: TimeContext) => TICKS_PER_QUARTER * Math.max(1, ctx.beatsPerBar);
const ticksAt = (samples: number, ctx: TimeContext) => roundHalfAway(samples / tickLength(ctx));

/** Bar, beat and tick of a tick count, bars from 1 (a count before the first bar falls in bar 0 or earlier). */
export function barBeatAtTick(tick: number, ctx: TimeContext): BarBeat {
  const bar = Math.floor(tick / barTicks(ctx));
  const inBar = tick - bar * barTicks(ctx);
  const beat = Math.floor(inBar / TICKS_PER_QUARTER);
  return { bar: bar + 1, beat: beat + 1, tick: inBar - beat * TICKS_PER_QUARTER };
}

export function barBeatAt(samples: number, ctx: TimeContext): BarBeat {
  if (ctx.map) {
    const at = mapBarBeat(ctx.map, roundHalfAway(sampleToTick(ctx.map, samples)));
    return { bar: at.bar + 1, beat: at.beat + 1, tick: at.ticks };
  }
  return barBeatAtTick(ticksAt(samples, ctx), ctx);
}

export function samplesAtBarBeat(bb: BarBeat, ctx: TimeContext): number {
  if (ctx.map) return roundHalfAway(tickToSample(ctx.map, barStartTick(ctx.map, bb.bar - 1) + (Math.max(1, bb.beat) - 1) * ticksPerBeat(meterAtTick(ctx.map, barStartTick(ctx.map, bb.bar - 1)).den) + bb.tick));
  const ticks = (bb.bar - 1) * barTicks(ctx) + (Math.max(1, bb.beat) - 1) * TICKS_PER_QUARTER + bb.tick;
  return roundHalfAway(ticks * tickLength(ctx));
}

/** Minutes, seconds and milliseconds, the milliseconds cut rather than rounded so a reading never runs ahead. */
function minSecs(samples: number, sampleRate: number): string {
  const ms = floorDiv(big(Math.abs(samples)) * 1000n, big(sampleRate));
  const sign = samples < 0 ? "-" : "";
  return `${sign}${Math.floor(ms / 60000)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, "0")}`;
}

const barsText = (bar: number, beat: number, tick: number) => `${bar}| ${beat}| ${String(tick).padStart(3, "0")}`;

/** A position in a timebase (Min:Secs, minutes first); timecode counts from the session's start,
 *  `rate` overriding the session's (the second timecode ruler). */
export function formatPosition(samples: number, fmt: TimeFormat, ctx: TimeContext, rate = ctx.rate): string {
  if (fmt === "samples") return String(Math.round(samples));
  if (fmt === "min_secs") return minSecs(samples, ctx.sampleRate);
  if (fmt === "timecode") return formatTimecode(timecodeFromFrames(framesAt(samples, rate, ctx.sampleRate) + firstFrame(ctx, rate), rate), rate);
  if (fmt === "feet_frames") {
    const [feet, frames] = feetFrames(samples, rate, ctx.sampleRate);
    return `${feet}+${two(frames)}`;
  }
  const bb = barBeatAt(samples, ctx);
  return barsText(bb.bar, bb.beat, bb.tick);
}

/** A length from `start` (Bars|Beats lengths count from 0| 0| 000, timecode lengths from 00:00:00:00). */
export function formatLength(start: number, length: number, fmt: TimeFormat, ctx: TimeContext): string {
  if (fmt === "bars_beats" && ctx.map) {
    const from = roundHalfAway(sampleToTick(ctx.map, start));
    const ticks = Math.max(0, roundHalfAway(sampleToTick(ctx.map, start + length)) - from);
    const m = meterAtTick(ctx.map, from);
    const bars = Math.floor(ticks / ticksPerBar(m.num, m.den));
    const inBar = ticks - bars * ticksPerBar(m.num, m.den);
    const beats = Math.floor(inBar / ticksPerBeat(m.den));
    return barsText(bars, beats, inBar - beats * ticksPerBeat(m.den));
  }
  if (fmt === "bars_beats") {
    const ticks = Math.max(0, ticksAt(start + length, ctx) - ticksAt(start, ctx));
    const at = barBeatAtTick(ticks, ctx);
    return barsText(at.bar - 1, at.beat - 1, at.tick);
  }
  if (fmt === "timecode") return formatTimecode(timecodeFromFrames(framesAt(length, ctx.rate, ctx.sampleRate), ctx.rate), ctx.rate);
  return formatPosition(length, fmt, { ...ctx, startSeconds: 0 });
}

const wholeNumber = (s: string | undefined) => (s !== undefined && /^\s*\+?\d+\s*$/.test(s) ? Number(s.trim()) : null);

/** A position typed in a timebase, in samples; null when it does not read as one (Min:Secs takes hours too). */
export function parsePosition(text: string, fmt: TimeFormat, ctx: TimeContext): number | null {
  const t = text.trim();
  if (fmt === "samples") {
    const digits = t.replace(/[,_]/g, "");
    return /^-?\d+$/.test(digits) ? Number(digits) : null;
  }
  if (fmt === "min_secs") {
    const negative = t.startsWith("-");
    const fields = (negative ? t.slice(1) : t).split(":").map((f) => f.trim());
    if (fields.length > 3 || !fields.every((f) => /^(\d+(\.\d*)?|\.\d+)$/.test(f))) return null;
    const seconds = fields.reduce((sum, f) => sum * 60 + Number(f), 0);
    if (!Number.isFinite(seconds)) return null;
    const at = roundHalfAway(seconds * ctx.sampleRate);
    return negative ? -at : at;
  }
  if (fmt === "timecode") {
    const tc = parseTimecode(t);
    return tc ? samplesAtFrame(timecodeToFrames(tc, ctx.rate) - firstFrame(ctx), ctx.rate, ctx.sampleRate) : null;
  }
  if (fmt === "feet_frames") {
    const fields = t.split("+");
    const [feet, frames] = [wholeNumber(fields[0]), wholeNumber(fields[1])];
    return fields.length === 2 && feet !== null && frames !== null ? samplesAtFrame(feet * FRAMES_PER_FOOT + frames, ctx.rate, ctx.sampleRate) : null;
  }
  const fields = t.split(/[|. ]/).filter((f) => f !== "");
  if (!fields.length || fields.length > 3 || !fields.every((f) => /^-?\d+$/.test(f))) return null;
  const [bar, beat = 1, tick = 0] = fields.map(Number);
  return samplesAtBarBeat({ bar, beat: Math.max(1, beat), tick: Math.max(0, tick) }, ctx);
}
