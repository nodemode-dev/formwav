import type { Engine } from "../engine";

/**
 * Audacity's spectrogram view, per session: with the toggle on, each clip shows its file's spectrogram (one bare image
 * of the whole file, cached per file) as its background, scaled so the file's length maps to the clip's width times
 * file-frames over clip-frames and offset by the clip's trim, so it follows splits and trims. The waveform is hidden.
 */
const IMAGE_W = 2048;
const IMAGE_H = 256;

/** AA-05: the spectrogram's frequency axis, linear or logarithmic; the engine draws log images with exactly this mapping
 *  (services/tools.py: _log_spectrogram_png), so rulers and selections line up with what is drawn. */
export const LOG_AXIS_LOW_HZ = 20;
export const logAxis = (): boolean => document.body.dataset.spectralScale === "log";
/** Height fraction (0 at the bottom, 1 at the top) of frequency `f` on the current axis. */
export function spectralFraction(f: number, nyquist: number): number {
  return logAxis() ? Math.log(Math.max(f, LOG_AXIS_LOW_HZ) / LOG_AXIS_LOW_HZ) / Math.log(nyquist / LOG_AXIS_LOW_HZ) : f / nyquist;
}
/** Frequency at height fraction `frac` (0 at the bottom) on the current axis. */
export function spectralHz(frac: number, nyquist: number): number {
  return logAxis() ? LOG_AXIS_LOW_HZ * (nyquist / LOG_AXIS_LOW_HZ) ** frac : nyquist * frac;
}

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
  // AA-05: the logarithmic frequency axis for every spectrogram, its ruler and its selections
  const logButton = document.createElement("button");
  logButton.type = "button";
  logButton.className = "fw-mode fw-spectral-log";
  logButton.setAttribute("aria-pressed", "false");
  logButton.title = "Spectrograms on a logarithmic frequency axis (20 Hz at the bottom), for detail in the low octaves";
  logButton.textContent = "Log Hz";
  tray.append(logButton);
  let on = false;
  const urls = new Map<string, string>();

  const set = (el: HTMLElement, prop: string, value: string) => {
    if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
  };
  // AU-30: a ruler and guides over each spectral clip (the image's axis is linear from 0 to half the file's rate), as
  // labelled lines at 1, 5, 10, 15 and 20 kHz
  const scale = (node: HTMLElement, nyquist: number, show: boolean) => {
    let el = node.querySelector<HTMLElement>(":scope > .fw-freq-scale");
    if (!show) {
      if (el && !el.hidden) el.hidden = true;
      return;
    }
    const log = logAxis();
    const key = `${Math.round(nyquist)}${log ? ":log" : ""}`;
    if (!el) {
      el = document.createElement("div");
      el.className = "fw-freq-scale";
      el.setAttribute("aria-hidden", "true");
      node.append(el);
    }
    if (el.dataset.nyquist !== key) {
      el.dataset.nyquist = key;
      el.replaceChildren(
        ...(log ? [50, 100, 500, 1000, 5000, 10000] : [1000, 5000, 10000, 15000, 20000])
          .filter((f) => f < nyquist)
          .map((f) => {
            const line = document.createElement("span");
            line.className = "fw-freq-guide";
            line.style.top = `${((1 - spectralFraction(f, nyquist)) * 100).toFixed(2)}%`;
            line.dataset.hz = String(f);
            line.textContent = f >= 1000 ? `${f / 1000}k` : String(f);
            return line;
          }),
      );
    }
    if (el.hidden) el.hidden = false;
  };
  const apply = () => {
    if (lanes.classList.contains("is-spectral") !== on) lanes.classList.toggle("is-spectral", on);
    const doc = engine.get("document");
    for (const lane of lanes.querySelectorAll<HTMLElement>(".fw-lane")) {
      const own = doc.tracks.find((t) => t.id === lane.dataset.key)?.view === "spectrogram";
      if (lane.classList.contains("is-spectral") !== own) lane.classList.toggle("is-spectral", own);
    }
    for (const node of lanes.querySelectorAll<HTMLElement>(".fw-lane-body .fw-clip")) {
      const trackId = node.closest<HTMLElement>(".fw-lane")?.dataset.key;
      const track = doc.tracks.find((t) => t.id === trackId);
      const spectral = on || track?.view === "spectrogram";
      if (!spectral) {
        for (const p of ["background-image", "background-size", "background-position"]) if (node.style.getPropertyValue(p)) node.style.removeProperty(p);
        scale(node, 0, false);
        continue;
      }
      const clip = track?.clips.find((c) => c.id === node.dataset.key);
      if (clip && doc.media[clip.mediaId]) scale(node, doc.media[clip.mediaId].sampleRate / 2, true);
      const media = clip ? doc.media[clip.mediaId] : undefined;
      if (!clip || !media || !media.frames) continue;
      const cacheKey = `${media.id}${logAxis() ? ":log" : ""}`;
      if (!urls.has(cacheKey)) urls.set(cacheKey, `/api/media/${media.id}/spectrogram.png?w=${IMAGE_W}&h=${logAxis() ? 512 : IMAGE_H}&legend=false${logAxis() ? "&fscale=log" : ""}`);
      const width = node.getBoundingClientRect().width;
      const clipFrames = (clip.length * media.sampleRate) / doc.sampleRate;
      const fileWidth = (width * media.frames) / clipFrames;
      set(node, "background-image", `url("${urls.get(cacheKey)}")`);
      set(node, "background-size", `${fileWidth.toFixed(2)}px 100%`);
      set(node, "background-position", `${(-(clip.sourceIn / media.frames) * fileWidth).toFixed(2)}px 0`);
    }
  };
  button.addEventListener("click", () => {
    on = !on;
    button.setAttribute("aria-pressed", String(on));
    apply();
  });
  logButton.addEventListener("click", () => {
    const log = !logAxis();
    logButton.setAttribute("aria-pressed", String(log));
    if (log) document.body.dataset.spectralScale = "log";
    else delete document.body.dataset.spectralScale;
    apply();
  });
  lanes.addEventListener("fw-lanes-rendered", apply);
}
