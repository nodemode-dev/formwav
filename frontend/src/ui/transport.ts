import type { Engine, SessionDoc, TransportState } from "../engine";
import type { Player } from "../audio/player";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";
import { onZoom, samplesPerPixel } from "./lanes";
import { snapSamples } from "./grid";

let follow = true;
/** Whether the view pages to keep the playhead in sight (the toolbar's Follow). */
export function setFollow(on: boolean): void {
  follow = on;
}

export function mountTransport(host: HTMLElement, engine: Engine, player: Player): void {
  const button = (action: string) => host.querySelector<HTMLButtonElement>(`.fw-tbtn[data-action="${action}"]`);
  const toStart = button("to-start");
  const play = button("play");
  const stop = button("stop");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  // Play-at-speed (AU-42): a continuous slider on a powers-of-two scale (1 times in the middle, halving and doubling an
  // equal travel), applied while it moves; double-click resets it to 1 times through the page's slider reset
  const speed = host.querySelector<HTMLInputElement>("[data-speed]");
  const speedOut = host.querySelector<HTMLElement>("[data-speed-out]");
  const applySpeed = () => {
    const x = 2 ** (Number(speed?.value) || 0);
    player.setSpeed(x);
    setText(speedOut, `${x.toFixed(2)}×`);
  };
  speed?.addEventListener("input", applySpeed);
  speed?.addEventListener("change", applySpeed);
  const playhead = document.createElement("div");
  playhead.className = "fw-playhead";
  playhead.setAttribute("aria-hidden", "true");
  lanes?.append(playhead);

  const togglePlay = () => {
    let shown = false;
    let final: string | null = null;
    const dismiss = delayedIndicator(
      () => {
        shown = true;
        setText(notice, "Loading audio");
      },
      () => {
        if (final !== null) setText(notice, final);
      },
    );
    player
      .toggle()
      .then(
        () => {
          if (player.skipped > 0) final = `${player.skipped} clip(s) at another sample rate are silent until resampling arrives`;
          else if (shown) final = "";
        },
        (err: unknown) => {
          final = `Playback failed: ${err instanceof Error ? err.message : String(err)}`;
        },
      )
      .finally(() => {
        dismiss();
        if (!shown && final !== null) setText(notice, final);
      });
  };

  let lastTransform = "";
  const followStage = host.querySelector<HTMLElement>(".fw-stage");
  let headWidth = 0;
  const placePlayhead = () => {
    const doc = engine.get("document");
    const px = engine.get("transport").positionSamples / samplesPerPixel(doc);
    const x = `translateX(${px.toFixed(1)}px)`;
    if (x !== lastTransform) {
      lastTransform = x;
      playhead.style.transform = x;
      // Follow the playhead: page the view when it passes 92% of the visible timeline or leaves it on the left.
      if (followStage && follow) {
        if (!headWidth) headWidth = followStage.querySelector<HTMLElement>(".fw-lane-head")?.offsetWidth ?? 0;
        const view = followStage.clientWidth - headWidth;
        const left = followStage.scrollLeft;
        const ahead = engine.get("transport").playing ? left + view * 0.92 : left + view;
        if (view > 0 && (px > ahead || px < left)) {
          followStage.scrollLeft = Math.max(0, px - view * 0.08);
          // AU-13: the ruler and the waves paint only what is in view; told now, they move with the page in one frame
          followStage.dispatchEvent(new Event("fw-scrolled"));
        }
      }
    }
  };

  const enable = (b: HTMLButtonElement | null, on: boolean) => {
    if (b && b.disabled === on) b.disabled = !on;
  };

  const renderDocument = (doc: SessionDoc) => {
    const has = doc.tracks.length > 0;
    enable(toStart, has);
    enable(play, has);
    enable(stop, has);
    if (!has && engine.get("transport").playing) player.stop();
    placePlayhead();
  };

  const renderTransport = (t: TransportState) => {
    const pressed = String(t.playing);
    if (play && play.getAttribute("aria-pressed") !== pressed) play.setAttribute("aria-pressed", pressed);
    placePlayhead();
  };

  toStart?.addEventListener("click", () => player.seek(0));
  play?.addEventListener("click", togglePlay);
  stop?.addEventListener("click", () => {
    player.stop();
    player.seek(0);
  });
  lanes?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".fw-clip")) return;
    const body = (e.target as HTMLElement).closest<HTMLElement>(".fw-lane-body");
    if (!body) return;
    const px = e.clientX - body.getBoundingClientRect().left;
    const doc = engine.get("document");
    const spp = samplesPerPixel(doc);
    player.seek(snapSamples(px * spp, doc.sampleRate, doc.sampleRate / spp));
  });
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.isContentEditable ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        (target.tagName === "INPUT" && !/^(range|checkbox|radio|button|submit|reset|file|color)$/.test((target as HTMLInputElement).type)));
    if (typing || e.metaKey || e.ctrlKey || e.altKey || !engine.get("document").tracks.length) return;
    if (e.code === "Space") {
      // Space is the transport everywhere but text entry: a focused button must not swallow it or be clicked by it.
      e.preventDefault();
      if (target && target !== document.body && target.tagName !== "INPUT" && !target.classList.contains("fw-stage")) target.blur();
      if (!e.repeat) togglePlay();
    } else if (e.key === "Home" && target?.tagName !== "INPUT") {
      e.preventDefault();
      player.seek(0);
    }
  });

  engine.subscribe("document", renderDocument);
  engine.subscribe("transport", renderTransport);
  onZoom(placePlayhead);
  renderDocument(engine.get("document"));
  renderTransport(engine.get("transport"));
}
