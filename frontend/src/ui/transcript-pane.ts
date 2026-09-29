import type { Player } from "../audio/player";
import type { Engine, SessionDoc } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/** A word in its media file's own seconds, as the engine's transcript returns it. */
interface MediaWord {
  text: string;
  start: number;
  end: number;
  filler: boolean;
}
/** A word placed on the session timeline, in session samples. */
interface SessionWord {
  key: string;
  text: string;
  filler: boolean;
  start: number;
  end: number;
}

const GAP_OVER = 0.75;
const GAP_KEEP = 0.3;

/**
 * Maps every transcribed clip's words onto the session: a word belongs to a clip when its midpoint lies inside the
 * clip's trimmed source range, and moves with the clip. Re-derived from the document, so it follows every edit and undo.
 */
function sessionWords(doc: SessionDoc, transcripts: Map<string, MediaWord[]>): SessionWord[] {
  const out: SessionWord[] = [];
  for (const track of doc.tracks)
    for (const clip of track.clips) {
      const words = transcripts.get(clip.mediaId);
      const media = doc.media[clip.mediaId];
      if (!words || !media) continue;
      const toSession = doc.sampleRate / media.sampleRate;
      const srcEnd = clip.sourceIn + clip.length / toSession;
      words.forEach((w, i) => {
        const s = w.start * media.sampleRate;
        const e = w.end * media.sampleRate;
        const mid = (s + e) / 2;
        if (mid < clip.sourceIn || mid >= srcEnd) return;
        out.push({
          key: `${clip.id}:${i}`,
          text: w.text,
          filler: w.filler,
          start: Math.round(clip.start + (Math.max(s, clip.sourceIn) - clip.sourceIn) * toSession),
          end: Math.round(clip.start + (Math.min(e, srcEnd) - clip.sourceIn) * toSession),
        });
      });
    }
  return out.sort((a, b) => a.start - b.start);
}

/** Consecutive words become one range (the gaps between them go too). */
function rangesOf(words: SessionWord[], pick: (w: SessionWord) => boolean): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let open: { start: number; end: number } | null = null;
  for (const w of words) {
    if (pick(w)) {
      if (open) open.end = w.end;
      else open = { start: w.start, end: w.end };
    } else if (open) {
      ranges.push(open);
      open = null;
    }
  }
  if (open) ranges.push(open);
  return ranges;
}

export function mountTranscriptPane(host: HTMLElement, engine: Engine, player: Player): void {
  const body = host.querySelector<HTMLElement>(".fw-transcript-body");
  if (!body) return;
  body.innerHTML = `
<div class="fw-transcript-tools"><button type="button" class="fw-ibtn fw-btn-export fw-voice-go" data-t="transcribe">Transcribe session</button></div>
<p class="fw-empty-note fw-transcript-state">Transcribe the session, then edit its audio by editing the text.</p>
<div class="fw-transcript-actions" hidden>
  <button type="button" class="fw-ibtn" data-t="delete">Delete selected words</button>
  <button type="button" class="fw-ibtn" data-t="fillers">Remove filler words</button>
  <button type="button" class="fw-ibtn" data-t="gaps">Shorten gaps over ${GAP_OVER} s</button>
</div>
<div class="fw-transcript-text" role="listbox" aria-multiselectable="true" aria-label="Transcript"></div>`;
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const stateLine = body.querySelector<HTMLElement>(".fw-transcript-state");
  const actions = body.querySelector<HTMLElement>(".fw-transcript-actions");
  const text = body.querySelector<HTMLElement>(".fw-transcript-text");
  const transcripts = new Map<string, MediaWord[]>();
  let words: SessionWord[] = [];
  let signature = "";
  let selected = new Set<string>();
  let anchor: string | null = null;
  let current: HTMLElement | null = null;

  const paintSelection = () => {
    for (const span of text?.querySelectorAll<HTMLElement>(".fw-word") ?? []) {
      const on = selected.has(span.dataset.key ?? "");
      if (span.classList.contains("is-selected") !== on) span.classList.toggle("is-selected", on);
      if (span.getAttribute("aria-selected") !== String(on)) span.setAttribute("aria-selected", String(on));
    }
  };

  const render = () => {
    words = sessionWords(engine.get("document"), transcripts);
    const next = words.map((w) => `${w.key}@${w.start}`).join("|");
    if (next !== signature && text) {
      signature = next;
      current = null;
      text.replaceChildren(
        ...words.map((w) => {
          const span = document.createElement("span");
          span.className = w.filler ? "fw-word is-filler" : "fw-word";
          span.dataset.key = w.key;
          span.setAttribute("role", "option");
          span.textContent = w.text;
          return span;
        }),
      );
      const live = new Set(words.map((w) => w.key));
      selected = new Set([...selected].filter((k) => live.has(k)));
    }
    paintSelection();
    const has = transcripts.size > 0;
    if (actions && actions.hidden === has) actions.hidden = !has;
    if (has) setText(stateLine, `${words.length} words · ${words.filter((w) => w.filler).length} fillers · click a word to go there, shift-click to select a run`);
  };

  const follow = () => {
    const at = engine.get("transport").positionSamples;
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].end <= at) lo = mid + 1;
      else if (words[mid].start > at) hi = mid - 1;
      else {
        found = mid;
        break;
      }
    }
    const span = found >= 0 ? text?.querySelector<HTMLElement>(`[data-key="${words[found].key}"]`) ?? null : null;
    if (span === current) return;
    current?.classList.remove("is-current");
    span?.classList.add("is-current");
    current = span;
  };

  const cut = (ranges: { start: number; end: number }[], what: string) => {
    if (!ranges.length) {
      setText(notice, `No ${what} to remove`);
      return;
    }
    const doc = engine.get("document");
    engine.dispatch({ type: "clear-ranges", trackIds: doc.tracks.map((t) => t.id), ranges, ripple: true });
    selected.clear();
    const seconds = ranges.reduce((sum, r) => sum + r.end - r.start, 0) / doc.sampleRate;
    setText(notice, `Removed ${what}: ${seconds.toFixed(2)} s`);
  };

  body.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const word = target.closest<HTMLElement>(".fw-word");
    if (word?.dataset.key) {
      const key = word.dataset.key;
      const index = words.findIndex((w) => w.key === key);
      if (index < 0) return;
      if (e.shiftKey && anchor) {
        const a = words.findIndex((w) => w.key === anchor);
        const [from, to] = a <= index ? [a, index] : [index, a];
        selected = new Set(words.slice(from, to + 1).map((w) => w.key));
      } else if (e.metaKey || e.ctrlKey) {
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        anchor = key;
      } else {
        selected = new Set([key]);
        anchor = key;
        player.seek(words[index].start);
      }
      paintSelection();
      return;
    }
    const action = target.closest<HTMLElement>("[data-t]")?.dataset.t;
    if (action === "delete") cut(rangesOf(words, (w) => selected.has(w.key)), "the selected words");
    else if (action === "fillers") cut(rangesOf(words, (w) => w.filler), "filler words");
    else if (action === "gaps") {
      const rate = engine.get("document").sampleRate;
      const ranges: { start: number; end: number }[] = [];
      for (let i = 0; i + 1 < words.length; i++) {
        const gap = words[i + 1].start - words[i].end;
        if (gap > GAP_OVER * rate) ranges.push({ start: words[i].end + Math.round((GAP_KEEP * rate) / 2), end: words[i + 1].start - Math.round((GAP_KEEP * rate) / 2) });
      }
      cut(ranges, "long gaps");
    } else if (action === "transcribe") {
      const button = target.closest<HTMLButtonElement>("button");
      const ids = [...new Set(engine.get("document").tracks.flatMap((t) => t.clips.map((c) => c.mediaId)))].filter((id) => !transcripts.has(id));
      if (button) button.disabled = true;
      try {
        for (const [n, id] of ids.entries()) {
          setText(stateLine, `Transcribing ${n + 1} of ${ids.length}...`);
          const res = await fetch(`/api/media/${id}/transcript`, { method: "POST" });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; words?: MediaWord[] };
          if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          transcripts.set(id, out.words ?? []);
        }
        render();
        setText(notice, ids.length ? "Transcribed the session" : "The session is already transcribed");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setText(stateLine, message);
        setText(notice, `Could not transcribe: ${message}`);
      } finally {
        if (button) button.disabled = false;
      }
    }
  });

  engine.subscribe("document", render);
  engine.subscribe("transport", follow);
  render();
}
