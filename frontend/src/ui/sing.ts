import type { Engine } from "../engine";
import type { Clip, MediaRef, NoteEvent, SessionDoc } from "../engine/document";
import { DEFAULT_SYLLABLE } from "../engine/lyrics";
import { lyricWords, notePhonemes } from "../engine/pronounce";
import type { NoteEditor } from "./piano-roll";

type Field = { key: string; label: string; value: number | string | null; options?: [string, string][]; text?: boolean; placeholder?: string };
type Values = Record<string, number | string | null>;
type Singer = { id: string; name: string; own?: boolean };

/**
 * Singing a note clip (DEV_PLAN_sung_lyrics L4b, L4c): the clip's notes, lyrics and phonemes sent to the engine's
 * SoulX-Singer (POST /api/midi/sing), the result placed on the track that sings the clip (made under the note clip's
 * track the first time, place-sung). Singing takes minutes on a CPU, so it runs in the background, one clip at a time,
 * and editing never waits; a note clip that has been sung is sung again a moment after it is edited, and the engine
 * renders only the phrases that changed. The singer is the session's (set-singer); a singer is made from the selected
 * clip of a person's own singing only once their permission is confirmed, which the session keeps (add-singer).
 */
export function mountSinging(host: HTMLElement, engine: Engine, editor: NoteEditor, say: (text: string) => void) {
  const words = new Map<string, string[]>();
  const queue = new Set<string>();
  const seen = new Map<string, string>();
  let running = false;
  let picked: string[] = [];
  let timer = 0;

  const ask = (title: string, note: string, fields: Field[], ok: string) =>
    new Promise<Values | null>((done) => host.dispatchEvent(new CustomEvent("fw-ask", { detail: { title, note, fields, ok, done } })));
  const findClip = (doc: SessionDoc, id: string) => {
    for (const t of doc.tracks) for (const c of t.clips) if (c.id === id) return { track: t, clip: c };
    return null;
  };
  const singerOf = (doc: SessionDoc) => doc.singer ?? "vocalset_f1";
  const syllableOf = (doc: SessionDoc) => doc.singSyllable ?? DEFAULT_SYLLABLE;
  const inputKey = (doc: SessionDoc, clip: Clip) => JSON.stringify([clip.notes, clip.start, clip.sourceIn, clip.length, singerOf(doc), syllableOf(doc)]);

  /** The clip's notes as they sound, in seconds, the lyric and phonemes of each (words looked up once each). */
  const request = async (doc: SessionDoc, clip: Clip) => {
    const ratio = doc.sampleRate / (doc.media[clip.mediaId]?.sampleRate ?? doc.sampleRate);
    const end = clip.sourceIn + clip.length / ratio;
    const notes: NoteEvent[] = (clip.notes ?? []).filter((n) => n.at < end && n.at + n.length > clip.sourceIn);
    const missing = lyricWords(notes, syllableOf(doc)).map((w) => w.word).filter((w) => w && !words.has(w));
    if (missing.length) {
      const res = await fetch("/api/midi/phonemes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ words: [...new Set(missing)] }) });
      if (res.ok) for (const w of ((await res.json()) as { words: { word: string; phonemes: string[] }[] }).words) words.set(w.word, w.phonemes);
    }
    const phonemes = notePhonemes(notes, syllableOf(doc), (w) => words.get(w));
    return notes.map((n, i) => ({
      start: (clip.start + (Math.max(n.at, clip.sourceIn) - clip.sourceIn) * ratio) / doc.sampleRate,
      length: ((Math.min(n.at + n.length, end) - Math.max(n.at, clip.sourceIn)) * ratio) / doc.sampleRate,
      pitch: n.pitch,
      lyric: n.lyric ?? syllableOf(doc),
      ...(phonemes[i] ? { phonemes: phonemes[i] } : {}),
    }));
  };

  const run = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.size) {
        const id = queue.values().next().value as string;
        queue.delete(id);
        const doc = engine.get("document");
        const found = findClip(doc, id);
        if (!found?.clip.notes?.length) continue;
        const key = inputKey(doc, found.clip);
        const name = doc.media[found.clip.mediaId]?.name.replace(/\.[^.]+$/, "") ?? "Notes";
        const notes = await request(doc, found.clip);
        const sung = doc.tracks.find((t) => t.sungFrom === id);
        if (sung?.sungSig === key) continue;
        say(`Singing ${name}…`);
        const res = await fetch("/api/midi/sing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes, singer: singerOf(doc), rate: doc.sampleRate, name }) });
        if (!res.ok) {
          const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? res.statusText;
          say(`Not sung: ${detail}`);
          continue;
        }
        const out = (await res.json()) as { media: MediaRef; start: number; phrases: number; rendered: number; cached: number; seconds: number };
        seen.set(id, key);
        engine.dispatch({ type: "place-sung", noteClipId: id, media: out.media, at: Math.round(out.start * engine.get("document").sampleRate), sig: key, name: `Sung: ${name}` });
        say(`Sang ${name}: ${out.rendered} phrases sung, ${out.cached} kept, ${Math.round(out.seconds)} s`);
      }
    } catch (err) {
      say(`Not sung: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  const singClip = (id: string) => {
    queue.add(id);
    void run();
  };

  host.addEventListener("fw-selection", (e) => {
    picked = (e as CustomEvent<string[]>).detail ?? [];
  });
  // a sung clip's notes, lyrics, phonemes, singer or syllable changed: sung again once the edits pause
  engine.subscribe("document", () => {
    const doc = engine.get("document");
    for (const t of doc.tracks) {
      if (!t.sungFrom) continue;
      const found = findClip(doc, t.sungFrom);
      if (!found) continue;
      const key = inputKey(doc, found.clip);
      if (!seen.has(t.sungFrom)) seen.set(t.sungFrom, t.sungSig ?? key);
      else if (seen.get(t.sungFrom) !== key) {
        seen.set(t.sungFrom, key);
        window.clearTimeout(timer);
        const id = t.sungFrom;
        timer = window.setTimeout(() => singClip(id), 1500);
      }
    }
  });

  const singers = async (): Promise<Singer[]> => {
    const res = await fetch("/api/midi/singers");
    if (!res.ok) return [];
    return ((await res.json()) as { singers: Singer[] }).singers;
  };

  return {
    sing: () => {
      const target = editor.view().targets[0];
      if (!target) {
        say("Select a note clip to sing");
        return;
      }
      for (const t of editor.view().targets) singClip(t.clipId);
    },
    chooseSinger: async () => {
      const doc = engine.get("document");
      const list = await singers();
      const own = new Set((doc.singers ?? []).map((s) => s.id));
      const options: [string, string][] = list.filter((s) => !s.own || own.has(s.id)).map((s) => [s.id, s.name]);
      const v = await ask("Singer", "Who sings this session's note clips. A person's own voice is listed once its permission is confirmed (New singer from a recording).", [{ key: "singer", label: "Sung by", value: singerOf(doc), text: true, options }], "Choose");
      if (v && typeof v.singer === "string") engine.dispatch({ type: "set-singer", singer: v.singer });
    },
    newSinger: async () => {
      const doc = engine.get("document");
      const found = picked.map((id) => findClip(doc, id)).find((f) => f && !f.clip.notes);
      if (!found) {
        say("Select a clip of the person singing (a few notes on ah work best), then make a singer from it");
        return;
      }
      const v = await ask(
        "New singer from a recording",
        "The selected clip becomes a singer: its first six seconds of singing, best a few notes sung on ah. A voice belongs to its person: formwav makes a singer from it only with their permission, and keeps in the session that you confirmed it.",
        [
          { key: "name", label: "Singer's name", value: "", text: true, placeholder: "Their name" },
          // text: the dialog remembers a select's last value by its title, and a permission must be confirmed each time
          { key: "permission", label: "Permission", value: "", text: true, options: [["", "Not confirmed"], ["yes", "I have the permission of the person whose voice this is"]] },
        ],
        "Make the singer",
      );
      if (!v) return;
      if (v.permission !== "yes") {
        say("No singer made: their permission was not confirmed");
        return;
      }
      const rate = doc.media[found.clip.mediaId]?.sampleRate ?? doc.sampleRate;
      const ratio = doc.sampleRate / rate;
      say("Making the singer…");
      const res = await fetch("/api/midi/singers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: found.clip.mediaId, name: String(v.name ?? ""), permission: true, offset: found.clip.sourceIn / rate, duration: found.clip.length / ratio / rate }),
      });
      if (!res.ok) {
        say(`No singer made: ${((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? res.statusText}`);
        return;
      }
      const made = (await res.json()) as { id: string; name: string; permission: { at: string; media: string } };
      engine.dispatch({ type: "add-singer", id: made.id, name: made.name, permission: { at: made.permission.at, media: made.permission.media } });
      say(`${made.name} sings this session's note clips now`);
    },
  };
}
