import type { Engine } from "../engine";
import type { MediaRef, NoteEvent } from "../engine/document";

/**
 * A note clip's edited notes rendered again by the built-in instrument (POST /api/midi/render) and swapped in together
 * with them (set-clip-notes, one undo step). Notes are frames of the clip's media; the engine takes seconds, at that
 * media's own rate.
 */
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
