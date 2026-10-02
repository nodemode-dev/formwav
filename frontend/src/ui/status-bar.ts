import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * The status bar's slots (the engine chip is the shell's): the session's sample rate, its tracks and clips, its
 * length, and a hint. Each slot has a fixed minimum width in frame.css and is written only when its text changes, so
 * nothing moves when a value does.
 */
export function mountStatusBar(host: HTMLElement, engine: Engine): void {
  const bar = host.querySelector<HTMLElement>(".fw-status");
  if (!bar) return;
  const slot = (name: string) => bar.querySelector<HTMLElement>(`.fw-st-${name}`);
  const [rate, tracks, length, hint] = [slot("rate"), slot("tracks"), slot("length"), slot("hint")];
  const clock = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  };
  const render = () => {
    const doc = engine.get("document");
    if (!doc || doc.tracks.length === 0) {
      setText(rate, "");
      setText(tracks, "");
      setText(length, "");
      setText(hint, "Import or drop audio to start, or press Record");
      return;
    }
    const clips = doc.tracks.reduce((n, t) => n + t.clips.length, 0);
    const end = doc.tracks.reduce((m, t) => t.clips.reduce((e, c) => Math.max(e, c.start + c.length), m), 0);
    setText(rate, `${(doc.sampleRate / 1000).toFixed(doc.sampleRate % 1000 ? 1 : 0)} kHz`);
    setText(tracks, `${doc.tracks.length} track${doc.tracks.length === 1 ? "" : "s"} · ${clips} clip${clips === 1 ? "" : "s"}`);
    setText(length, clock(end / doc.sampleRate));
    setText(hint, "Space plays · S splits · Delete removes · ⌘Z or Ctrl+Z undoes");
  };
  engine.subscribe("document", render);
  render();
}
