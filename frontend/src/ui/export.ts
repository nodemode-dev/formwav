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

  const render = () => {
    const has = engine.get("document").tracks.length > 0;
    if (button && button.disabled === has) button.disabled = !has;
  };

  const run = async () => {
    const doc = engine.get("document");
    if (busy || !doc.tracks.length) return;
    busy = true;
    const name = `${(nameField?.value.trim() || "Untitled session").replace(/[\\/:*?"<>|]+/g, "-")}.wav`;
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
      const mix = await renderMix(doc);
      const url = URL.createObjectURL(mix.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const peak = Math.max(mix.peakLeft, mix.peakRight);
      const skipped = mix.skipped ? ` · ${mix.skipped} clip(s) at another sample rate left out` : "";
      final = `Exported ${name} · peak ${level(peak, "dBFS")} · ${level(mix.loudness, "LUFS")}${skipped}`;
    } catch (err) {
      final = `Could not export: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      dismiss();
      if (!shown) setText(notice, final);
      busy = false;
    }
  };

  button?.addEventListener("click", () => void run());
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      void run();
    }
  });
  engine.subscribe("document", render);
  render();
}
