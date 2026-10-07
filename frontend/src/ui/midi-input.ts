import { applyMidiFx } from "../audio/notes";
import type { Player } from "../audio/player";
import type { Engine } from "../engine";
import { cleanSynth, DEFAULT_SYNTH, type MediaRef, type NoteEvent } from "../engine/document";
import { armedTrack } from "./arm";

/**
 * AU-37: live MIDI input. Every MIDI input the browser offers (Web MIDI; one plugged in later too) plays the live
 * instrument as its keys go down and up, the transport running or not: note-on starts a note, note-off (or note-on at
 * velocity 0, as MIDI has it) ends it, All Notes Off and All Sound Off end them all. While the transport records, the
 * notes are captured with their start and length, and when it stops they become one note clip, rendered by the
 * built-in instrument the live one matches, on the armed track (or a new one), as one undo step.
 */
export function mountMidiInput(engine: Engine, player: Player, notice?: (text: string) => void): void {
  // the transport's position between its reports (every few quanta): the last one, carried on by the clock
  let last = { position: engine.get("transport").positionSamples, time: performance.now(), playing: false };
  const now = () => {
    const t = engine.get("transport");
    return last.playing ? Math.round(last.position + ((performance.now() - last.time) / 1000) * t.sampleRate) : t.positionSamples;
  };
  type Take = { start: number; trackId: string | null; notes: NoteEvent[]; held: Map<number, { at: number; velocity: number }> };
  let take: Take | null = null;
  engine.subscribe("transport", (t) => {
    last = { position: t.positionSamples, time: performance.now(), playing: t.playing };
    if (t.recording && !take) take = { start: t.positionSamples, trackId: armedTrack() ?? null, notes: [], held: new Map() };
    else if (!t.recording && take) {
      const done = take;
      take = null;
      const end = t.positionSamples;
      for (const [pitch, h] of done.held) done.notes.push({ at: h.at - done.start, length: Math.max(1, end - h.at), pitch, velocity: h.velocity });
      void commit(done);
    }
  });

  const sounding = new Map<number, number>(); // PT-16: a held key to the pitch its MIDI effects sound
  const commit = async (done: Take) => {
    const notes = done.notes.filter((n) => n.at >= 0).sort((a, b) => a.at - b.at || a.pitch - b.pitch);
    if (!notes.length) return;
    const doc = engine.get("document");
    const rate = doc.sampleRate;
    // PT-16: the take keeps the notes as played and sounds them through its track's MIDI effects, as any note clip
    const heard = applyMidiFx(notes, doc.tracks.find((t) => t.id === done.trackId)?.midiFx, rate, doc.tempo?.bpm ?? 120);
    const p = cleanSynth(doc.synth ?? DEFAULT_SYNTH);
    const patch = { wave: p.wave, attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release, gain: 0.25, cutoff: p.cutoff, resonance: p.resonance };
    try {
      const res = await fetch("/api/midi/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: heard.map((n) => ({ start: n.at / rate, length: n.length / rate, pitch: n.pitch, velocity: n.velocity })), rate, name: "MIDI take", patch }) });
      const media = (await res.json().catch(() => ({}))) as Partial<MediaRef> & { detail?: unknown };
      if (!res.ok || !media.id) throw new Error(typeof media.detail === "string" ? media.detail : `the engine answered ${res.status}`);
      engine.dispatch({ type: "import-media", media: media as MediaRef, at: done.start, ...(done.trackId ? { trackId: done.trackId } : {}), notes });
      notice?.(`Recorded ${notes.length} MIDI note${notes.length === 1 ? "" : "s"} into a note clip`);
    } catch (err) {
      notice?.(`Could not keep the MIDI take: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onMessage = (data: Uint8Array) => {
    if (data.length < 2) return;
    const status = data[0] & 0xf0;
    const pitch = data[1] & 0x7f;
    const velocity = (data[2] ?? 0) & 0x7f;
    if (status === 0x90 && velocity > 0) {
      // PT-16: heard through the armed track's MIDI effects (quantize does not apply to notes as they are played)
      const doc = engine.get("document");
      const track = doc.tracks.find((t) => t.id === armedTrack());
      const heard = applyMidiFx([{ at: 0, length: 1, pitch, velocity }], track?.midiFx?.filter((f) => f.kind !== "quantize"), doc.sampleRate)[0];
      if (heard) {
        sounding.set(pitch, heard.pitch);
        void player.liveNote(heard.pitch, heard.velocity);
      }
      if (take && !take.held.has(pitch)) take.held.set(pitch, { at: now(), velocity });
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      const was = sounding.get(pitch);
      sounding.delete(pitch);
      if (was !== undefined) void player.liveNote(was, 0);
      const h = take?.held.get(pitch);
      if (take && h) {
        take.held.delete(pitch);
        take.notes.push({ at: h.at - take.start, length: Math.max(1, now() - h.at), pitch, velocity: h.velocity });
      }
    } else if (status === 0xb0 && (data[1] === 123 || data[1] === 120)) {
      player.liveAllOff();
    }
  };

  const access = (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }).requestMIDIAccess;
  if (typeof access !== "function") {
    // AU-37: no Web MIDI here (the desktop app's WebKit): the engine reads the MIDI devices itself
    listenThroughEngine(onMessage, notice);
    return;
  }
  access
    .call(navigator)
    .then((midi) => {
      const hook = (input: MIDIInput) => {
        input.onmidimessage = (e) => {
          if (e.data) onMessage(e.data);
        };
      };
      midi.inputs.forEach(hook);
      midi.onstatechange = (e) => {
        const port = (e as MIDIConnectionEvent).port;
        if (port && port.type === "input" && port.state === "connected") hook(port as MIDIInput);
      };
    })
    .catch(() => {
      // MIDI refused or absent: nothing to listen to
    });
}

/** AU-37: MIDI through the engine, where the page has no Web MIDI (the desktop app's WebKit): the engine lists the
 *  devices it can read (CoreMIDI on macOS) and streams each one's messages as server-sent events, every message going
 *  to the same handler Web MIDI feeds. Devices are looked for again every 5 s, so a keyboard plugged in later is heard
 *  and one unplugged is let go. */
function listenThroughEngine(onMessage: (data: Uint8Array) => void, notice?: (text: string) => void): void {
  const open = new Map<string, EventSource>();
  let told = false; // the engine's reason for having no MIDI, told once rather than not at all
  const look = async () => {
    try {
      const res = await fetch("/api/midi/devices");
      if (!res.ok) return;
      const { devices, error } = (await res.json()) as { devices: string[]; error: string | null };
      if (!devices.length && error && !told) {
        told = true;
        notice?.(`MIDI: ${error}`);
      }
      for (const name of devices) {
        if (open.has(name)) continue;
        const source = new EventSource(`/api/midi/stream?device=${encodeURIComponent(name)}`);
        source.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data) as { data: number[] };
            if (Array.isArray(m.data) && m.data.length) onMessage(new Uint8Array(m.data));
          } catch {
            // not a message
          }
        };
        source.onerror = () => {
          if (source.readyState === EventSource.CLOSED) open.delete(name); // looked for again on the next round
        };
        open.set(name, source);
        notice?.(`MIDI: listening to ${name}`);
      }
      for (const [name, source] of open) {
        if (!devices.includes(name)) {
          source.close();
          open.delete(name);
        }
      }
    } catch {
      // the engine not reachable: nothing to listen to this round
    }
  };
  void look();
  window.setInterval(() => void look(), 5000);
}
