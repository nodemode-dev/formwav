import type { Engine } from "../engine";
import type { MediaRef } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";
import { repaintMedia, sampleAt, setDrawPreview } from "./lanes";

// a pencil, drawn for this button (currentColor, as the app's other inline icons)
const PENCIL = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.5-5.5L15 5l4 4-9.5 9.5L4 20z"/><path d="M13 7l4 4"/></svg>`;

/**
 * AU-13: Audacity's Draw tool in the lanes. With Draw on and a clip zoomed in until single samples show (at most one of
 * its frames a pixel), a press draws on the channel row under it: every sample between one pointer position and the
 * next takes the value under the pointer (a fast stroke leaves no gap), shown as it is drawn, and letting go writes the
 * stroke into that channel alone (the others, and every sample outside the stroke, untouched) as one undo step. Zoomed
 * out, the press says to zoom in and does what it otherwise does.
 */
export function mountDrawTool(host: HTMLElement, engine: Engine): void {
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const tray = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="edit"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  if (!stage || !tray) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-mode";
  button.dataset.draw = "";
  button.setAttribute("aria-pressed", "false");
  button.title = "Draw samples (Audacity's Draw tool): zoom in until single samples show, then drag on a clip; a stereo clip is drawn on the channel under the pointer";
  button.innerHTML = `${PENCIL}<span>Draw</span>`;
  tray.append(button);
  let on = false;
  button.addEventListener("click", () => {
    on = !on;
    button.setAttribute("aria-pressed", String(on));
    if (notice) setText(notice, on ? "Draw: zoom in until single samples show, then drag on a clip" : "Draw off");
  });

  type Stroke = { trackId: string; clipId: string; media: MediaRef; channel: number; values: Map<number, number>; last: { frame: number; value: number } | null; at: (e: PointerEvent) => { frame: number; value: number } };
  let stroke: Stroke | null = null;

  const add = (p: { frame: number; value: number }) => {
    if (!stroke) return;
    const last = stroke.last;
    if (last && last.frame !== p.frame) {
      const step = p.frame > last.frame ? 1 : -1;
      for (let f = last.frame + step; f !== p.frame + step; f += step) stroke.values.set(f, last.value + ((p.value - last.value) * (f - last.frame)) / (p.frame - last.frame));
    } else stroke.values.set(p.frame, p.value);
    stroke.last = p;
    setDrawPreview({ mediaId: stroke.media.id, channel: stroke.channel, values: stroke.values });
    repaintMedia(stroke.media.id);
  };

  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (!on || e.button !== 0) return;
      const node = (e.target as HTMLElement).closest<HTMLElement>(".fw-clip");
      const lane = node?.closest<HTMLElement>(".fw-lane");
      const doc = engine.get("document");
      const track = doc.tracks.find((t) => t.id === lane?.dataset.key);
      const clip = track?.clips.find((c) => c.id === node?.dataset.key);
      const media = clip ? doc.media[clip.mediaId] : undefined;
      if (!node || !track || !clip || !media || clip.notes?.length) return;
      const rect = node.getBoundingClientRect();
      const fpp = (clip.length * media.sampleRate) / doc.sampleRate / rect.width; // the media's frames a CSS pixel
      if (fpp > 1) {
        if (notice) setText(notice, "Zoom in until single samples show to draw them");
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // the lanes' own press (select, move) does not run
      const channels = Math.max(1, media.channels ?? 1);
      const rowH = rect.height / channels;
      const channel = Math.min(channels - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rowH)));
      const mid = rowH * channel + rowH / 2;
      const half = (rowH / 2) * 0.9; // as the lanes draw it
      const gain = 10 ** (clip.gainDb / 20);
      const at = (ev: PointerEvent) => ({
        frame: Math.max(0, Math.min(media.frames - 1, Math.round(clip.sourceIn + (ev.clientX - rect.left) * fpp))),
        value: Math.max(-1, Math.min(1, (mid - (ev.clientY - rect.top)) / half / gain)),
      });
      stroke = { trackId: track.id, clipId: clip.id, media, channel, values: new Map(), last: null, at };
      add(at(e));
    },
    { capture: true },
  );
  window.addEventListener("pointermove", (e) => {
    if (stroke) add(stroke.at(e));
  });
  window.addEventListener("pointerup", () => {
    const done = stroke;
    stroke = null;
    if (!done || !done.values.size) return;
    const frames = [...done.values.keys()];
    const start = Math.min(...frames);
    const end = Math.max(...frames);
    const values: number[] = [];
    for (let f = start; f <= end; f++) values.push(done.values.get(f) ?? sampleAt(done.media.id, done.channel, f));
    void (async () => {
      try {
        const res = await fetch(`/api/media/${done.media.id}/draw`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start, values, channel: done.channel }) });
        const out = (await res.json().catch(() => ({}))) as Partial<MediaRef> & { detail?: unknown };
        if (!res.ok || !out.id) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
        engine.dispatch({ type: "set-clip-media", trackId: done.trackId, clipId: done.clipId, media: out as MediaRef });
        const which = (done.media.channels ?? 1) > 1 ? ` on the ${done.channel === 0 ? "left" : done.channel === 1 ? "right" : `channel ${done.channel + 1}`} channel` : "";
        if (notice) setText(notice, `Drew ${values.length} sample${values.length === 1 ? "" : "s"}${which} (undo puts them back)`);
      } catch (err) {
        if (notice) setText(notice, `Could not draw: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setDrawPreview(null);
        repaintMedia(done.media.id);
      }
    })();
  });
}
