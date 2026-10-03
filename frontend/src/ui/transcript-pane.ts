import type { Player } from "../audio/player";
import type { Engine, MediaRef, SessionDoc } from "../engine";
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
  speaker: string;
  mediaId: string;
  mediaStart: number;
  mediaEnd: number;
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
          speaker: track.name,
          mediaId: clip.mediaId,
          mediaStart: Math.max(s, clip.sourceIn) / media.sampleRate,
          mediaEnd: Math.min(e, srcEnd) / media.sampleRate,
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

const RETAKE_RUN = 4;
const RETAKE_WINDOW = 40;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, "");

/**
 * Retakes, lexically: a run of RETAKE_RUN words said again within RETAKE_WINDOW words means the first attempt was
 * abandoned, so it goes from its first word up to where the retake starts, keeping the last take as Descript does.
 * Four words, not three: a single take can repeat three ("can do for you" ... "can do for your").
 */
function retakeRanges(words: SessionWord[]): { start: number; end: number }[] {
  const n = words.map((w) => norm(w.text));
  const ranges: { start: number; end: number }[] = [];
  let i = 0;
  while (i + RETAKE_RUN <= words.length) {
    let found = -1;
    for (let j = i + RETAKE_RUN; j + RETAKE_RUN <= words.length && j <= i + RETAKE_WINDOW && found < 0; j++) {
      let same = true;
      for (let k = 0; k < RETAKE_RUN && same; k++) same = n[i + k] !== "" && n[i + k] === n[j + k];
      if (same) found = j;
    }
    if (found >= 0) {
      ranges.push({ start: words[i].start, end: words[found].start });
      i = found;
    } else i += 1;
  }
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
  <select data-t-fill="mode" aria-label="What Remove filler words does" title="Cut fillers out of the audio, silence them where they are (timing kept, for picture), or hide them in the transcript only (audio untouched)"><option value="cut">Cut them out</option><option value="silence">Silence them in place</option><option value="hide">Hide them in the transcript only</option></select>
  <label class="fw-sam-opt" title="Fade 10 ms either side of every cut so the joins do not click"><input type="checkbox" data-t-fill="smooth" checked> Smooth cuts</label>
  <button type="button" class="fw-ibtn" data-t="fillers">Remove filler words</button>
  <label class="fw-field"><span>Gaps over</span><input type="number" data-t-gap="over" value="${GAP_OVER}" min="0.1" max="10" step="0.05" aria-label="Shorten gaps longer than, seconds"><span>s</span></label>
  <label class="fw-field"><span>Keep</span><input type="number" data-t-gap="keep" value="${GAP_KEEP}" min="0" max="5" step="0.05" aria-label="Length each shortened gap keeps, seconds"><span>s</span></label>
  <button type="button" class="fw-ibtn" data-t="gaps">Shorten gaps</button>
  <button type="button" class="fw-ibtn" data-t="retakes">Remove retakes</button>
  <button type="button" class="fw-ibtn" data-t="clip">Make a clip from selected words</button>
  <div class="fw-word-timing" hidden><label class="fw-sam-opt"><span>Start</span><input type="number" data-wt="start" step="0.01" min="0" aria-label="The selected word's start in seconds"> s</label><label class="fw-sam-opt"><span>End</span><input type="number" data-wt="end" step="0.01" min="0" aria-label="The selected word's end in seconds"> s</label><button type="button" class="fw-ibtn" data-t="timing" title="Move the selected word's start and end; deleting the word then removes exactly that span">Set word timing</button><label class="fw-sam-opt"><span>Gap after</span><input type="number" data-wt="gap" step="0.05" min="0" aria-label="The gap after the selected word in seconds"> s</label><button type="button" class="fw-ibtn" data-t="gap" title="Shorten the gap to the next word to this length, closing up everything after it">Set gap</button></div>
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

  const timing = body.querySelector<HTMLElement>(".fw-word-timing");
  const field = (k: string) => body.querySelector<HTMLInputElement>(`[data-wt="${k}"]`);
  const paintSelection = () => {
    for (const span of text?.querySelectorAll<HTMLElement>(".fw-word") ?? []) {
      const on = selected.has(span.dataset.key ?? "");
      if (span.classList.contains("is-selected") !== on) span.classList.toggle("is-selected", on);
      if (span.getAttribute("aria-selected") !== String(on)) span.setAttribute("aria-selected", String(on));
    }
    const one = selected.size === 1 ? words.findIndex((w) => selected.has(w.key)) : -1;
    if (timing && timing.hidden === one >= 0) timing.hidden = one < 0;
    if (one < 0) return;
    const rate = engine.get("document").sampleRate;
    const w = words[one];
    const next = words[one + 1];
    const values: [string, string][] = [["start", (w.start / rate).toFixed(3)], ["end", (w.end / rate).toFixed(3)], ["gap", next ? ((next.start - w.end) / rate).toFixed(3) : ""]];
    for (const [k, v] of values) {
      const input = field(k);
      if (input && document.activeElement !== input && input.value !== v) input.value = v;
    }
  };

  const render = () => {
    words = sessionWords(engine.get("document"), transcripts);
    const next = words.map((w) => `${w.key}@${w.start}@${w.speaker}`).join("|");
    if (next !== signature && text) {
      signature = next;
      current = null;
      const several = new Set(words.map((w) => w.speaker)).size > 1;
      const nodes: HTMLElement[] = [];
      words.forEach((w, i) => {
        if (several && (i === 0 || words[i - 1].speaker !== w.speaker)) {
          const label = document.createElement("span");
          label.className = "fw-speaker";
          label.textContent = w.speaker;
          nodes.push(label);
        }
        const span = document.createElement("span");
        span.className = w.filler ? "fw-word is-filler" : "fw-word";
        span.dataset.key = w.key;
        span.setAttribute("role", "option");
        span.textContent = w.text;
        nodes.push(span);
      });
      text.replaceChildren(...nodes);
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

  const cut = (ranges: { start: number; end: number }[], what: string, silence = false) => {
    if (!ranges.length) {
      setText(notice, `No ${what} to remove`);
      return;
    }
    const doc = engine.get("document");
    // DS-04: silencing keeps the timeline (no ripple); Smooth cuts fades 10 ms either side of every join
    const smooth = host.querySelector<HTMLInputElement>('[data-t-fill="smooth"]')?.checked !== false ? Math.round(0.01 * doc.sampleRate) : 0;
    engine.dispatch({ type: "clear-ranges", trackIds: doc.tracks.map((t) => t.id), ranges, ripple: !silence, ...(smooth ? { smooth } : {}) });
    if (silence) {
      selected.clear();
      setText(notice, `Silenced ${what} in place: ${(ranges.reduce((sum, r) => sum + r.end - r.start, 0) / doc.sampleRate).toFixed(2)} s, timing kept`);
      return;
    }
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
    if (action === "timing" || action === "gap") {
      const one = selected.size === 1 ? words.findIndex((w) => selected.has(w.key)) : -1;
      if (one < 0) {
        setText(notice, "Select one word to adjust");
        return;
      }
      const rate = engine.get("document").sampleRate;
      const w = words[one];
      if (action === "gap") {
        const next = words[one + 1];
        const want = Number(field("gap")?.value);
        const gap = next ? next.start - w.end : 0;
        if (!next || !(want >= 0) || want * rate >= gap) {
          setText(notice, next ? `Type a gap shorter than the ${(gap / rate).toFixed(3)} s there now` : "The last word has no gap after it");
          return;
        }
        const keep = Math.round(want * rate);
        cut([{ start: w.end + Math.floor(keep / 2), end: next.start - Math.ceil(keep / 2) }], `part of the gap after "${w.text}", leaving ${want.toFixed(3)} s`);
        return;
      }
      const start = Number(field("start")?.value);
      const end = Number(field("end")?.value);
      if (!(end > start)) {
        setText(notice, "The word must end after it starts");
        return;
      }
      const index = Number(w.key.split(":").pop());
      const res = await fetch(`/api/media/${w.mediaId}/transcript/word`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, start: w.mediaStart + (start - w.start / rate), end: w.mediaEnd + (end - w.end / rate) }),
      });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown; words?: MediaWord[] };
      if (!res.ok || !out.words) {
        setText(notice, `Could not set the word's timing: ${typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`}`);
        return;
      }
      transcripts.set(w.mediaId, out.words);
      render();
      setText(notice, `"${w.text}" now runs from ${start.toFixed(3)} to ${end.toFixed(3)} s`);
      return;
    }
    if (action === "delete") cut(rangesOf(words, (w) => selected.has(w.key)), "the selected words");
    else if (action === "fillers") {
      const mode = host.querySelector<HTMLSelectElement>('[data-t-fill="mode"]')?.value ?? "cut";
      if (mode === "hide") {
        // transcript only: the fillers leave the text, the audio and the session are untouched
        const hide = !text?.classList.contains("is-hiding-fillers");
        text?.classList.toggle("is-hiding-fillers", hide);
        setText(notice, hide ? "Filler words hidden in the transcript; the audio is untouched" : "Filler words shown in the transcript again");
      } else cut(rangesOf(words, (w) => w.filler), "filler words", mode === "silence");
    }
    else if (action === "retakes") cut(retakeRanges(words), "earlier takes");
    else if (action === "clip") {
      const picked = words.filter((w) => selected.has(w.key));
      if (!picked.length) {
        setText(notice, "Select the words to make a clip of");
        return;
      }
      if (new Set(picked.map((w) => w.mediaId)).size > 1) {
        setText(notice, "Select words from one recording to make a clip");
        return;
      }
      const start = Math.min(...picked.map((w) => w.mediaStart));
      const end = Math.max(...picked.map((w) => w.mediaEnd));
      const res = await fetch(`/api/media/${picked[0].mediaId}/excerpt?start=${start}&end=${end}`, { method: "POST" });
      const made = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        setText(notice, `Could not make a clip: ${typeof made.detail === "string" ? made.detail : `the engine answered ${res.status}`}`);
        return;
      }
      const media = made as unknown as MediaRef;
      engine.dispatch({ type: "import-media", media, at: engine.get("transport").positionSamples });
      setText(notice, `Made a ${(end - start).toFixed(2)} s clip of ${picked.length} words on a new track at the playhead`);
    }
    else if (action === "gaps") {
      // DS-05: the threshold and the length kept are chosen (the old fixed 0.75 s and 0.3 s their defaults)
      const field = (key: string, fallback: number) => {
        const v = Number(host.querySelector<HTMLInputElement>(`[data-t-gap="${key}"]`)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fallback;
      };
      const over = Math.max(0.05, field("over", GAP_OVER));
      const keep = Math.min(field("keep", GAP_KEEP), over);
      const rate = engine.get("document").sampleRate;
      const ranges: { start: number; end: number }[] = [];
      for (let i = 0; i + 1 < words.length; i++) {
        const gap = words[i + 1].start - words[i].end;
        if (gap > over * rate) ranges.push({ start: words[i].end + Math.round((keep * rate) / 2), end: words[i + 1].start - Math.round((keep * rate) / 2) });
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
