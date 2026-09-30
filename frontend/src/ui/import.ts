import type { Engine, MediaRef } from "../engine";
import { importFile } from "../io/media-client";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";
import { tempoEstimate } from "./inspector-pane";

export function mountImport(host: HTMLElement, engine: Engine): void {
  const input = host.querySelector<HTMLInputElement>(".fw-file");
  const button = host.querySelector<HTMLButtonElement>('[data-action="import"]');
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let queue: Promise<void> = Promise.resolve();

  // Audacity's tempo detection on import: a file imported into a session without a tempo has its tempo read from its
  // transients, and a confident, regular beat (8 onsets or more, alignment at least 0.7, stricter than Detect's 0.5)
  // becomes the session tempo as its own undo step after the import. Speech and irregular material set nothing.
  const offerTempo = async (media: MediaRef, name: string): Promise<string | null> => {
    if (engine.get("document").tempo) return null;
    try {
      const res = await fetch(`/api/media/${media.id}/transients`);
      if (!res.ok) return null;
      const seconds = ((await res.json()) as { seconds?: number[] }).seconds ?? [];
      const est = seconds.length >= 8 ? tempoEstimate(seconds) : null;
      if (!est || est.score < 0.7 || engine.get("document").tempo) return null;
      engine.dispatch({ type: "set-tempo", bpm: est.bpm, beatsPerBar: 4 });
      return `Imported ${name}; its tempo, ${est.bpm.toFixed(1)} BPM, is now the session tempo (undo to clear it)`;
    } catch {
      return null;
    }
  };

  const importOne = async (file: File, at = 0) => {
    let final = "";
    let shown = false;
    const dismiss = delayedIndicator(
      () => {
        shown = true;
        setText(notice, `Importing ${file.name}`);
      },
      () => setText(notice, final),
    );
    try {
      const doc = engine.get("document");
      const media = await importFile(file, doc.tracks.length ? doc.sampleRate : undefined);
      engine.dispatch({ type: "import-media", media, at });
      final = (await offerTempo(media, file.name)) ?? `Imported ${file.name}`;
    } catch (err) {
      final = `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
    dismiss();
    if (!shown) setText(notice, final);
  };

  const importAll = (files: FileList, at = 0) => {
    for (const file of Array.from(files)) queue = queue.then(() => importOne(file, at));
  };

  button?.addEventListener("click", () => input?.click());
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
  // Audacity takes audio files from the OS clipboard: each pasted file becomes a track at the playhead.
  window.addEventListener("paste", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return;
    const files = e.clipboardData?.files;
    if (!files || !files.length) return;
    e.preventDefault();
    importAll(files, engine.get("transport").positionSamples);
  });
}
