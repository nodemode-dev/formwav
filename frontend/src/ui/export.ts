import type { Engine, MediaRef } from "../engine";
import { documentLength } from "../engine/document";
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
  let choice: { format: string; what: "mix" | "stems" | "multichannel" | "preview" | "surround51" | "ambisonic" | "adm" } = { format: "wav", what: "mix" };
  let platform = "";
  let channelOrder = "";
  // PLAN_v13 S3: the range (the whole session, the Smart Tool's range, the loop, or seconds typed), the dither switch
  // and a peak to normalise the mix to, kept between exports like the format
  let rangeChoice = "all";
  let span = { from: 0, to: 0 };
  let ditherOn = true;
  let normalizeOn = false;
  let normalizeDb = -0.1;
  let smartRange: { start: number; end: number } | null = null;
  host.addEventListener("fw-range", (e) => {
    const d = (e as CustomEvent<{ start: number; end: number } | null>).detail;
    smartRange = d && d.end > d.start ? { start: d.start, end: d.end } : null;
  });
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog";
  dialog.innerHTML = `<form method="dialog">
  <h2 class="fw-dialog-title">Export</h2>
  <label class="fw-field fw-field-stack"><span>Format</span><select data-x="format">
    <option value="wav">WAV, 32-bit float</option><option value="wav32">WAV, 32-bit</option><option value="wav24">WAV, 24-bit</option><option value="wav16">WAV, 16-bit</option>
    <option value="aiff">AIFF, 24-bit</option><option value="aiff16">AIFF, 16-bit</option><option value="aifc">AIFF-C, 32-bit float</option>
    <option value="flac">FLAC, 24-bit lossless</option><option value="flac16">FLAC, 16-bit lossless</option><option value="mp3">MP3, 320 kbps</option><option value="mp3-192">MP3, 192 kbps</option>
    <option value="ogg">OGG Vorbis</option><option value="m4a">M4A, AAC 256 kbps</option></select></label>
  <label class="fw-field fw-field-stack"><span>What</span><select data-x="what">
    <option value="mix">The mix, one stereo file</option><option value="stems">Stems, one file per track (zip)</option><option value="multichannel">Multichannel, one channel per track (WAV or FLAC)</option><option value="aaf">The timeline as AAF, for Pro Tools and Avid (audio embedded)</option><option value="otio">The timeline as OpenTimelineIO, an .otioz with its audio</option><option value="surround51">5.1 surround, six channels in one WAV (tracks placed by their 5.1 position)</option><option value="ambisonic">Ambisonics, first order: an AmbiX WAV (W Y Z X; tracks placed by direction and elevation)</option><option value="adm">Objects: an ADM BWF file (each track placed on the surround pad as an object, for Atmos and MPEG-H tools)</option><option value="preview">Streaming preview: add a track that sounds like the encoded file (MP3, OGG or M4A)</option></select></label>
  <label class="fw-field fw-field-stack" data-x="range-row"><span>Range</span><select data-x="range"><option value="all">The whole session</option><option value="selection">The selected range</option><option value="loop">The loop</option><option value="span">From and to, in seconds</option></select></label>
  <div class="fw-export-span" data-x="span-row"><label><span>From</span><input type="number" data-x="from" min="0" step="0.001" value="0" aria-label="From, in seconds"></label><label><span>To</span><input type="number" data-x="to" min="0" step="0.001" value="0" aria-label="To, in seconds" title="Past the last clip, the effects' tails ring out"></label></div>
  <label class="fw-export-opt" data-x="dither-row"><input type="checkbox" data-x="dither" checked><span>Dither (TPDF) for 16 and 24-bit</span></label>
  <label class="fw-export-opt" data-x="normalize-row"><input type="checkbox" data-x="normalize"><span>Normalize the peak to</span><input type="number" data-x="normalize-db" min="-60" max="0" step="0.1" value="-0.1" aria-label="Peak, dBFS"><span>dBFS</span></label>
  <label class="fw-field fw-field-stack" data-x="channels-row" hidden><span>Channel order</span><input type="text" data-x="channels" placeholder="Track order" title="Track numbers in channel order, such as 2,1,3 (a track may fill several channels); empty keeps track order" aria-label="Channel order, track numbers separated by commas"></label>
  <label class="fw-field fw-field-stack" data-x="platform-row" hidden><span>Platform loudness</span><select data-x="platform">
    <option value="">None: the codec only</option><option value="spotify">Spotify: -14 LUFS, lifts quiet mixes only to -1 dB true peak</option><option value="youtube">YouTube: -14 LUFS, turns loud mixes down only</option><option value="apple">Apple Music: -16 LUFS, modelled as turning down only (sources disagree on lifting)</option></select></label>
  <div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="cancel">Cancel</button><button type="submit" class="fw-ibtn fw-btn-export" value="export">Export</button></div>
</form>`;
  host.append(dialog);
  const platformRow = dialog.querySelector<HTMLElement>('[data-x="platform-row"]');
  const channelsRow = dialog.querySelector<HTMLElement>('[data-x="channels-row"]');
  const field = <T extends HTMLElement>(name: string) => dialog.querySelector<T>(`[data-x="${name}"]`);
  const show = (el: HTMLElement | null, on: boolean) => {
    if (el && el.hidden === on) el.hidden = !on;
  };
  const DITHERED = new Set(["wav24", "wav16", "aiff", "aiff16", "flac", "flac16"]);
  // the range, dither and normalise rows stay in place and are switched off where they do not apply, so choosing a
  // format or a range never moves the rows under it
  const enable = (row: string, on: boolean) => {
    const el = field(row);
    if (!el) return;
    for (const control of el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) if (control.disabled === on) control.disabled = !on;
    if ((el.dataset.off === "true") === on) el.dataset.off = String(!on);
  };
  const showPlatform = () => {
    const what = field<HTMLSelectElement>("what")?.value ?? "mix";
    show(platformRow, what === "preview");
    show(channelsRow, what === "multichannel");
    // the range applies where the engine renders frames from the mix: not to the AAF, the ADM objects or a preview
    const ranged = what !== "aaf" && what !== "otio" && what !== "adm" && what !== "preview";
    enable("range-row", ranged);
    enable("span-row", ranged && field<HTMLSelectElement>("range")?.value === "span");
    enable("dither-row", (what === "mix" || what === "stems" || what === "multichannel") && DITHERED.has(field<HTMLSelectElement>("format")?.value ?? ""));
    enable("normalize-row", what === "mix");
  };
  for (const name of ["what", "format", "range"]) field(name)?.addEventListener("change", showPlatform);
  /** The frames the chosen range covers, or an error saying what is missing. */
  const resolveRange = (): { start?: number; end?: number } => {
    const doc = engine.get("document");
    if (rangeChoice === "selection") {
      if (!smartRange) throw new Error("there is no selected range: drag one across a clip first, or choose another range");
      return smartRange;
    }
    if (rangeChoice === "loop") {
      if (!doc.loop || doc.loop.end <= doc.loop.start) throw new Error("the session has no loop range: set one, or choose another range");
      return { start: doc.loop.start, end: doc.loop.end };
    }
    if (rangeChoice === "span") {
      if (!(span.to > span.from) || span.from < 0) throw new Error("the range's To must come after its From");
      return { start: Math.round(span.from * doc.sampleRate), end: Math.round(span.to * doc.sampleRate) };
    }
    return {};
  };

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
      const ranged = choice.what !== "adm";
      const mix = await renderMix(doc, {
        format: choice.format,
        what: choice.what,
        channels: channelOrder,
        ...(ranged ? resolveRange() : {}),
        ...(choice.what === "mix" && normalizeOn ? { normalize: normalizeDb } : {}),
        dither: ditherOn,
      });
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
        // Only the 32-bit float files keep samples above full scale; every other format clips them.
        const float = choice.format === "wav" || choice.format === "aifc";
        const clips = peak > 0 && !float ? " · the mix peaks above 0 dBFS, so this file clips: lower the Master fader, use Loudness or Normalize, or export 32-bit float" : "";
        const lossy = ["mp3", "mp3-192", "ogg", "m4a"].includes(choice.format);
        const overs = lossy && mix.truePeak > -1 && peak <= 0 ? " · its true peak is above -1 dBTP, which the encoder can push over full scale" : "";
        const normalized = mix.normalizeDb ? ` · normalized ${mix.normalizeDb > 0 ? "+" : ""}${mix.normalizeDb.toFixed(1)} dB` : "";
        final = `Exported ${name} · peak ${level(peak, "dBFS")} · true peak ${level(mix.truePeak, "dBTP")} · ${level(mix.loudness, "LUFS")}${normalized}${skipped}${clips}${overs}`;
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
    const doc = engine.get("document");
    const range = field<HTMLSelectElement>("range");
    if (range) {
      for (const option of range.options) {
        const off = (option.value === "selection" && !smartRange) || (option.value === "loop" && !(doc.loop && doc.loop.end > doc.loop.start));
        if (option.disabled !== off) option.disabled = off;
      }
      range.value = range.querySelector<HTMLOptionElement>(`option[value="${rangeChoice}"]`)?.disabled ? "all" : rangeChoice;
    }
    const from = field<HTMLInputElement>("from");
    const to = field<HTMLInputElement>("to");
    if (from) from.value = String(span.from);
    if (to) to.value = String(span.to > span.from ? span.to : Math.round((documentLength(doc) / doc.sampleRate) * 1000) / 1000);
    const ditherBox = field<HTMLInputElement>("dither");
    if (ditherBox) ditherBox.checked = ditherOn;
    const normalizeBox = field<HTMLInputElement>("normalize");
    if (normalizeBox) normalizeBox.checked = normalizeOn;
    const normalizeField = field<HTMLInputElement>("normalize-db");
    if (normalizeField) normalizeField.value = String(normalizeDb);
    showPlatform();
    dialog.showModal();
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "export") return;
    const interchange = dialog.querySelector<HTMLSelectElement>('[data-x="what"]')?.value;
    if (interchange === "aaf" || interchange === "otio") {
      // PT-30: the timeline as an AAF, its audio embedded, for Pro Tools and Avid; PLAN_v14 W4: or as OpenTimelineIO
      void (async () => {
        const res = await fetch(`/api/projects/export-${interchange}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(engine.get("document")) });
        if (!res.ok) {
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
          window.alert(`Could not export the ${interchange === "aaf" ? "AAF" : "OpenTimelineIO bundle"}: ${typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`}`);
          return;
        }
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = interchange === "aaf" ? "formwav-session.aaf" : "formwav-session.otioz";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      })();
      return;
    }
    const format = dialog.querySelector<HTMLSelectElement>('[data-x="format"]')?.value ?? "wav";
    const what = (dialog.querySelector<HTMLSelectElement>('[data-x="what"]')?.value ?? "mix") as "mix" | "stems" | "multichannel" | "preview" | "surround51" | "ambisonic" | "adm";
    choice = { format, what };
    rangeChoice = field<HTMLSelectElement>("range")?.value ?? "all";
    span = { from: Number(field<HTMLInputElement>("from")?.value ?? 0), to: Number(field<HTMLInputElement>("to")?.value ?? 0) };
    ditherOn = field<HTMLInputElement>("dither")?.checked ?? true;
    normalizeOn = field<HTMLInputElement>("normalize")?.checked ?? false;
    const peakTarget = Number(field<HTMLInputElement>("normalize-db")?.value ?? -0.1);
    normalizeDb = Number.isFinite(peakTarget) ? Math.min(0, Math.max(-60, peakTarget)) : -0.1;
    platform = what === "preview" ? (dialog.querySelector<HTMLSelectElement>('[data-x="platform"]')?.value ?? "") : "";
    channelOrder = what === "multichannel" ? (dialog.querySelector<HTMLInputElement>('[data-x="channels"]')?.value ?? "") : "";
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
