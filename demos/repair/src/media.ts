declare global {
  interface Window { __FW_MEDIA?: Record<string, string> }
}

export interface SourceDef {
  id: string;
  name: string;
  sub: string;
  tags: string[];
  pack: string;
  key: string;
}

export const SOURCES: SourceDef[] = [
  { id: "onestep", name: "Dixie Jass Band One-Step, 1917", sub: "A 78 rpm jazz record: crackle, pops and a narrow band", tags: ["Clicks", "Hiss", "Quiet"], pack: "assets/media/onestep.js", key: "onestep" },
  { id: "shellac", name: "Vesti la giubba, 1907", sub: "Caruso on shellac: surface noise and a dull top end", tags: ["Hiss", "Dynamics", "Quiet"], pack: "assets/media/shellac.js", key: "shellac" },
  { id: "hum", name: "A reading with mains hum", sub: "LibriVox, Round the Moon: 60 Hz hum and its harmonics", tags: ["Hum", "Room noise"], pack: "../../demo/assets/media/narration-take2.js", key: "narration-take2" },
  { id: "radio", name: "Launch commentary, STS-135", sub: "NASA radio over the roar of a launch", tags: ["Roar", "Radio noise"], pack: "../../demo/assets/media/launch-radio.js", key: "launch-radio" },
];

const cache = new Map<string, Float32Array>();

function loadPack(def: SourceDef): Promise<string> {
  const key = def.key;
  const have = window.__FW_MEDIA?.[key];
  if (have) return Promise.resolve(have);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.async = true;
    s.src = def.pack;
    s.onload = () => {
      s.remove();
      const v = window.__FW_MEDIA?.[key];
      if (v) resolve(v); else reject(new Error(`${def.id} pack is empty`));
    };
    s.onerror = () => { s.remove(); reject(new Error(`${def.id} pack did not load`)); };
    document.head.append(s);
  });
}

export function monoFrom(chans: Float32Array[]): Float32Array {
  if (chans.length === 1) return Float32Array.from(chans[0]);
  const out = new Float32Array(chans[0].length);
  for (const c of chans) for (let i = 0; i < out.length; i++) out[i] += c[i] / chans.length;
  return out;
}

export async function decodeBytes(bytes: ArrayBuffer, rate: number, maxSeconds: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, rate, rate);
  const buf = await ctx.decodeAudioData(bytes);
  const chans: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
  const mono = monoFrom(chans);
  return mono.length > maxSeconds * rate ? mono.slice(0, Math.round(maxSeconds * rate)) : mono;
}

export async function decodeSource(def: SourceDef, rate: number): Promise<Float32Array> {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const b64 = await loadPack(def);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (window.__FW_MEDIA) delete window.__FW_MEDIA[def.key];
  const x = await decodeBytes(bytes.buffer, rate, 120);
  cache.set(def.id, x);
  return x;
}
