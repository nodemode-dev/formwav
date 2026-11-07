import { RATE, SPB } from "./model";

declare global {
  interface Window { __FW_MEDIA?: Record<string, string> }
}

export type Group = "stems" | "loops" | "shots" | "score" | "patterns" | "yours";

export interface Item {
  id: string;
  name: string;
  sub: string;
  group: Group;
  buffer: AudioBuffer | null;
  beats: number;
  env: Float32Array | null;
}

export const ENV_BLOCK = 512;

interface Def { id: string; name: string; sub: string; group: Group }

const STEM = "CC0 stem, 8 bars at 130 BPM";

export const DEFS: Def[] = [
  { id: "drums-a", name: "Drums A", sub: STEM, group: "stems" },
  { id: "drums-b", name: "Drums B", sub: STEM, group: "stems" },
  { id: "drums-c", name: "Drums C", sub: STEM, group: "stems" },
  { id: "bass-b", name: "Bass B", sub: STEM, group: "stems" },
  { id: "bass-c", name: "Bass C", sub: STEM, group: "stems" },
  { id: "keys-a", name: "Keys A", sub: `${STEM}, soft`, group: "stems" },
  { id: "keys-brk", name: "Keys break", sub: `${STEM}, alone`, group: "stems" },
  { id: "keys-b", name: "Keys B", sub: STEM, group: "stems" },
  { id: "keys-c", name: "Keys C", sub: `${STEM}, full`, group: "stems" },
  { id: "loop-kit-a", name: "Kit loop A", sub: "CC0 loop, 1 bar", group: "loops" },
  { id: "loop-kit-b", name: "Kit loop B", sub: "CC0 loop, 1 bar", group: "loops" },
  { id: "loop-low", name: "Low kit loop", sub: "CC0 loop, 1 bar", group: "loops" },
  { id: "shot-kick", name: "Kick", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-subkick", name: "Sub kick", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-snare", name: "Snare", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-clap", name: "Noise snare", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-rim", name: "Rim", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-hat", name: "Closed hat", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-openhat", name: "Open hat", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "shot-tom", name: "Tom", sub: "CC0 one-shot, sliced", group: "shots" },
  { id: "piano", name: "Piano, Gymnopedie 1", sub: "Satie, public domain, 16 bars", group: "score" },
  { id: "saturn", name: "Saturn plasma waves", sub: "NASA Cassini, public domain", group: "score" },
  { id: "launch-roar", name: "Launch roar", sub: "NASA shuttle, public domain", group: "score" },
];

export const items = new Map<string, Item>();
let ctxDecode: OfflineAudioContext | null = null;

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

export function envelope(buf: AudioBuffer): Float32Array {
  const n = Math.ceil(buf.length / ENV_BLOCK);
  const env = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let b = 0; b < n; b++) {
      let m = env[b];
      const e = Math.min(d.length, (b + 1) * ENV_BLOCK);
      for (let i = b * ENV_BLOCK; i < e; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
      env[b] = m;
    }
  }
  return env;
}

export function beatsOf(buf: AudioBuffer): number {
  const b = buf.duration / SPB;
  const r = Math.round(b);
  return Math.abs(b - r) < 0.03 ? r : b;
}

export function register(it: Omit<Item, "env" | "beats"> & { buffer: AudioBuffer }): Item {
  const full: Item = { ...it, beats: beatsOf(it.buffer), env: envelope(it.buffer) };
  items.set(full.id, full);
  return full;
}

export async function decodeBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  if (!ctxDecode) ctxDecode = new OfflineAudioContext(2, RATE, RATE);
  return ctxDecode.decodeAudioData(bytes);
}

async function decodeDef(d: Def): Promise<AudioBuffer> {
  const b64 = await loadPack(d.id);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (window.__FW_MEDIA) delete window.__FW_MEDIA[d.id];
  return decodeBytes(bytes.buffer);
}

export async function loadAll(onProgress: (done: number, total: number) => void): Promise<void> {
  let done = 0;
  onProgress(0, DEFS.length);
  const buffers = await Promise.all(DEFS.map(async (d) => {
    const b = await decodeDef(d);
    done++;
    onProgress(done, DEFS.length);
    return b;
  }));
  DEFS.forEach((d, i) => register({ ...d, buffer: buffers[i] }));
}

export function buf(id: string): AudioBuffer {
  const it = items.get(id);
  if (!it?.buffer) throw new Error(`${id} is not loaded`);
  return it.buffer;
}
