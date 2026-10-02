import type { Engine, MediaRef } from "../engine";
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
  let choice: { format: string; what: "mix" | "stems" | "multichannel" | "preview" } = { format: "wav", what: "mix" };
  let platform = "";
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog";
  dialog.innerHTML = `<form method="dialog">
  <h2 class="fw-dialog-title">Export</h2>
  <label class="fw-field fw-field-stack"><span>Format</span><select data-x="format">
    <option value="wav">WAV, 32-bit float</option><option value="wav24">WAV, 24-bit</option><option value="wav16">WAV, 16-bit (dithered)</option>
    <option value="flac">FLAC, 24-bit lossless</option><option value="mp3">MP3, 320 kbps</option><option value="mp3-192">MP3, 192 kbps</option>
    <option value="ogg">OGG Vorbis</option><option value="m4a">M4A, AAC 256 kbps</option></select></label>
  <label class="fw-field fw-field-stack"><span>What</span><select data-x="what">
    <option value="mix">The mix, one stereo file</option><option value="stems">Stems, one file per track (zip)</option><option value="multichannel">Multichannel, one channel per track (WAV or FLAC)</option><option value="preview">Streaming preview: add a track that sounds like the encoded file (MP3, OGG or M4A)</option></select></label>
  <label class="fw-field fw-field-stack" data-x="platform-row" hidden><span>Platform loudness</span><select data-x="platform">
    <option value="">None: the codec only</option><option value="spotify">Spotify: -14 LUFS, lifts quiet mixes only to -1 dB true peak</option><option value="youtube">YouTube: -14 LUFS, turns loud mixes down only</option><option value="apple">Apple Music: -16 LUFS, modelled as turning down only (sources disagree on lifting)</option></select></label>
  <div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="cancel">Cancel</button><button type="submit" class="fw-ibtn fw-btn-export" value="export">Export</button></div>
</form>`;
  host.append(dialog);
  const platformRow = dialog.querySelector<HTMLElement>('[data-x="platform-row"]');
  const showPlatform = () => {
    const preview = dialog.querySelector<HTMLSelectElement>('[data-x="what"]')?.value === "preview";
    if (platformRow && platformRow.hidden === preview) platformRow.hidden = !preview;
  };
  dialog.querySelector('[data-x="what"]')?.addEventListener("change", showPlatform);

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
      if (choice.what === "preview") {
        const res = await fetch(`/api/render?format=${encodeURIComponent(choice.format)}&what=preview&platform=${encodeURIComponent(platform)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
        });
        const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
        if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
        const media = body as unknown as MediaRef;
        engine.dispatch({ type: "import-media", media, at: 0 });
        const level = body as { platform?: string; loudness?: number; gainDb?: number };
        final = level.platform
          ? `Added ${media.name}: the mix measures ${level.loudness} LUFS, so ${level.platform} plays it ${(level.gainDb ?? 0) >= 0 ? "+" : ""}${level.gainDb} dB`
          : `Added ${media.name}: solo it against the mix to hear the codec`;
        return;
      }
      const mix = await renderMix(doc, { format: choice.format, what: choice.what });
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
        // Only 32-bit float WAV keeps samples above full scale; every other format clips them.
        const clips = peak > 0 && choice.format !== "wav" ? " · the mix peaks above 0 dBFS, so this file clips: lower the Master fader or use Loudness, or export 32-bit float WAV" : "";
        final = `Exported ${name} · peak ${level(peak, "dBFS")} · ${level(mix.loudness, "LUFS")}${skipped}${clips}`;
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
    showPlatform();
    dialog.showModal();
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "export") return;
    const format = dialog.querySelector<HTMLSelectElement>('[data-x="format"]')?.value ?? "wav";
    const what = (dialog.querySelector<HTMLSelectElement>('[data-x="what"]')?.value ?? "mix") as "mix" | "stems" | "multichannel" | "preview";
    choice = { format, what };
    platform = what === "preview" ? (dialog.querySelector<HTMLSelectElement>('[data-x="platform"]')?.value ?? "") : "";
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
