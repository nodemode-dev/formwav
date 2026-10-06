/**
 * The browser's effects, after the approved target (research/ui_reference): under the session's media, the sixteen
 * realtime effects in four groups. Choosing one appends it to the selected clip's track's realtime chain
 * (set-track-fx, with the Effects tab's own defaults; the first track when no clip is selected) and opens the editor's
 * Effects tab on it.
 */
import type { Engine } from "../engine";
import type { TrackFx } from "../engine/document";
import { KINDS } from "./editor-tabs";

const GROUPS: Array<[string, string[]]> = [
  ["EQ and filters", ["highpass", "lowpass", "peak", "lowshelf", "highshelf"]],
  ["Dynamics", ["compressor", "limiter", "gate"]],
  ["Space and movement", ["reverb", "echo", "chorus", "flanger", "phaser", "tremolo"]],
  ["Repair", ["denoise", "voice"]],
];

export function mountBrowserEffects(host: HTMLElement, engine: Engine): void {
  const media = host.querySelector<HTMLElement>('.fw-pane-media [data-panel="media"]');
  if (!media) return;
  const section = document.createElement("section");
  section.className = "fw-fxlib";
  section.setAttribute("aria-label", "Effects");
  section.innerHTML = `<div class="fw-fxlib-head"><span>Effects</span><span class="fw-fxlib-hint">Adds to the selected clip's track</span></div>${GROUPS.map(
    ([label, kinds]) =>
      `<div class="fw-fxlib-group" role="group" aria-label="${label}"><span class="fw-fxlib-label">${label}</span>${kinds
        .map((k) => `<button type="button" class="fw-fxlib-item" data-kind="${k}" title="Add ${KINDS[k].label} to the selected clip's track"><span>${KINDS[k].label}</span><span class="fw-fxlib-sub">${KINDS[k].sub}</span></button>`)
        .join("")}</div>`,
  ).join("")}`;
  // After the media list rather than inside it, so a new file (an import, a render) never pushes it; marked as part of
  // the media panel, so the pane's other tabs hide it with the list
  section.dataset.panel = "media";
  media.after(section);

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
