/**
 * The browser's Effects tab, after the agreed canvas: the realtime effects in four groups (FX_GROUPS, which the Media
 * tab lists as rows that open their group here). Choosing one appends it to the selected clip's track's realtime chain
 * (set-track-fx, with the Effects tab's own defaults; the first track when no clip is selected) and opens the editor's
 * Effects tab on it.
 */
import type { Engine } from "../engine";
import type { TrackFx } from "../engine/document";
import { KINDS } from "./editor-tabs";

export const FX_GROUPS: Array<[string, string[]]> = [
  ["EQ and filters", ["highpass", "lowpass", "peak", "lowshelf", "highshelf"]],
  ["Dynamics", ["compressor", "limiter", "gate"]],
  ["Space and movement", ["reverb", "echo", "chorus", "flanger", "phaser", "tremolo"]],
  ["Repair", ["denoise", "dehum", "declick", "dereverb", "voice"]],
];

export function mountBrowserEffects(host: HTMLElement, engine: Engine): void {
  const panel = host.querySelector<HTMLElement>('.fw-pane-media [data-panel="effects"]');
  if (!panel) return;
  const section = document.createElement("section");
  section.className = "fw-fxlib";
  section.setAttribute("aria-label", "Effects");
  section.innerHTML = `<div class="fw-fxlib-head"><span>Effects</span><span class="fw-fxlib-hint">Adds to the selected clip's track</span></div>${FX_GROUPS.map(
    ([label, kinds]) =>
      `<div class="fw-fxlib-group" role="group" aria-label="${label}"><span class="fw-fxlib-label">${label}</span>${kinds
        .map((k) => `<button type="button" class="fw-fxlib-item" data-kind="${k}" title="Add ${KINDS[k].label} to the selected clip's track, live"><span>${KINDS[k].label}</span><span class="fw-fxlib-sub">${KINDS[k].sub}</span></button>`)
        .join("")}</div>`,
  ).join("")}<p class="fw-fxlib-more">These play live on the track. The other effects render into a clip, from the Inspector.<br><button type="button" class="fw-ibtn" data-open-inspector>Open the Inspector</button></p>`;
  panel.append(section);
  section.querySelector("[data-open-inspector]")?.addEventListener("click", () => {
    if (host.querySelector<HTMLElement>(".fw-pane-inspector")?.hidden) host.querySelector<HTMLButtonElement>(".fw-tool-tray [data-inspector]")?.click();
  });

  let selected: string[] = [];
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail ?? [];
  });
  section.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]");
    const kind = b?.dataset.kind ?? "";
    const k = KINDS[kind];
    if (!k) return;
    const doc = engine.get("document");
    const track = doc.tracks.find((t) => t.clips.some((c) => c.id === selected[0])) ?? doc.tracks[0];
    if (!track) return;
    engine.dispatch({ type: "set-track-fx", trackId: track.id, fx: [...(track.fx ?? []), { kind, ...k.init } as unknown as TrackFx] });
    if (host.querySelector<HTMLElement>(".fw-chain")?.hidden) host.querySelector<HTMLButtonElement>(".fw-tool-tray [data-chain]")?.click();
  });
}
