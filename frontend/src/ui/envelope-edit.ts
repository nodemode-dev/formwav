import type { Engine, SessionDoc } from "../engine";
import { GAIN_SPAN_DB, GAIN_TOP_DB } from "./lanes";

/**
 * A clip's volume envelope edited on the clip itself (AU-12; points could only be added at the playhead from the
 * Inspector). Each point draws as a handle inside its clip, placed in percentages of the clip so zoom and scroll need
 * nothing, at the height the envelope line uses (the clip gain plus the point's dB on the lanes' +12 to -36 dB scale).
 * Drag a handle to move its point (between its neighbours, so points never cross); Alt-click a clip's body to add a
 * point at that time and level (the first one makes the envelope); Alt-click a handle to remove its point, as on an
 * automation row. Presses within 8 px of a clip's edges are left alone, so Alt-drag time-stretch still works. Each
 * gesture dispatches set-clip-envelope once, one undo step. Presses are taken in the capture phase and stopped, so the
 * lanes' own gestures (select, move, trim) never start under them.
 */
const EDGE = 8;

const fraction = (db: number) => Math.min(1, Math.max(0, (GAIN_TOP_DB - db) / GAIN_SPAN_DB));
const levelAt = (f: number) => GAIN_TOP_DB - Math.min(1, Math.max(0, f)) * GAIN_SPAN_DB;
const round1 = (v: number) => Math.round(v * 10) / 10;

function find(doc: SessionDoc, clipId: string) {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function mountEnvelopeEdit(host: HTMLElement, engine: Engine): void {
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!lanes) return;

  const sync = () => {
    const doc = engine.get("document");
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-clip")) {
      const hit = node.dataset.key ? find(doc, node.dataset.key) : null;
      const points = hit?.clip.envelope ?? [];
      let box = node.querySelector<HTMLElement>(".fw-env-points");
      if (!hit || !points.length) {
        if (box && !box.hidden) box.hidden = true;
        continue;
      }
      if (!box) {
        box = document.createElement("div");
        box.className = "fw-env-points";
        node.append(box);
      }
      if (box.hidden) box.hidden = false;
      while (box.children.length > points.length) box.lastElementChild?.remove();
      while (box.children.length < points.length) {
        const handle = document.createElement("span");
        handle.className = "fw-env-point";
        box.append(handle);
      }
      points.forEach((p, i) => {
        const handle = box.children[i] as HTMLElement;
        const left = `${(((p.at - hit.clip.sourceIn) / Math.max(1, hit.clip.length)) * 100).toFixed(3)}%`;
        const top = `${(fraction(hit.clip.gainDb + p.db) * 100).toFixed(3)}%`;
        if (handle.style.left !== left) handle.style.left = left;
        if (handle.style.top !== top) handle.style.top = top;
        const title = `${p.db > 0 ? "+" : ""}${p.db.toFixed(1)} dB: drag to move, Alt-click to remove`;
        if (handle.title !== title) handle.title = title;
        if (handle.dataset.index !== String(i)) handle.dataset.index = String(i);
      });
    }
  };
  // after the lanes have placed this change's clip nodes
  engine.subscribe("document", () => requestAnimationFrame(sync));

  lanes.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const node = target.closest<HTMLElement>(".fw-clip");
      const handle = target.closest<HTMLElement>(".fw-env-point");
      if (!node?.dataset.key || (!handle && !e.altKey)) return;
      const hit = find(engine.get("document"), node.dataset.key);
      if (!hit) return;
      const { track, clip } = hit;
      const rect = node.getBoundingClientRect();
      const points = [...(clip.envelope ?? [])];
      const commit = (next: { at: number; db: number }[]) => engine.dispatch({ type: "set-clip-envelope", trackId: track.id, clipId: clip.id, points: next });
      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number(handle.dataset.index);
        if (e.altKey) {
          points.splice(index, 1);
          commit(points);
          return;
        }
        handle.setPointerCapture(e.pointerId);
        const lo = index > 0 ? points[index - 1].at + 1 : clip.sourceIn;
        const hi = index < points.length - 1 ? points[index + 1].at - 1 : clip.sourceIn + clip.length;
        let moved: { at: number; db: number } | null = null;
        const move = (ev: PointerEvent) => {
          const at = Math.round(Math.min(hi, Math.max(lo, clip.sourceIn + ((ev.clientX - rect.left) / rect.width) * clip.length)));
          const db = round1(levelAt((ev.clientY - rect.top) / rect.height) - clip.gainDb);
          moved = { at, db };
          handle.style.left = `${(((at - clip.sourceIn) / Math.max(1, clip.length)) * 100).toFixed(3)}%`;
          handle.style.top = `${(fraction(clip.gainDb + db) * 100).toFixed(3)}%`;
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          if (moved) {
            points[index] = moved;
            commit(points);
          }
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        return;
      }
      const x = e.clientX - rect.left;
      if (x < EDGE || x > rect.width - EDGE) return;
      e.preventDefault();
      e.stopPropagation();
      const at = Math.round(clip.sourceIn + (x / rect.width) * clip.length);
      const db = round1(levelAt((e.clientY - rect.top) / rect.height) - clip.gainDb);
      commit([...points, { at, db }].sort((a, b) => a.at - b.at));
    },
    true,
  );
  sync();
}
