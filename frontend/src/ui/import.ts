import type { Engine } from "../engine";
import { importFile } from "../io/media-client";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";

export function mountImport(host: HTMLElement, engine: Engine): void {
  const input = host.querySelector<HTMLInputElement>(".fw-file");
  const button = host.querySelector<HTMLButtonElement>('[data-action="import"]');
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let queue: Promise<void> = Promise.resolve();

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
      final = `Imported ${file.name}`;
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
