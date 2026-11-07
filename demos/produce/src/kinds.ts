export type Param = [key: string, label: string, min: number, max: number, unit: string, log?: boolean];

export interface Kind {
  label: string;
  sub: string;
  params: Param[];
  init: Record<string, number>;
}

const FREQ: Param = ["freq", "Frequency", 20, 20000, "Hz", true];
const MIX: Param = ["mix", "Mix", 0, 1, ""];

export const KINDS: Record<string, Kind> = {
  highpass: { label: "High-pass", sub: "Cuts below", params: [FREQ, ["q", "Q", 0.1, 18, ""]], init: { freq: 100, gainDb: 0, q: 0.707 } },
  lowpass: { label: "Low-pass", sub: "Cuts above", params: [FREQ, ["q", "Q", 0.1, 18, ""]], init: { freq: 8000, gainDb: 0, q: 0.707 } },
  peak: { label: "Peak EQ", sub: "Boosts or cuts a band", params: [FREQ, ["gainDb", "Gain", -24, 24, "dB"], ["q", "Q", 0.1, 18, ""]], init: { freq: 1000, gainDb: 0, q: 1 } },
  lowshelf: { label: "Low shelf", sub: "Lows up or down", params: [FREQ, ["gainDb", "Gain", -24, 24, "dB"]], init: { freq: 200, gainDb: 0, q: 0.707 } },
  highshelf: { label: "High shelf", sub: "Highs up or down", params: [FREQ, ["gainDb", "Gain", -24, 24, "dB"]], init: { freq: 6000, gainDb: 0, q: 0.707 } },
  compressor: { label: "Compressor", sub: "Evens the level", params: [["thresholdDb", "Threshold", -60, 0, "dB"], ["ratio", "Ratio", 1, 20, ":1"], ["makeupDb", "Makeup", 0, 24, "dB"]], init: { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 150, makeupDb: 0 } },
  limiter: { label: "Limiter", sub: "A ceiling for peaks", params: [["ceilingDb", "Ceiling", -30, 0, "dB"], ["releaseMs", "Release", 1, 1000, "ms"]], init: { ceilingDb: -1, releaseMs: 80 } },
  reverb: { label: "Reverb", sub: "A room around it", params: [["room", "Room", 0, 1, ""], ["damping", "Damping", 0, 1, ""], MIX], init: { room: 0.5, damping: 0.5, mix: 0.25 } },
  echo: { label: "Echo", sub: "Repeats that fade", params: [["delayMs", "Delay", 20, 1500, "ms"], ["feedback", "Feedback", 0, 0.95, ""], MIX], init: { delayMs: 300, feedback: 0.35, mix: 0.4 } },
  chorus: { label: "Chorus", sub: "Thickens it", params: [["rateHz", "Rate", 0.05, 5, "Hz"], ["depthMs", "Depth", 0, 10, "ms"], MIX], init: { rateHz: 0.8, depthMs: 3, mix: 0.5 } },
  flanger: { label: "Flanger", sub: "A jet-like sweep", params: [["rateHz", "Rate", 0.05, 5, "Hz"], ["depthMs", "Depth", 0, 5, "ms"], MIX], init: { rateHz: 0.25, depthMs: 3, mix: 0.5 } },
  phaser: { label: "Phaser", sub: "A sweeping notch", params: [["rateHz", "Rate", 0.05, 10, "Hz"], ["depth", "Depth", 0, 1, ""], MIX], init: { rateHz: 0.5, depth: 1, mix: 0.5 } },
  tremolo: { label: "Tremolo", sub: "A pulsing level", params: [["rateHz", "Rate", 0.05, 20, "Hz"], ["depth", "Depth", 0, 1, ""]], init: { rateHz: 4, depth: 0.5 } },
};

export const KIND_GROUPS: Array<[string, string[]]> = [
  ["EQ and filters", ["highpass", "lowpass", "peak", "lowshelf", "highshelf"]],
  ["Dynamics", ["compressor", "limiter"]],
  ["Space and movement", ["reverb", "echo", "chorus", "flanger", "phaser", "tremolo"]],
];

export const toT = (v: number, p: Param): number => (p[5] ? Math.log(v / p[2]) / Math.log(p[3] / p[2]) : (v - p[2]) / (p[3] - p[2]));

export const fromT = (t: number, p: Param): number => {
  const c = Math.min(1, Math.max(0, t));
  return p[5] ? p[2] * Math.pow(p[3] / p[2], c) : p[2] + c * (p[3] - p[2]);
};

export function fmt(v: number, unit: string): string {
  if (unit === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${v < 10 ? v.toFixed(2) : Math.round(v)} Hz`;
  if (unit === "dB") return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  if (unit === ":1") return `${v.toFixed(1)}:1`;
  if (unit === "ms") return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
  return v.toFixed(2);
}

export const shown = (v: number, p: Param): string => fmt(v, p[4]);

export function arc(t: number): string {
  const pt = (deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(24 + 17 * Math.sin(a)).toFixed(2)} ${(24 - 17 * Math.cos(a)).toFixed(2)}`;
  };
  const span = 270 * Math.min(1, Math.max(0.002, t));
  return `M ${pt(-135)} A 17 17 0 ${span > 180 ? 1 : 0} 1 ${pt(-135 + span)}`;
}

export const TRACK_ARC = arc(1);
