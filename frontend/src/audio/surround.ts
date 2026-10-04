/**
 * PT-38, AA-11: the 5.1 placement maths, line for line the engine's (backend app/services/surround.py), so playback
 * and exports agree: pairwise constant-power panning among the five full-range speakers at ITU-R BS.775's angles, a
 * position nearer the middle spreading over all five with its power kept, and the ITU stereo fold-down expressed as
 * the core's clip gain and pan.
 */

const SPEAKERS: [string, number][] = [
  ["Ls", -110],
  ["L", -30],
  ["C", 0],
  ["R", 30],
  ["Rs", 110],
];
const FOLD = Math.SQRT1_2;

/** The five speakers' gains for a source at (x, y): x from -1 (left) to 1 (right), y from -1 (behind) to 1 (in front). */
export function surroundGains(x: number, y: number): Record<string, number> {
  const r = Math.min(1, Math.hypot(x, y));
  const angle = r > 1e-9 ? (Math.atan2(x, y) * 180) / Math.PI : 0;
  const ring: [string, number][] = [...SPEAKERS, ["Ls", 250]];
  const a = angle >= -110 ? angle : angle + 360;
  const point: Record<string, number> = Object.fromEntries(SPEAKERS.map(([name]) => [name, 0]));
  for (let i = 0; i + 1 < ring.length; i++) {
    const [n1, a1] = ring[i];
    const [n2, a2] = ring[i + 1];
    if (a1 <= a && a <= a2) {
      const p = (a - a1) / (a2 - a1);
      point[n1] += Math.cos((p * Math.PI) / 2);
      point[n2] += Math.sin((p * Math.PI) / 2);
      break;
    }
  }
  const even = 1 / Math.sqrt(SPEAKERS.length);
  const spread = Object.fromEntries(Object.entries(point).map(([k, v]) => [k, r * v + (1 - r) * even]));
  const norm = Math.sqrt(Object.values(spread).reduce((s, v) => s + v * v, 0)) || 1;
  return Object.fromEntries(Object.entries(spread).map(([k, v]) => [k, v / norm]));
}

/** The position's ITU stereo fold-down as the core's clip gain (dB) and pan under its balance law (the near side at
 *  1, the far side turned down by cos(pan * pi / 2)): exact for a mono source. */
export function foldDown(x: number, y: number): { gainDb: number; pan: number } {
  const g = surroundGains(x, y);
  const lo = g.L + FOLD * g.C + FOLD * g.Ls;
  const ro = g.R + FOLD * g.C + FOLD * g.Rs;
  const near = Math.max(lo, ro);
  const far = Math.min(lo, ro);
  if (near <= 1e-12) return { gainDb: -120, pan: 0 };
  const pan = (2 / Math.PI) * Math.acos(Math.max(0, Math.min(1, far / near)));
  return { gainDb: 20 * Math.log10(near), pan: lo >= ro ? -pan : pan };
}
