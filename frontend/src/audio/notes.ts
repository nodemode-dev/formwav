import type { Engine } from "../engine";
import { cleanSynth, DEFAULT_SYNTH, type Instrument, type MediaRef, type MidiFx, type NoteEvent, type SynthPatch } from "../engine/document";
import { instrumentValues, isInstrumentKind } from "../engine/instruments";

/**
 * A note clip's edited notes rendered again by the built-in instrument (POST /api/midi/render) and swapped in together
 * with them (set-clip-notes, one undo step). Notes are frames of the clip's media; the engine takes seconds, at that
 * media's own rate.
 */
/**
 * A note clip's notes as a Standard MIDI File (AU-37's export): format 0, one track, 480 ticks per quarter note at the
 * session's tempo and meter (S7: its FF 51 tempo and FF 58 time signature, quarters as the beat), the notes' frames
 * converted to ticks at the media's rate; note-offs come before note-ons at the same tick so a repeated pitch
 * retriggers. Read back by the engine's own reader in tests.
 */
export function midiFile(notes: readonly NoteEvent[], rate: number, bpm = 120, ppq = 480, beatsPerBar = 4): Uint8Array<ArrayBuffer> {
  const ticks = (frames: number) => Math.max(0, Math.round((frames / rate) * (bpm / 60) * ppq));
  const vlq = (v: number) => {
    const out = [v & 0x7f];
    for (v >>= 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  // [tick, order, bytes]: at one tick, note-offs, then a note's lyric (FF 05, L1), then note-ons
  const events: [number, number, number[]][] = [];
  for (const n of notes) {
    if (n.lyric) {
      const word = [...new TextEncoder().encode(n.lyric)];
      events.push([ticks(n.at), 1, [0xff, 0x05, ...vlq(word.length), ...word]]);
    }
    events.push([ticks(n.at), 2, [0x90, n.pitch & 0x7f, n.velocity & 0x7f]]);
    events.push([ticks(n.at + n.length), 0, [0x80, n.pitch & 0x7f, 64]]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tempo = Math.round(60_000_000 / bpm);
  const meter = Math.min(255, Math.max(1, Math.round(beatsPerBar)));
  const body: number[] = [0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff, 0x00, 0xff, 0x58, 0x04, meter, 2, 24, 8];
  let last = 0;
  for (const [tick, , bytes] of events) {
    body.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0x00, 0x00, 0x00, 0x01, (ppq >> 8) & 0xff, ppq & 0xff];
  return new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]);
}

/** PT-16: notes through a track's MIDI effects in order: transpose (notes leaving 0 to 127 dropped), velocity scaled and
 *  offset (held to 1 to 127), starts quantized to a grid of beats at `bpm` by the strength (lengths kept); S7's
 *  real-time duration (each length times a percentage) and delay (every note later, or earlier down to 0, by ms). */
export function applyMidiFx(notes: readonly NoteEvent[], fx: readonly MidiFx[] | undefined, rate: number, bpm = 120): NoteEvent[] {
  let out = notes.map((n) => ({ ...n }));
  for (const f of fx ?? []) {
    if (f.kind === "transpose") out = out.map((n) => ({ ...n, pitch: n.pitch + f.semitones })).filter((n) => n.pitch >= 0 && n.pitch <= 127);
    else if (f.kind === "velocity") out = out.map((n) => ({ ...n, velocity: Math.max(1, Math.min(127, Math.round(n.velocity * f.scale + f.offset))) }));
    else if (f.kind === "quantize") {
      const grid = (60 / Math.max(1, bpm)) * f.beats * rate;
      out = out.map((n) => ({ ...n, at: Math.max(0, Math.round(n.at + (Math.round(n.at / grid) * grid - n.at) * f.strength)) }));
    } else if (f.kind === "duration") out = out.map((n) => ({ ...n, length: Math.max(1, Math.round((n.length * f.percent) / 100)) }));
    else if (f.kind === "delay") out = out.map((n) => ({ ...n, at: Math.max(0, Math.round(n.at + (f.ms / 1000) * rate)) }));
  }
  return out;
}

/** A note clip's notes rendered by its track's instrument (the built-in synth through `synth`, the session's patch
 *  unless one is given), as new media; nothing in the session changes. */
export async function renderNoteMedia(engine: Engine, trackId: string, clipId: string, notes: readonly NoteEvent[], synth?: SynthPatch): Promise<MediaRef> {
  const doc = engine.get("document");
  const track = doc.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("no such clip");
  const media = doc.media[clip.mediaId];
  const rate = media?.sampleRate ?? doc.sampleRate;
  // PT-16: the clip keeps the notes as played; its sound is rendered from them after the track's MIDI effects
  const heard = applyMidiFx(notes, track?.midiFx, rate, doc.tempo?.bpm ?? 120);
  // PT-15: through the track's instrument: a sampler (its sample's own shape, so a near-flat envelope) or a plugin
  const body = {
    ...instrumentBody(track?.instrument, synth ?? doc.synth ?? DEFAULT_SYNTH),
    notes: heard.map((n) => ({ start: n.at / rate, length: n.length / rate, pitch: n.pitch, velocity: n.velocity })),
    rate,
    name: (media?.name ?? "notes").replace(/\.wav$/i, ""),
    // S7: a clip keeps its length when its notes change (it grows when they pass its end), as a DAW's MIDI clip does
    length: clip.sourceIn / rate + clip.length / doc.sampleRate,
  };
  return renderBody(body);
}

/** What /api/midi/render needs to play notes through an instrument: a sampler (its sample's own shape, so a near-flat
 *  envelope), a plugin, the subtractive or drum synth with its values in the core's order, or the built-in synth. */
export function instrumentBody(inst: Instrument | undefined, synth: SynthPatch): object {
  if (inst?.kind === "sampler") return { sampler: { media: inst.media, root: inst.root }, patch: { wave: "sine", attack: 0.002, decay: 0, sustain: 1, release: 0.1, gain: 1 } };
  if (inst?.kind === "plugin") return { plugin: inst.id };
  if (inst && isInstrumentKind(inst.kind)) return { instrument: { kind: inst.kind, values: instrumentValues(inst.kind, (inst as { values?: Record<string, number> }).values) } };
  const own = cleanSynth(synth);
  return { patch: { wave: own.wave, attack: own.attack, decay: own.decay, sustain: own.sustain, release: own.release, gain: 0.25, cutoff: own.cutoff, resonance: own.resonance } };
}

async function renderBody(body: object): Promise<MediaRef> {
  const res = await fetch("/api/midi/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Partial<MediaRef> & { detail?: unknown };
  if (!res.ok || !out.id) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
  return out as MediaRef;
}

/** S7: notes (none, for an empty clip) rendered by the session's synth with no track around them and lasting at least
 *  `seconds`: the media of a new note clip, or of notes split onto a new track. */
export async function renderPlainNotes(engine: Engine, notes: readonly NoteEvent[], rate: number, seconds: number, name: string): Promise<MediaRef> {
  const own = cleanSynth(engine.get("document").synth ?? DEFAULT_SYNTH);
  return renderBody({
    patch: { wave: own.wave, attack: own.attack, decay: own.decay, sustain: own.sustain, release: own.release, gain: 0.25, cutoff: own.cutoff, resonance: own.resonance },
    notes: notes.map((n) => ({ start: n.at / rate, length: n.length / rate, pitch: n.pitch, velocity: n.velocity })),
    rate,
    name,
    length: seconds,
  });
}

export async function renderNotes(engine: Engine, trackId: string, clipId: string, notes: readonly NoteEvent[]): Promise<void> {
  const media = await renderNoteMedia(engine, trackId, clipId, notes);
  engine.dispatch({ type: "set-clip-notes", trackId, clipId, notes, media });
}
