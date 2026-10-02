import type { Engine } from "../engine";

/**
 * Audacity's spectrogram view, per session: with the toggle on, each clip shows its file's spectrogram (one bare image
 * of the whole file, cached per file) as its background, scaled so the file's length maps to the clip's width times
 * file-frames over clip-frames and offset by the clip's trim, so it follows splits and trims. The waveform is hidden.
 */
const IMAGE_W = 2048;
const IMAGE_H = 256;

export function mountSpectrogramView(host: HTMLElement, engine: Engine): void {
  const tray = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  if (!tray || !lanes) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-mode fw-spectral-toggle";
  button.setAttribute("aria-pressed", "false");
  button.title = "Show clips as spectrograms (frequency over time)";
  button.textContent = "Spectrogram";
  tray.append(button);
  let on = false;
  const urls = new Map<string, string>();

  const set = (el: HTMLElement, prop: string, value: string) => {
    if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
  };
  const apply = () => {
    if (lanes.classList.contains("is-spectral") !== on) lanes.classList.toggle("is-spectral", on);
    const doc = engine.get("document");
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-lane-body .fw-clip")) {
      if (!on) {
        for (const p of ["background-image", "background-size", "background-position"]) if (node.style.getPropertyValue(p)) node.style.removeProperty(p);
        continue;
      }
      const trackId = node.closest<HTMLElement>(".fw-lane")?.dataset.key;
      const clip = doc.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === node.dataset.key);
      const media = clip ? doc.media[clip.mediaId] : undefined;
      if (!clip || !media || !media.frames) continue;
      if (!urls.has(media.id)) urls.set(media.id, `/api/media/${media.id}/spectrogram.png?w=${IMAGE_W}&h=${IMAGE_H}&legend=false`);
      const width = node.getBoundingClientRect().width;
      const clipFrames = (clip.length * media.sampleRate) / doc.sampleRate;
      const fileWidth = (width * media.frames) / clipFrames;
      set(node, "background-image", `url("${urls.get(media.id)}")`);
      set(node, "background-size", `${fileWidth.toFixed(2)}px 100%`);
      set(node, "background-position", `${(-(clip.sourceIn / media.frames) * fileWidth).toFixed(2)}px 0`);
    }
  };
  button.addEventListener("click", () => {
    on = !on;
    button.setAttribute("aria-pressed", String(on));
    apply();
  });
  lanes.addEventListener("fw-lanes-rendered", apply);
}
