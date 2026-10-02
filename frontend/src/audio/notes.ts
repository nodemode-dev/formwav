import type { Engine } from "../engine";
import type { MediaRef, NoteEvent } from "../engine/document";

/**
 * A note clip's edited notes rendered again by the built-in instrument (POST /api/midi/render) and swapped in together
 * with them (set-clip-notes, one undo step). Notes are frames of the clip's media; the engine takes seconds, at that
 * media's own rate.
 */
/**
 * A note clip's notes as a Standard MIDI File (AU-37's export): format 0, one track, 480 ticks per quarter note at
 * 120 BPM (formwav has no tempo map yet), the notes' frames converted to ticks at the media's rate; note-offs come
 * before note-ons at the same tick so a repeated pitch retriggers. Read back by the engine's own reader in tests.
 */
export function midiFile(notes: readonly NoteEvent[], rate: number, bpm = 120, ppq = 480): Uint8Array<ArrayBuffer> {
  const ticks = (frames: number) => Math.max(0, Math.round((frames / rate) * (bpm / 60) * ppq));
  const events: [number, number, number, number][] = [];
  for (const n of notes) {
    events.push([ticks(n.at), 0x90, n.pitch, n.velocity]);
    events.push([ticks(n.at + n.length), 0x80, n.pitch, 64]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const vlq = (v: number) => {
    const out = [v & 0x7f];
    for (v >>= 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const tempo = Math.round(60_000_000 / bpm);
  const body: number[] = [0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff];
  let last = 0;
  for (const [tick, status, pitch, velocity] of events) {
    body.push(...vlq(tick - last), status, pitch & 0x7f, velocity & 0x7f);
    last = tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0x00, 0x00, 0x00, 0x01, (ppq >> 8) & 0xff, ppq & 0xff];
  return new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]);
}

export async function renderNotes(engine: Engine, trackId: string, clipId: string, notes: readonly NoteEvent[]): Promise<void> {
  const doc = engine.get("document");
  const clip = doc.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("no such clip");
  const media = doc.media[clip.mediaId];
  const rate = media?.sampleRate ?? doc.sampleRate;
  const body = {
    notes: notes.map((n) => ({ start: n.at / rate, length: n.length / rate, pitch: n.pitch, velocity: n.velocity })),
    rate,
    name: (media?.name ?? "notes").replace(/\.wav$/i, ""),
  };
  const res = await fetch("/api/midi/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Partial<MediaRef> & { detail?: unknown };
  if (!res.ok || !out.id) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
  engine.dispatch({ type: "set-clip-notes", trackId, clipId, notes, media: out as MediaRef });
}
