import { fromDb, type Chans } from "./dsp";
import type { Store } from "./state";

export function mixdown(store: Store, from = 0, to = -1): Chans {
  const anySolo = store.tracks.some((t) => t.solo);
  const total = Math.round(store.duration() * store.rate);
  const e = to < 0 ? total : Math.min(total, to);
  const n = Math.max(1, e - from);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const t of store.tracks) {
    if (anySolo ? !t.solo : t.mute) continue;
    const g = fromDb(t.gain);
    const a = t.chans[0], b = t.chans[1] ?? t.chans[0];
    const end = Math.min(e, a.length);
    for (let i = from; i < end; i++) { L[i - from] += a[i] * g; R[i - from] += b[i] * g; }
  }
  return [L, R];
}
