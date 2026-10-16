import { laneAt, laneValue, type AutoPoint, type Command, type Track } from "./document";

/** S9: points a lane can do without, each within `tolerance` of the line its neighbours draw (Ramer, Douglas and
 *  Peucker, measured in the lane's value); the first and last kept. */
export function thinLane(points: readonly AutoPoint[], tolerance: number): AutoPoint[] {
  if (points.length < 3) return [...points];
  const keep = new Set<number>([0, points.length - 1]);
  const walk = (a: number, b: number) => {
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const pa = points[a];
      const pb = points[b];
      const line = pb.time === pa.time ? pa.value : pa.value + ((pb.value - pa.value) * (points[i].time - pa.time)) / (pb.time - pa.time);
      const off = Math.abs(points[i].value - line);
      if (off > worst) {
        worst = off;
        index = i;
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep.add(index);
      walk(a, index);
      walk(index, b);
    }
  };
  walk(0, points.length - 1);
  return points.filter((_, i) => keep.has(i));
}

/** Pro Tools' Glide: a straight line across the range from the lane's value at its start to its value at its end. */
export function glideLane(points: readonly AutoPoint[], start: number, end: number, fallback: number): AutoPoint[] {
  const a = laneAt(points, start, fallback);
  const b = laneAt(points, end, fallback);
  return [...points.filter((p) => p.time < start || p.time > end), { time: start, value: a }, { time: end, value: b }].sort((x, y) => x.time - y.time);
}

/** Write a value across the range (Pro Tools' Write to selection), the lane outside it as it was. */
export function writeLane(points: readonly AutoPoint[], start: number, end: number, value: number, fallback: number): AutoPoint[] {
  const outside = points.filter((p) => p.time < start || p.time > end);
  const edges = [
    ...(start > 0 ? [{ time: start - 1, value: laneAt(points, start - 1, fallback) }] : []),
    { time: start, value },
    { time: end, value },
    { time: end + 1, value: laneAt(points, end + 1, fallback) },
  ];
  return [...outside.filter((p) => p.time !== start - 1 && p.time !== end + 1), ...edges].sort((x, y) => x.time - y.time);
}

const clipDb = (env: readonly { at: number; db: number }[] | undefined, at: number) => {
  if (!env?.length) return 0;
  if (at <= env[0].at) return env[0].db;
  for (let i = 1; i < env.length; i++) if (at <= env[i].at) return env[i - 1].db + ((env[i].db - env[i - 1].db) * (at - env[i - 1].at)) / Math.max(1, env[i].at - env[i - 1].at);
  return env[env.length - 1].db;
};

/** Pro Tools' Coalesce Volume Automation to Clip Gain: the track's volume (its lane, or its fader) written into each
 *  clip's gain line at the lane's points and the clip's edges, then the lane cleared and the fader at 0 dB. */
export function volumeToClipGain(track: Track): Command[] {
  const lane = track.automation?.volume ?? [];
  const commands: Command[] = [];
  for (const c of track.clips) {
    const end = c.start + c.length;
    const times = [...new Set([c.start, end, ...lane.filter((p) => p.time > c.start && p.time < end).map((p) => p.time), ...(c.envelope ?? []).map((p) => c.start + p.at - c.sourceIn)])].filter((t) => t >= c.start && t <= end).sort((a, b) => a - b);
    const points = times.map((t) => ({ at: t - c.start + c.sourceIn, db: Math.round((clipDb(c.envelope, t - c.start + c.sourceIn) + (lane.length ? laneValue(lane, t, true) : track.gainDb)) * 100) / 100 }));
    if (!lane.length && !c.envelope?.length) commands.push({ type: "set-clip-gain", trackId: track.id, clipId: c.id, gainDb: Math.round((c.gainDb + track.gainDb) * 100) / 100 });
    else commands.push({ type: "set-clip-envelope", trackId: track.id, clipId: c.id, points });
  }
  if (lane.length) commands.push({ type: "set-automation", trackId: track.id, param: "volume", points: [] });
  if (track.gainDb !== 0) commands.push({ type: "set-track-gain", trackId: track.id, gainDb: 0 });
  return commands;
}

/** Pro Tools' Coalesce Clip Gain to Volume Automation: each clip's gain and gain line written into the track's volume
 *  lane over the clip (with the fader), then the clips at 0 dB with no line. */
export function clipGainToVolume(track: Track): Command[] {
  const fader = (t: number) => (track.automation?.volume?.length ? laneValue(track.automation.volume, t, true) : track.gainDb);
  const points: AutoPoint[] = [];
  const commands: Command[] = [];
  for (const c of track.clips) {
    const end = c.start + c.length;
    const times = [...new Set([c.start, end, ...(c.envelope ?? []).map((p) => c.start + p.at - c.sourceIn)])].filter((t) => t >= c.start && t <= end).sort((a, b) => a - b);
    for (const t of times) points.push({ time: t, value: Math.round((fader(t) + c.gainDb + clipDb(c.envelope, t - c.start + c.sourceIn)) * 100) / 100 });
    if (c.envelope?.length) commands.push({ type: "set-clip-envelope", trackId: track.id, clipId: c.id, points: [] });
    if (c.gainDb !== 0) commands.push({ type: "set-clip-gain", trackId: track.id, clipId: c.id, gainDb: 0 });
  }
  if (!points.length) return [];
  return [...commands, { type: "set-automation", trackId: track.id, param: "volume", points }];
}
