import type { Chans } from "./dsp";

export type WavBits = 16 | 24 | 32;

export function encodeWav(chans: Chans, rate: number, bits: WavBits): Blob {
  const ch = chans.length, n = chans[0].length;
  const bytes = bits / 8;
  const dataLen = n * ch * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, chans[c][i]));
      if (bits === 32) v.setFloat32(o, chans[c][i], true);
      else if (bits === 16) v.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      else {
        const q = Math.round(x < 0 ? x * 8388608 : x * 8388607);
        v.setUint8(o, q & 255);
        v.setUint8(o + 1, (q >> 8) & 255);
        v.setUint8(o + 2, (q >> 16) & 255);
      }
      o += bytes;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

export async function decodeFile(file: File, rate: number): Promise<Chans> {
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, rate, rate);
  const buf = await ctx.decodeAudioData(data);
  const out: Chans = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) out.push(Float32Array.from(buf.getChannelData(c)));
  return out;
}
