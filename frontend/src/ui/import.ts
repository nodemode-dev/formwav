import type { Player } from "../audio/player";
import type { Command, Engine, MediaRef, SessionDoc } from "../engine";
import { importFile } from "../io/media-client";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";

type SongMap = { tempos?: { tick: number | null; bpm: number }[]; meters?: { tick?: number | null; numerator: number; denominator: number }[]; keys?: { tick?: number | null; fifths: number; minor: boolean }[] };

const MAJORS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINORS = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];

/** S11: a MIDI file's tempo, meter and key changes as the session's (meters placed at the bar their tick starts). */
function songMap(song: SongMap): Command[] {
  const out: Command[] = [];
  const tempos = (song.tempos ?? []).filter((t) => t.tick !== null);
  if (tempos.length > 1) out.push({ type: "set-tempo-map", changes: tempos.map((t) => ({ tick: t.tick as number, bpm: Math.round(t.bpm * 1000) / 1000 })) });
  let bar = 0;
  let tick = 0;
  let perBar = 3840;
  for (const m of song.meters ?? []) {
    if (m.tick === null || m.tick === undefined) continue;
    bar += Math.round((m.tick - tick) / perBar);
    tick = m.tick;
    perBar = (m.numerator * 3840) / m.denominator;
    out.push({ type: "set-meter-change", bar, num: m.numerator, den: m.denominator });
  }
  for (const k of song.keys ?? []) {
    const name = (k.minor ? MINORS : MAJORS)[k.fifths + 7];
    if (name && k.tick !== null && k.tick !== undefined) out.push({ type: "set-key-change", tick: k.tick, key: `${name} ${k.minor ? "minor" : "major"}` });
  }
  return out;
}

export function mountImport(host: HTMLElement, engine: Engine, player: Player): void {
  const input = host.querySelector<HTMLInputElement>(".fw-file");
  const button = host.querySelector<HTMLButtonElement>('[data-action="import"]');
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let queue: Promise<void> = Promise.resolve();

  // Tempo detection on import: a file imported into a session without a tempo has its tempo measured by the
  // engine (services/tempo.py), and a confident one (0.2, twice what Detect needs; speech and irregular hits score about
  // 0.03, real beats 0.32 and up) becomes the session tempo as its own undo step after the import.
  const offerTempo = async (media: MediaRef, name: string): Promise<string | null> => {
    if (engine.get("document").tempo) return null;
    try {
      const res = await fetch(`/api/media/${media.id}/tempo`);
      if (!res.ok) return null;
      const found = (await res.json()) as { bpm?: number; confidence?: number };
      if (!found.bpm || (found.confidence ?? 0) < 0.2 || engine.get("document").tempo) return null;
      engine.dispatch({ type: "set-tempo", bpm: found.bpm, beatsPerBar: 4 });
      return `Imported ${name}; its tempo, ${found.bpm.toFixed(1)} BPM, is now the session tempo (undo to clear it)`;
    } catch {
      return null;
    }
  };

  const importOne = async (file: File, at = 0) => {
    let final = "";
    let shown = false;
    let openAfter = "";
    const dismiss = delayedIndicator(
      () => {
        shown = true;
        setText(notice, `Importing ${file.name}`);
      },
      () => setText(notice, final),
    );
    try {
      const doc = engine.get("document");
      const lower = file.name.toLowerCase();
      const headerName = file.name.replace(/[^\x20-\x7e\xa0-\xff]/g, "_");
      if (lower.endsWith(".aup")) throw new Error("zip the .aup together with its _data folder and import the zip");
      if (lower.endsWith(".fmw")) {
        // A formwav session picked or dropped here: the engine keeps it among the sessions, then it opens the way any
        // saved session opens (ui/projects.ts, its unsaved-changes guard included)
        const res = await fetch("/api/projects/upload", { method: "POST", body: file, headers: { "X-Filename": headerName } });
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown; name?: string };
        if (!res.ok || !out.name) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        openAfter = out.name;
        final = "Received the session; opening it";
      } else if (lower.endsWith(".edl")) {
        // PT-31: the picture edit conformed to the field recorder's files already in the session (broadcast WAVs with
        // timecode); the session becomes the edit's timeline
        const answer = window.prompt(`Conform ${file.name} to the recorder files in this session? The session will be replaced by the edit. Frames per second of the edit (24, 25, 30, 48, 50 or 60):`, "25");
        if (answer === null || !Number(answer)) {
          final = "Kept the current session";
        } else {
          const split = window.confirm("Put each recorder channel (boom, lavaliers) on its own track? Cancel keeps each file's channels together.");
          const res = await fetch("/api/projects/conform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ edl: await file.text(), media: Object.keys(doc.media), fps: Number(answer), split, rate: doc.tracks.length ? doc.sampleRate : 48000 }),
          });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; document?: SessionDoc; events?: number; matched?: number; unmatched?: { event: string; reel: string }[] };
          if (!res.ok || !out.document) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          player.stop();
          engine.loadDocument(out.document);
          final = `Conformed ${file.name}: ${out.matched} of ${out.events} events placed from the recorder files${out.unmatched?.length ? `; not found: ${out.unmatched.map((u) => `${u.event} (${u.reel})`).join(", ")}` : ""}`;
        }
      } else if (lower.endsWith(".aaf")) {
        // PT-30: an AAF's timeline opens as the session, its embedded audio imported; linked audio is named, not reached
        if (doc.tracks.length && !window.confirm(`Open the AAF ${file.name}? Unsaved changes to the current session will be lost.`)) {
          final = "Kept the current session";
        } else {
          const res = await fetch("/api/projects/import-aaf", { method: "POST", body: file });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; name?: string; document?: SessionDoc; tracks?: number; clips?: number; missing?: string[] };
          if (!res.ok || !out.document) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          player.stop();
          engine.loadDocument(out.document);
          final = `Opened the AAF ${out.name}: ${out.tracks} track${out.tracks === 1 ? "" : "s"}, ${out.clips} clip${out.clips === 1 ? "" : "s"}${out.missing?.length ? `; linked audio not found: ${out.missing.join(", ")}` : ""}`;
        }
      } else if (lower.endsWith(".omf") || (lower.endsWith(".zip") && /\.omf/i.test(await file.slice(Math.max(0, file.size - 65536)).text()))) {
        // R11: an OMF 2 file's timeline opens as the session, its embedded audio imported; an .omf whose audio sits in
        // files beside it comes as a zip of the .omf and those files (found by the .omf among the zip's file names)
        if (doc.tracks.length && !window.confirm(`Open the OMF ${file.name}? Unsaved changes to the current session will be lost.`)) {
          final = "Kept the current session";
        } else {
          const res = await fetch("/api/projects/import-omf", { method: "POST", body: file });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; name?: string; document?: SessionDoc; tracks?: number; clips?: number; missing?: string[] };
          if (!res.ok || !out.document) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          player.stop();
          engine.loadDocument(out.document);
          final = `Opened the OMF ${out.name}: ${out.tracks} track${out.tracks === 1 ? "" : "s"}, ${out.clips} clip${out.clips === 1 ? "" : "s"}${out.missing?.length ? `; audio not found: ${out.missing.join(", ")}` : ""}`;
        }
      } else if (lower.endsWith(".zip") || lower.endsWith(".aup3")) {
        // a zipped .aup with its _data folder, or an .aup3 (AU-33), read from a copy so the original is never changed
        if (doc.tracks.length && !window.confirm(`Open the .aup project ${file.name}? Unsaved changes to the current session will be lost.`)) {
          final = "Kept the current session";
        } else {
          const res = await fetch("/api/projects/import-aup", { method: "POST", body: file, headers: { "X-Filename": headerName } });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; name?: string; document?: SessionDoc; tracks?: number; clips?: number; labels?: number };
          if (!res.ok || !out.document) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          player.stop();
          engine.loadDocument(out.document);
          final = `Opened the .aup project ${out.name}: ${out.tracks} track${out.tracks === 1 ? "" : "s"}, ${out.clips} clip${out.clips === 1 ? "" : "s"}, ${out.labels} label${out.labels === 1 ? "" : "s"}; envelopes and effects were not carried over`;
        }
      } else if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
        // the engine reads the file and the built-in instrument renders its notes; the rendering plays like any audio
        const res = await fetch(`/api/midi/import?rate=${doc.tracks.length ? doc.sampleRate : 48000}`, { method: "POST", body: file, headers: { "X-Filename": headerName } });
        type Song = SongMap & { detail?: unknown; tempo?: number; markers?: { time: number; label: string }[]; tracks?: { name: string; channel: number; media: MediaRef; notes: { start: number; length: number; pitch: number; velocity: number; lyric?: string }[]; controllers: { time: number; kind: "cc" | "bend" | "program" | "pressure"; number: number; value: number }[] }[] };
        const out = (await res.json().catch(() => ({}))) as Song;
        if (!res.ok || !out.tracks?.length) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        // S8: one note track per track of the file, its name, notes and controllers; the file's markers; its first tempo and
        // meter for a session that has no tempo yet; all one undo step
        const before = engine.get("document");
        const sessionRate = before.tracks.length ? before.sampleRate : out.tracks[0].media.sampleRate;
        const commands: Command[] = out.tracks.map((t) => {
          const rate = t.media.sampleRate;
          return { type: "import-media" as const, media: t.media, at, notes: t.notes.map((n) => ({ at: n.start * rate, length: n.length * rate, pitch: n.pitch, velocity: n.velocity, ...(n.lyric ? { lyric: n.lyric } : {}) })), controllers: t.controllers.map((c) => ({ at: c.time * rate, kind: c.kind, number: c.number, value: c.value })), midiChannel: t.channel };
        });
        for (const m of out.markers ?? []) commands.push({ type: "add-marker", at: Math.round(at + m.time * sessionRate), label: m.label });
        const meter = out.meters?.[0];
        const beats = meter ? Math.max(1, Math.round((meter.numerator * 4) / meter.denominator)) : 4;
        const tempoSet = !before.tempo && out.tempo;
        if (tempoSet) commands.push({ type: "set-tempo", bpm: Math.round((out.tempo ?? 120) * 100) / 100, beatsPerBar: beats });
        // S11: a file placed at the start brings its whole tempo, meter and key map, in ticks at 960 a quarter
        if (tempoSet && at === 0) commands.push(...songMap(out));
        engine.dispatch({ type: "batch", commands, label: `Imported ${file.name}` });
        const count = out.tracks.reduce((n, t) => n + t.notes.length, 0);
        final = `Imported ${file.name}: ${out.tracks.length} track${out.tracks.length === 1 ? "" : "s"}, ${count} notes${out.markers?.length ? `, ${out.markers.length} markers` : ""}${tempoSet ? `; the session tempo is now ${Math.round(out.tempo ?? 120)} BPM` : ""}, played by the built-in instrument`;
      } else {
        const media = await importFile(file, doc.tracks.length ? doc.sampleRate : undefined);
        engine.dispatch({ type: "import-media", media, at });
        final = (await offerTempo(media, file.name)) ?? `Imported ${file.name}`;
      }
    } catch (err) {
      final = `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
    dismiss();
    if (!shown) setText(notice, final);
    if (openAfter) host.dispatchEvent(new CustomEvent("fw-open-project", { detail: openAfter }));
  };

  const importAll = (files: FileList, at = 0) => {
    for (const file of Array.from(files)) queue = queue.then(() => importOne(file, at));
  };

  button?.addEventListener("click", () => input?.click());
  // File > Open's "Open a .fmw file" (ui/projects.ts) hands its pick to the same queue
  host.addEventListener("fw-import-files", (e) => importAll((e as CustomEvent<FileList>).detail));
  input?.addEventListener("change", () => {
    if (input.files && input.files.length) importAll(input.files);
    input.value = "";
  });
  stage?.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  stage?.addEventListener("drop", (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    importAll(e.dataTransfer.files);
  });
  // Audio files come in from the OS clipboard: each pasted file becomes a track at the playhead.
  window.addEventListener("paste", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return;
    const files = e.clipboardData?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    importAll(files, engine.get("transport").positionSamples);
  });
}
