import type { SessionDoc, Track } from "./document";

/** A note track's notes and controllers in session frames (each clip's own media frames mapped through its trim and
 *  its media's rate), cut to the part of each clip that plays. */
export function trackEvents(doc: SessionDoc, track: Track) {
  const notes: { at: number; length: number; pitch: number; velocity: number }[] = [];
  const controllers: { at: number; kind: "cc" | "bend" | "program" | "pressure"; number: number; value: number }[] = [];
  let channel: number | undefined;
  for (const c of track.clips) {
    if (!c.notes || c.mute) continue;
    const ratio = doc.sampleRate / (doc.media[c.mediaId]?.sampleRate ?? doc.sampleRate);
    const end = c.sourceIn + c.length / ratio;
    channel ??= c.midiChannel;
    for (const n of c.notes) {
      if (n.at >= end || n.at + n.length <= c.sourceIn) continue;
      const from = Math.max(n.at, c.sourceIn);
      const to = Math.min(n.at + n.length, end);
      notes.push({ at: c.start + (from - c.sourceIn) * ratio, length: (to - from) * ratio, pitch: n.pitch, velocity: n.velocity });
    }
    for (const e of c.controllers ?? []) if (e.at >= c.sourceIn && e.at < end) controllers.push({ ...e, at: c.start + (e.at - c.sourceIn) * ratio });
  }
  notes.sort((a, b) => a.at - b.at || a.pitch - b.pitch);
  controllers.sort((a, b) => a.at - b.at);
  return { notes, controllers, channel };
}

export function noteTracks(doc: SessionDoc): Track[] {
  return doc.tracks.filter((t) => t.clips.some((c) => c.notes?.length));
}

const vlq = (v: number) => {
  const out = [v & 0x7f];
  for (v >>= 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
};
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const text = (s: string) => [...new TextEncoder().encode(s)];

function chunk(events: [number, number, number[]][]): number[] {
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const body: number[] = [];
  let last = 0;
  for (const [tick, , bytes] of events) {
    body.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

/** S8: the whole session as a Standard MIDI File, format 1: a first track with the session's name, tempo, meter and
 *  markers, then one track per note track with its name, notes and controllers on its own channel (the file's channel
 *  where the clip came from one, the drums kept on 10). Note-offs sort before note-ons at a tick so repeats retrigger. */
export function sessionMidi(doc: SessionDoc, name = "formwav session", ppq = 480): Uint8Array<ArrayBuffer> {
  const bpm = doc.tempo?.bpm ?? 120;
  const beats = Math.min(255, Math.max(1, Math.round(doc.tempo?.beatsPerBar ?? 4)));
  const ticks = (frames: number) => Math.max(0, Math.round((frames / doc.sampleRate) * (bpm / 60) * ppq));
  const tempo = Math.round(60_000_000 / bpm);
  const name0 = text(name);
  const first: [number, number, number[]][] = [
    [0, 0, [0xff, 0x03, ...vlq(name0.length), ...name0]],
    [0, 1, [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff]],
    [0, 2, [0xff, 0x58, 0x04, beats, 2, 24, 8]],
  ];
  for (const m of doc.markers) {
    const label = text(m.label || "Marker");
    first.push([ticks(m.at), 3, [0xff, 0x06, ...vlq(label.length), ...label]]);
  }
  const chunks = [chunk(first)];
  const free = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  noteTracks(doc).forEach((t, i) => {
    const { notes, controllers, channel: kept } = trackEvents(doc, t);
    const ch = kept ?? free[i % free.length];
    const label = text(t.name);
    const events: [number, number, number[]][] = [[0, 0, [0xff, 0x03, ...vlq(label.length), ...label]]];
    for (const e of controllers) {
      const at = ticks(e.at);
      if (e.kind === "cc") events.push([at, 1, [0xb0 | ch, e.number & 0x7f, e.value & 0x7f]]);
      else if (e.kind === "program") events.push([at, 1, [0xc0 | ch, e.value & 0x7f]]);
      else if (e.kind === "pressure") events.push([at, 1, [0xd0 | ch, e.value & 0x7f]]);
      else {
        const v = Math.min(16383, Math.max(0, e.value + 8192));
        events.push([at, 1, [0xe0 | ch, v & 0x7f, (v >> 7) & 0x7f]]);
      }
    }
    for (const n of notes) {
      events.push([ticks(n.at), 3, [0x90 | ch, n.pitch & 0x7f, n.velocity & 0x7f]]);
      events.push([Math.max(ticks(n.at) + 1, ticks(n.at + n.length)), 2, [0x80 | ch, n.pitch & 0x7f, 64]]);
    }
    chunks.push(chunk(events));
  });
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0x00, 0x01, (chunks.length >> 8) & 0xff, chunks.length & 0xff, (ppq >> 8) & 0xff, ppq & 0xff];
  return new Uint8Array([...header, ...chunks.flat()]);
}
