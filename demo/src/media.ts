import type { Chans } from "./dsp";

declare global {
  interface Window { __FW_MEDIA?: Record<string, string> }
}

export interface Clip {
  id: string;
  name: string;
  offset: number;
  gain: number;
  mute: boolean;
  spec: boolean;
  credit: string;
}

export const SESSION_CLIPS: Clip[] = [
  { id: "launch-radio", name: "Launch radio", offset: 0, gain: 0, mute: false, spec: true, credit: "NASA, shuttle launch commentary" },
  { id: "narration", name: "Narration", offset: 16.4, gain: 0, mute: false, spec: false, credit: "Round the Moon, LibriVox, public domain" },
  { id: "narration-take2", name: "Narration take 2 (hum)", offset: 16.4, gain: 0, mute: true, spec: false, credit: "Round the Moon, LibriVox, 60 Hz hum" },
  { id: "piano", name: "Piano", offset: 0, gain: -3, mute: false, spec: false, credit: "Satie, Gymnopedie 1, Musopen, public domain" },
  { id: "saturn", name: "Saturn radio waves", offset: 18, gain: -3, mute: false, spec: false, credit: "NASA, Cassini plasma waves as sound" },
];

export const EXTRA_CLIPS: Clip[] = [
  { id: "launch-roar", name: "Launch roar", offset: 0, gain: 0, mute: false, spec: false, credit: "NASA, shuttle launch ambience" },
];

export const ALL_CLIPS: Clip[] = [...SESSION_CLIPS, ...EXTRA_CLIPS];

export const CLIP_BY_ID: Record<string, Clip> = Object.fromEntries(ALL_CLIPS.map((c) => [c.id, c]));

const decoded = new Map<string, Chans>();

function loadPack(id: string): Promise<string> {
  const have = window.__FW_MEDIA?.[id];
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.async = true;
    s.src = `assets/media/${id}.js`;
    s.onload = () => {
      s.remove();
      const v = window.__FW_MEDIA?.[id];
      if (v) resolve(v); else reject(new Error(`${id} pack is empty`));
    };
    s.onerror = () => { s.remove(); reject(new Error(`${id} pack did not load`)); };
    document.head.append(s);
  });
}

export async function decodeClip(clip: Clip, rate: number): Promise<Chans> {
  const key = `${clip.id}:${clip.offset}`;
  const hit = decoded.get(key);
  if (hit) return hit;
  const b64 = await loadPack(clip.id);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (window.__FW_MEDIA) delete window.__FW_MEDIA[clip.id];
  const ctx = new OfflineAudioContext(2, rate, rate);
  const buf = await ctx.decodeAudioData(bytes.buffer);
  const lead = Math.round(clip.offset * rate);
  const chans: Chans = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
    const out = new Float32Array(lead + buf.length);
    out.set(buf.getChannelData(c), lead);
    chans.push(out);
  }
  decoded.set(key, chans);
  return chans;
}
