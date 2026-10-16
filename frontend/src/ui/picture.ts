import type { Engine, MediaRef, SessionDoc, TransportState } from "../engine";
import type { Command } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";
import { formatClock, parseTimecodeSeconds, timecodeRate } from "./shell";

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
  panel.innerHTML = `<div class="fw-picture-bar"><label class="fw-ibtn">Open video<input type="file" accept="video/*,.mov,.mxf" data-picture-file hidden></label><span class="fw-picture-name" data-picture-name translate="no">No video</span></div><div class="fw-picture-bar" data-picture-controls data-off><label class="fw-q-field">Starts at <input type="text" size="11" data-picture-start aria-label="Picture start timecode" translate="no"></label><button type="button" class="fw-ibtn" data-picture-here title="Put the picture's first frame at the playhead">At playhead</button><label class="fw-q-field"><input type="checkbox" data-picture-burn> Timecode burn-in</label><button type="button" class="fw-ibtn" data-picture-remove title="Take the picture out of the session (its sound stays)">Remove</button></div><div class="fw-picture-frame"><video class="fw-picture-video" muted playsinline preload="auto"></video><div class="fw-picture-tc" data-picture-tc translate="no" hidden></div></div>`;
  host.append(panel);
  const video = panel.querySelector("video") as HTMLVideoElement;
  const file = panel.querySelector<HTMLInputElement>("[data-picture-file]");
  const name = panel.querySelector<HTMLElement>("[data-picture-name]");
  const controls = panel.querySelector<HTMLElement>("[data-picture-controls]");
  const startField = panel.querySelector<HTMLInputElement>("[data-picture-start]");
  const burn = panel.querySelector<HTMLInputElement>("[data-picture-burn]");
  const tc = panel.querySelector<HTMLElement>("[data-picture-tc]");
  let url = "";
  let shownId = "";

  // PLAN_v13 S15: the session's picture (saved with it by reference), played from the engine (its proxy when the page
  // cannot play the movie's codec), its first frame at its start, with the session's timecode burnt in when asked
  const sync = (doc: SessionDoc) => {
    const pic = doc.picture;
    if (controls && (controls.dataset.off === undefined) !== !!pic) controls.toggleAttribute("data-off", !pic);
    if ((pic?.id ?? "") !== shownId) {
      shownId = pic?.id ?? "";
      if (url) URL.revokeObjectURL(url);
      url = "";
      if (pic) {
        video.src = `/api/pictures/${pic.id}/movie`;
        video.addEventListener("loadedmetadata", () => follow(engine.get("transport")), { once: true });
      } else video.removeAttribute("src");
      setText(name, pic ? pic.name : "No video");
    }
    const startText = pic ? formatClock(pic.start, doc, "timecode") : "";
    if (startField && document.activeElement !== startField && startField.dataset.shown !== startText) {
      startField.value = startText;
      startField.dataset.shown = startText;
    }
    if (burn && burn.checked !== !!pic?.burnIn) burn.checked = !!pic?.burnIn;
    if (tc && tc.hidden === !!pic?.burnIn) tc.hidden = !pic?.burnIn;
  };
  video.addEventListener("error", () => {
    const pic = engine.get("document").picture;
    if (pic && video.getAttribute("src")) setText(name, `${pic.name} (missing)`);
  });

  const follow = (t: TransportState) => {
    const doc = engine.get("document");
    if (tc && !tc.hidden) setText(tc, formatClock(t.positionSamples, doc, "timecode"));
    if (panel.hidden || !video.src || video.readyState < 1) return;
    const at = (t.positionSamples - (doc.picture?.start ?? 0)) / t.sampleRate;
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
    file.value = "";
    setText(name, `Opening ${f.name}...`);
    void (async () => {
      const doc = engine.get("document");
      const res = await fetch(`/api/pictures${doc.tracks.length ? `?rate=${doc.sampleRate}` : ""}`, { method: "POST", body: f, headers: { "X-Filename": encodeURIComponent(f.name), "Content-Type": "application/octet-stream" } });
      const out = (await res.json().catch(() => ({}))) as { picture?: { id: string; name: string; size: number; width?: number; height?: number; duration?: number; fps?: number }; audio?: MediaRef | null; detail?: unknown };
      if (!res.ok || !out.picture) {
        setText(name, `Could not open the picture: ${typeof out.detail === "string" ? out.detail : res.status}`);
        return;
      }
      const start = engine.get("transport").positionSamples;
      const commands: Command[] = [{ type: "set-picture", picture: { ...out.picture, start } }];
      if (out.audio?.id) commands.unshift({ type: "import-media", media: out.audio, at: start });
      engine.dispatch({ type: "batch", commands, label: `Opened the picture ${out.picture.name}` });
    })().catch((err) => setText(name, `Could not open the picture: ${err instanceof Error ? err.message : String(err)}`));
  });
  startField?.addEventListener("change", () => {
    const doc = engine.get("document");
    const seconds = parseTimecodeSeconds(startField.value, timecodeRate(doc));
    if (seconds === null || !doc.picture) {
      startField.value = startField.dataset.shown ?? "";
      return;
    }
    engine.dispatch({ type: "set-picture-start", start: Math.round(Math.max(0, seconds - (doc.timecodeStart ?? 0)) * doc.sampleRate) });
  });
  panel.querySelector("[data-picture-here]")?.addEventListener("click", () => engine.dispatch({ type: "set-picture-start", start: engine.get("transport").positionSamples }));
  burn?.addEventListener("change", () => engine.dispatch({ type: "set-picture-burn-in", on: burn.checked }));
  panel.querySelector("[data-picture-remove]")?.addEventListener("click", () => engine.dispatch({ type: "set-picture", picture: null }));
  engine.subscribe("document", (doc) => {
    sync(doc);
    follow(engine.get("transport"));
  });
  sync(engine.get("document"));
  engine.subscribe("transport", follow);
}
