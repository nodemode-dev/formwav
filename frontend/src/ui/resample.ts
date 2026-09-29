import type { Engine, MediaRef, SessionDoc } from "../engine";
import { resampleMedia } from "../io/media-client";
import { setText } from "../vendor/nodemode/dom-stable";

/** Sessions below this rate are raised to 48 kHz; others keep their rate. */
const LOWEST_SESSION_RATE = 44100;

const targetRate = (doc: SessionDoc) => (doc.sampleRate < LOWEST_SESSION_RATE ? 48000 : doc.sampleRate);

/** Media used by clips that does not match the rate the session should run at. */
function staleMedia(doc: SessionDoc, rate: number): MediaRef[] {
  const used = new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.mediaId)));
  return [...used].map((id) => doc.media[id]).filter((m): m is MediaRef => !!m && m.sampleRate !== rate);
}

/**
 * Keeps every clip audible: files at another sample rate are converted (soxr, in the engine) and swapped in,
 * and a session below 44.1 kHz is raised to 48 kHz with every position scaled, all as one undo step.
 */
export function mountResampleRepair(host: HTMLElement, engine: Engine): void {
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let running = false;

  const repair = async (doc: SessionDoc) => {
    if (running || doc.tracks.length === 0) return;
    const rate = targetRate(doc);
    const stale = staleMedia(doc, rate);
    if (stale.length === 0 && rate === doc.sampleRate) return;
    running = true;
    const khz = (rate / 1000).toFixed(1);
    setText(notice, `Converting ${stale.length} file${stale.length === 1 ? "" : "s"} to ${khz} kHz so every clip plays`);
    try {
      const swaps: { from: string; to: MediaRef }[] = [];
      for (const m of stale) swaps.push({ from: m.id, to: await resampleMedia(m.id, rate) });
      engine.dispatch({ type: "resample-session", sampleRate: rate, swaps });
      setText(notice, `Session at ${khz} kHz: converted ${swaps.length} file${swaps.length === 1 ? "" : "s"}, every clip plays`);
    } catch (err) {
      setText(notice, `Could not convert audio to ${khz} kHz: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
    // Edits made while converting may have added more mismatched media; check once more.
    const now = engine.get("document");
    if (now !== doc && (staleMedia(now, targetRate(now)).length || now.sampleRate < LOWEST_SESSION_RATE)) void repair(now);
  };

  engine.subscribe("document", (doc) => void repair(doc));
  void repair(engine.get("document"));
}
