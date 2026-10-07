import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * The status bar's slots (the engine chip is the shell's): the session's sample rate, its length under the clock, and
 * the toolbar's hint. Each slot is written only when its text changes, so nothing moves when a value does.
 */
export function mountStatusBar(host: HTMLElement, engine: Engine): void {
  const bar = host.querySelector<HTMLElement>(".fw-status");
  if (!bar) return;
  const [rate, length, hint] = [bar.querySelector<HTMLElement>(".fw-st-rate"), bar.querySelector<HTMLElement>(".fw-st-length"), host.querySelector<HTMLElement>(".fw-st-hint")];
  const clock = (seconds: number) => {
    const whole = Math.ceil(seconds);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(Math.floor(whole / 3600))}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}`;
  };
  const render = () => {
    const doc = engine.get("document");
    setText(rate, doc ? `${(doc.sampleRate / 1000).toFixed(doc.sampleRate % 1000 ? 1 : 0)} kHz` : "");
    if (!doc || doc.tracks.length === 0) {
      setText(length, "");
      setText(hint, "Import or drop audio to start");
      return;
    }
    const end = doc.tracks.reduce((m, t) => t.clips.reduce((e, c) => Math.max(e, c.start + c.length), m), 0);
    setText(length, `of ${clock(end / doc.sampleRate)}`);
    setText(hint, "Space plays. S splits. Delete removes. Cmd or Ctrl Z undoes.");
  };
  engine.subscribe("document", render);
  render();
}
