import type { Engine, MediaRef, SessionDoc } from "../engine";
import { importFile } from "../io/media-client";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";

export function mountImport(host: HTMLElement, engine: Engine): void {
  const input = host.querySelector<HTMLInputElement>(".fw-file");
  const button = host.querySelector<HTMLButtonElement>('[data-action="import"]');
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let queue: Promise<void> = Promise.resolve();

  // Audacity's tempo detection on import: a file imported into a session without a tempo has its tempo measured by the
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
      if (lower.endsWith(".aup")) throw new Error("zip the .aup together with its _data folder and import the zip");
      if (lower.endsWith(".zip")) {
        if (doc.tracks.length && !window.confirm(`Open the Audacity project ${file.name}? Unsaved changes to the current session will be lost.`)) {
          final = "Kept the current session";
        } else {
          const res = await fetch("/api/projects/import-audacity", { method: "POST", body: file });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; name?: string; document?: SessionDoc; tracks?: number; clips?: number; labels?: number };
          if (!res.ok || !out.document) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          engine.loadDocument(out.document);
          final = `Opened the Audacity project ${out.name}: ${out.tracks} track${out.tracks === 1 ? "" : "s"}, ${out.clips} clip${out.clips === 1 ? "" : "s"}, ${out.labels} label${out.labels === 1 ? "" : "s"}; envelopes and effects were not carried over`;
        }
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
