import type { Engine } from "../engine";
import type { Player } from "../audio/player";
import { documentLength } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";
import { onZoom, samplesPerPixel } from "./lanes";

/**
 * PLAN_v13 S15: the picture lane under the ruler, shown while the session has a picture: frames of the movie as tiles
 * along the timeline from the picture's start, at the zoom's spacing, cut by the engine sixteen at a time and kept; a
 * click locates. Like the ruler, a wide spacer takes the clicks and a canvas the visible window wide paints.
 */
const TILE_H = 40;
const CHUNK = 16;

export function mountPictureLane(host: HTMLElement, engine: Engine, player: Player): void {
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!stage || !lanes) return;
  const lane = document.createElement("div");
  lane.className = "fw-picture-lane";
  lane.hidden = true;
  lane.innerHTML = `<div class="fw-ruler-corner"><span class="fw-ruler-title" data-picture-lane-name translate="no"></span></div><div class="fw-picture-lane-track" aria-label="Picture: click to move the playhead"></div><canvas class="fw-picture-lane-paint" aria-hidden="true"></canvas>`;
  stage.insertBefore(lane, lanes);
  const corner = lane.children[0] as HTMLElement;
  const title = lane.querySelector<HTMLElement>("[data-picture-lane-name]");
  const track = lane.children[1] as HTMLElement;
  const paint = lane.children[2] as HTMLCanvasElement;
  const sprites = new Map<string, HTMLImageElement>();
  let raf = 0;
  const soon = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
  };

  const draw = () => {
    const doc = engine.get("document");
    const pic = doc.picture;
    if (lane.hidden === !!pic) lane.hidden = !pic;
    if (!pic) return;
    setText(title, pic.name);
    const spp = samplesPerPixel(doc);
    const width = Math.max(Math.ceil(documentLength(doc) / spp), stage.clientWidth - corner.offsetWidth);
    if (track.style.width !== `${width}px`) track.style.width = `${width}px`;
    const left = Math.min(stage.scrollLeft, Math.max(0, width - 1));
    const view = Math.max(1, Math.min(width - left, stage.clientWidth - corner.offsetWidth));
    const dpr = window.devicePixelRatio || 1;
    if (paint.style.left !== `${corner.offsetWidth + left}px`) paint.style.left = `${corner.offsetWidth + left}px`;
    if (paint.style.width !== `${view}px`) paint.style.width = `${view}px`;
    const w = Math.max(1, Math.round(view * dpr));
    const h = Math.max(1, Math.round(paint.clientHeight * dpr));
    if (paint.width !== w) paint.width = w;
    if (paint.height !== h) paint.height = h;
    const ctx = paint.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, -left * dpr, 0);
    ctx.clearRect(left, 0, view, h / dpr);
    const aspect = pic.width && pic.height ? pic.width / pic.height : 16 / 9;
    const tileW = Math.max(24, Math.round(TILE_H * aspect));
    const step = (tileW * spp) / doc.sampleRate;
    const x0 = pic.start / spp;
    const tiles = Math.max(1, Math.ceil(((pic.duration ?? 0) * doc.sampleRate) / spp / tileW));
    const first = Math.max(0, Math.floor((left - x0) / tileW));
    const last = Math.min(tiles - 1, Math.floor((left + view - x0) / tileW));
    const top = Math.max(0, (h / dpr - TILE_H) / 2);
    for (let c = Math.floor(first / CHUNK); c * CHUNK <= last; c++) {
      const count = Math.min(CHUNK, tiles - c * CHUNK);
      const times = Array.from({ length: count }, (_, k) => +((c * CHUNK + k) * step).toFixed(4));
      const key = `${pic.id}|${times.join(",")}`;
      let img = sprites.get(key);
      if (!img) {
        img = new Image();
        img.addEventListener("load", soon, { once: true });
        img.src = `/api/pictures/${pic.id}/sprite?times=${times.join(",")}&height=${TILE_H}`;
        sprites.set(key, img);
        if (sprites.size > 96) sprites.delete(sprites.keys().next().value as string);
      }
      if (!img.complete || !img.naturalWidth) continue;
      const sw = img.naturalWidth / count;
      for (let k = 0; k < count; k++) {
        const x = x0 + (c * CHUNK + k) * tileW;
        if (x + tileW < left || x > left + view) continue;
        ctx.drawImage(img, k * sw, 0, sw, img.naturalHeight, x, top, tileW - 1, TILE_H);
      }
    }
  };

  track.addEventListener("click", (e) => {
    const x = e.clientX - track.getBoundingClientRect().left;
    player.seek(Math.max(0, Math.round(x * samplesPerPixel(engine.get("document")))));
  });
  engine.subscribe("document", draw);
  onZoom(draw);
  stage.addEventListener("scroll", soon, { passive: true });
  stage.addEventListener("fw-scrolled", draw);
  window.addEventListener("resize", draw);
  draw();
}
