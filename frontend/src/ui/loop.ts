import type { Engine, SessionDoc } from "../engine";
import { documentLength } from "../engine/document";
import { onZoom, samplesPerPixel } from "./lanes";

export function mountLoop(host: HTMLElement, engine: Engine): void {
  const button = host.querySelector<HTMLButtonElement>('.fw-tbtn[data-action="loop"]');
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  const band = document.createElement("div");
  band.className = "fw-loop-band";
  band.hidden = true;
  band.setAttribute("aria-hidden", "true");
  lanes?.append(band);

  let lastTransform = "";
  let lastWidth = "";

  const toggle = () => {
    const doc = engine.get("document");
    if (!doc.tracks.length) return;
    if (doc.loop) engine.dispatch({ type: "set-loop", start: doc.loop.start, end: doc.loop.end, enabled: !doc.loop.enabled });
    else engine.dispatch({ type: "set-loop", start: 0, end: documentLength(doc), enabled: true });
  };

  const render = (doc: SessionDoc) => {
    const has = doc.tracks.length > 0;
    if (button && button.disabled === has) button.disabled = !has;
    const on = has && !!doc.loop?.enabled;
    const pressed = String(on);
    if (button && button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    if (band.hidden === on) band.hidden = !on;
    if (!on || !doc.loop) return;
    const spp = samplesPerPixel(doc);
    const transform = `translateX(${(doc.loop.start / spp).toFixed(2)}px)`;
    const width = `${Math.max(1, (doc.loop.end - doc.loop.start) / spp).toFixed(2)}px`;
    if (transform !== lastTransform) {
      lastTransform = transform;
      band.style.transform = transform;
    }
    if (width !== lastWidth) {
      lastWidth = width;
      band.style.width = width;
    }
  };

  button?.addEventListener("click", toggle);
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "l") return;
    e.preventDefault();
    toggle();
  });
  engine.subscribe("document", render);
  onZoom(() => render(engine.get("document")));
  render(engine.get("document"));
}
