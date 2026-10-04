import type { Engine, TransportState } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * PT-26: picture for sound to picture. A Picture toggle in the tool tray's View group opens a panel that shows a local
 * video (its sound muted: the session's sound is what plays) in step with the transport, the video's start at the
 * session's start: stopped, it shows the frame at the playhead (within half a frame); playing, it plays alongside and is
 * set back in step whenever it drifts more than 80 ms.
 */
export function mountPicture(host: HTMLElement, engine: Engine): void {
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  if (!view) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-mode";
  button.dataset.picture = "";
  button.setAttribute("aria-pressed", "false");
  button.title = "Picture: a video shown in step with the transport, for sound to picture (its own sound muted)";
  button.innerHTML = "<span>Picture</span>";
  view.append(button);

  const panel = document.createElement("div");
  panel.className = "fw-picture";
  panel.hidden = true;
  panel.innerHTML = `<div class="fw-picture-bar"><label class="fw-ibtn">Open video<input type="file" accept="video/*" data-picture-file hidden></label><span class="fw-picture-name" data-picture-name>No video</span></div><video class="fw-picture-video" muted playsinline preload="auto"></video>`;
  host.append(panel);
  const video = panel.querySelector("video") as HTMLVideoElement;
  const file = panel.querySelector<HTMLInputElement>("[data-picture-file]");
  const name = panel.querySelector<HTMLElement>("[data-picture-name]");
  let url = "";

  const follow = (t: TransportState) => {
    if (panel.hidden || !video.src || video.readyState < 1) return;
    const at = t.positionSamples / t.sampleRate;
    const target = Math.min(Math.max(0, at), Number.isFinite(video.duration) ? video.duration : at);
    if (t.playing) {
      if (video.paused) {
        video.currentTime = target;
        void video.play().catch(() => undefined);
      } else if (Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
    } else {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - target) > 0.5 / 30) video.currentTime = target;
    }
  };

  button.addEventListener("click", () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute("aria-pressed", String(opening));
    if (opening) follow(engine.get("transport"));
  });
  file?.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f);
    video.src = url;
    setText(name, f.name);
    video.addEventListener("loadedmetadata", () => follow(engine.get("transport")), { once: true });
  });
  engine.subscribe("transport", follow);
}
