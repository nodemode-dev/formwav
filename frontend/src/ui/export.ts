import type { Engine } from "../engine";
import { renderMix } from "../io/render-client";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";

function level(value: number, unit: string): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : `silent`;
}

export function mountExport(host: HTMLElement, engine: Engine): void {
  const button = host.querySelector<HTMLButtonElement>('[data-action="export"]');
  const nameField = host.querySelector<HTMLInputElement>("input.fw-session-name");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let busy = false;
  let choice: { format: string; what: "mix" | "stems" | "multichannel" } = { format: "wav", what: "mix" };
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog";
  dialog.innerHTML = `<form method="dialog">
  <h2 class="fw-dialog-title">Export</h2>
  <label class="fw-field fw-field-stack"><span>Format</span><select data-x="format">
    <option value="wav">WAV, 32-bit float</option><option value="wav24">WAV, 24-bit</option><option value="wav16">WAV, 16-bit (dithered)</option>
    <option value="flac">FLAC, 24-bit lossless</option><option value="mp3">MP3, 320 kbps</option><option value="mp3-192">MP3, 192 kbps</option>
    <option value="ogg">OGG Vorbis</option><option value="m4a">M4A, AAC 256 kbps</option></select></label>
  <label class="fw-field fw-field-stack"><span>What</span><select data-x="what">
    <option value="mix">The mix, one stereo file</option><option value="stems">Stems, one file per track (zip)</option><option value="multichannel">Multichannel, one channel per track (WAV or FLAC)</option></select></label>
  <div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="cancel">Cancel</button><button type="submit" class="fw-ibtn fw-btn-export" value="export">Export</button></div>
</form>`;
  host.append(dialog);

  const render = () => {
    const has = engine.get("document").tracks.length > 0;
    if (button && button.disabled === has) button.disabled = !has;
  };

  const run = async () => {
    const doc = engine.get("document");
    if (busy || !doc.tracks.length) return;
    busy = true;
    const base = (nameField?.value.trim() || "Untitled session").replace(/[\\/:*?"<>|]+/g, "-");
    let name = base;
    let shown = false;
    let final = "";
    const dismiss = delayedIndicator(
      () => {
        shown = true;
        setText(notice, `Exporting ${name}`);
      },
      () => setText(notice, final),
    );
    try {
      const mix = await renderMix(doc, choice);
      name = choice.what === "mix" ? `${base}.${mix.ext}` : `${base} ${choice.what}.${mix.ext}`;
      const url = URL.createObjectURL(mix.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (mix.stems) {
        final = `Exported ${name} · ${mix.stems} track${mix.stems === 1 ? "" : "s"}`;
      } else {
        const peak = Math.max(mix.peakLeft, mix.peakRight);
        const skipped = mix.skipped ? ` · ${mix.skipped} clip(s) at another sample rate left out` : "";
        final = `Exported ${name} · peak ${level(peak, "dBFS")} · ${level(mix.loudness, "LUFS")}${skipped}`;
      }
    } catch (err) {
      final = `Could not export: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      dismiss();
      if (!shown) setText(notice, final);
      busy = false;
    }
  };

  button?.addEventListener("click", () => {
    if (busy || !engine.get("document").tracks.length) return;
    const format = dialog.querySelector<HTMLSelectElement>('[data-x="format"]');
    const what = dialog.querySelector<HTMLSelectElement>('[data-x="what"]');
    if (format) format.value = choice.format;
    if (what) what.value = choice.what;
    dialog.showModal();
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "export") return;
    const format = dialog.querySelector<HTMLSelectElement>('[data-x="format"]')?.value ?? "wav";
    const what = (dialog.querySelector<HTMLSelectElement>('[data-x="what"]')?.value ?? "mix") as "mix" | "stems" | "multichannel";
    choice = { format, what };
    void run();
  });
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      void run();
    }
  });
  engine.subscribe("document", render);
  render();
}
