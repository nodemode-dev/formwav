
import type { SpatialFormat } from "../engine/document";

/** S16: the session's layouts by the core's ids (crate::layout); absent is 5.1. */
export const LAYOUT_IDS: Record<SpatialFormat, number> = { "5.1": 0, foa: 1, stereo: 2, lcr: 3, quad: 4, "5.0": 5, "6.1": 6, "7.1": 7, "5.1.2": 8, "5.1.4": 9, "7.1.2": 10, "7.1.4": 11, "9.1.6": 12 };
export const LAYOUTS: readonly SpatialFormat[] = ["stereo", "lcr", "quad", "5.0", "5.1", "6.1", "7.1", "5.1.2", "5.1.4", "7.1.2", "7.1.4", "9.1.6", "foa"];

export interface SurroundPlace {
  x: number;
  y: number;
  lfeDb?: number;
  el?: number;
  div?: number;
  centre?: number;
}

/** A track's place as the core's record of six: x, y, divergence, centre percent, elevation, LFE send in dB (-120 for
 *  none); the core computes each speaker's gain for the session's layout, so playback and export share one law. */
export function placeRecord(s: SurroundPlace): number[] {
  const clamp = (v: number | undefined, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return [clamp(s.x, 0, -1, 1), clamp(s.y, 1, -1, 1), clamp(s.div, 0, 0, 1), clamp(s.centre, 100, 0, 100), clamp(s.el, 0, -90, 90), s.lfeDb !== undefined && s.lfeDb > -80 ? s.lfeDb : -120];
}

export interface LayoutChannel {
  name: string;
  az: number;
  el: number;
  fold: [number, number];
}
export interface LayoutRow {
  id: number;
  name: string;
  mask: number;
  channels: LayoutChannel[];
}

const FALLBACK: LayoutRow[] = [
  { id: 0, name: "5.1", mask: 0x60f, channels: [["L", -30], ["R", 30], ["C", 0], ["LFE", 0], ["Ls", -110], ["Rs", 110]].map(([name, az]) => ({ name: name as string, az: az as number, el: 0, fold: [0, 0] })) },
];
let table: Promise<LayoutRow[]> | null = null;

/** The core's layout table from the engine, fetched once; the 5.1 row alone if the engine cannot be reached. */
export function layoutTable(): Promise<LayoutRow[]> {
  table ??= fetch("/api/surround/layouts")
    .then((r) => (r.ok ? (r.json() as Promise<LayoutRow[]>) : FALLBACK))
    .catch(() => FALLBACK);
  return table;
}

