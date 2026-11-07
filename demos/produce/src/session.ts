import { items, register } from "./lib";
import { KINDS } from "./kinds";
import { type Doc, emptyDoc, type Fx, type Pt, Store } from "./model";
import { initialPatterns, renderPattern } from "./pattern";

export function patternItem(p: { id: string; name: string }, b: AudioBuffer): void {
  register({ id: p.id, name: p.name, sub: "Pattern from the sequencer", group: "patterns", buffer: b });
}

export function buildSession(): Doc {
  const doc = emptyDoc();
  const st = new Store();
  st.doc = doc;
  doc.patterns = initialPatterns();
  for (const p of doc.patterns) patternItem(p, renderPattern(p));

  const fx = (kind: string, v: Record<string, number> = {}): Fx => ({ id: st.nextId(), kind, bypass: false, v: { ...KINDS[kind].init, ...v } });
  const clip = (item: string, start: number, length: number, offset = 0, gainDb = 0) => ({ id: st.nextId(), item, start, offset, length: Math.min(length, (items.get(item)?.beats ?? length) - offset), gainDb });
  const lane = (...p: Array<[number, number]>): Pt[] => p.map(([beat, value]) => ({ beat, value }));

  const score = st.newTrack("Score");
  const tex = st.newTrack("Texture");
  const keys = st.newTrack("Keys");
  const drums = st.newTrack("Drums");
  const bass = st.newTrack("Bass");
  const pat = st.newTrack("Pattern");
  const perc = st.newTrack("Perc");

  score.vol = -3;
  score.clips.push(clip("piano", 0, 20));
  const verb = fx("reverb", { room: 0.8, damping: 0.55, mix: 0.4 });
  score.fx.push(verb);
  score.auto.vol = lane([0, -4], [12, -4], [18, -40], [20, -60]);

  tex.vol = -9;
  tex.clips.push(clip("saturn", 0, 28), clip("launch-roar", 24, 8, 0, -3), clip("launch-roar", 88, 8, 0, -3));
  const lp = fx("lowpass", { freq: 900 });
  tex.fx.push(fx("reverb", { room: 0.7, damping: 0.4, mix: 0.35 }), lp);
  tex.auto[`${lp.id}:freq`] = lane([0, 900], [16, 5000], [24, 900], [32, 16000], [33, 1500], [88, 900], [96, 16000], [97, 1800]);

  keys.vol = -4;
  keys.clips.push(clip("keys-a", 16, 16, 16, -2), clip("keys-b", 32, 32), clip("keys-brk", 64, 32), clip("keys-c", 96, 32));
  keys.fx.push(fx("highpass", { freq: 140 }), fx("chorus", { mix: 0.3 }));

  drums.vol = 0;
  drums.clips.push(clip("drums-a", 16, 16, 16), clip("drums-b", 32, 32), clip("drums-c", 96, 32));
  const dlp = fx("lowpass", { freq: 16000 });
  drums.fx.push(dlp, fx("compressor", { thresholdDb: -18, ratio: 3, makeupDb: 2 }));
  drums.auto[`${dlp.id}:freq`] = lane([0, 16000], [16, 500], [32, 16000]);

  bass.vol = -2;
  bass.clips.push(clip("bass-b", 32, 32), clip("bass-c", 96, 32));
  bass.fx.push(fx("compressor", { thresholdDb: -20, ratio: 4, makeupDb: 2 }));

  pat.vol = -6;
  pat.clips.push(clip("pat-groove-a", 32, 8), clip("pat-groove-a", 40, 8), clip("pat-groove-a", 48, 8), clip("pat-groove-a", 56, 4), clip("pat-fill-b", 60, 4));
  pat.clips.push(clip("pat-groove-a", 96, 8), clip("pat-groove-a", 104, 8), clip("pat-groove-a", 112, 8), clip("pat-groove-a", 120, 4), clip("pat-fill-b", 124, 4));
  pat.fx.push(fx("echo", { delayMs: 346, feedback: 0.3, mix: 0.2 }), fx("reverb", { room: 0.3, damping: 0.6, mix: 0.12 }));

  perc.vol = -10;
  perc.clips.push(clip("loop-kit-a", 48, 4), clip("loop-kit-a", 52, 4), clip("loop-kit-a", 56, 4), clip("loop-kit-a", 60, 4));
  perc.clips.push(clip("loop-kit-b", 112, 4), clip("loop-kit-b", 116, 4), clip("loop-kit-b", 120, 4), clip("loop-kit-b", 124, 4));
  perc.fx.push(fx("highpass", { freq: 400 }));
  perc.auto.pan = lane([48, -0.4], [64, 0.4], [112, 0.4], [128, -0.4]);

  const mk = (beat: number, name: string, color: string, comment = "") => doc.markers.push({ id: st.nextId(), beat, name, color, comment });
  mk(0, "Cold open", "cyan", "Piano and Saturn plasma waves");
  mk(16, "Build", "violet", "Keys and drums enter, filter opens");
  mk(32, "Drop A", "amber", "Stems and sequenced groove");
  mk(64, "Break", "slate", "Keys stem alone");
  mk(88, "Riser", "pink", "Launch roar, filter sweep");
  mk(96, "Drop B", "amber", "Full stems, loops in the last bars");
  mk(124, "Outro", "green");
  doc.region = [96, 128];
  doc.master.gainDb = -6;
  return doc;
}
