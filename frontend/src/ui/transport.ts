import type { Engine, SessionDoc, TransportState } from "../engine";
import type { Player } from "../audio/player";
import { delayedIndicator, setText } from "../vendor/nodemode/dom-stable";
import { samplesPerPixel } from "./lanes";

export function mountTransport(host: HTMLElement, engine: Engine, player: Player): void {
  const button = (action: string) => host.querySelector<HTMLButtonElement>(`.fw-tbtn[data-action="${action}"]`);
  const toStart = button("to-start");
  const play = button("play");
  const stop = button("stop");
  const lanes = host.querySelector<HTMLElement>(".fw-lanes");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
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
  const placePlayhead = () => {
    const doc = engine.get("document");
    const x = `translateX(${(engine.get("transport").positionSamples / samplesPerPixel(doc)).toFixed(1)}px)`;
    if (x !== lastTransform) {
      lastTransform = x;
      playhead.style.transform = x;
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
    const body = (e.target as HTMLElement).closest<HTMLElement>(".fw-lane-body");
    if (!body) return;
    const px = e.clientX - body.getBoundingClientRect().left;
    player.seek(px * samplesPerPixel(engine.get("document")));
  });
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey || !engine.get("document").tracks.length) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "Home") {
      e.preventDefault();
      player.seek(0);
    }
  });

  engine.subscribe("document", renderDocument);
  engine.subscribe("transport", renderTransport);
  renderDocument(engine.get("document"));
  renderTransport(engine.get("transport"));
}
