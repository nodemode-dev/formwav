import type { Player } from "../audio/player";
import type { Engine, MediaRef, SessionDoc } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";
import { download } from "./labels-pane";
import { subtitleCues, toSubRip, toWebVtt } from "./subtitles";

/** A word in its media file's own seconds, as the engine's transcript returns it. */
interface MediaWord {
  text: string;
  start: number;
  end: number;
  filler: boolean;
  /** DS-12, RX-59: the speaker told apart inside the recording, when asked for. */
  speaker?: string;
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
          speaker: w.speaker ?? track.name,
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
/** DS-07: phrases are runs of words ended by a pause of RETAKE_PAUSE seconds (a restart leaves a gap; rhetoric that
 *  repeats itself, "ask not what your country can do for you, ask what you can do for your country", runs on without
 *  one and stays one phrase). Pauses only: the model's punctuation is not evidence (on spliced takes it wrote "Ask,
 *  not. What your country", and a split at that period kept the takes from ever being compared). */
const RETAKE_PAUSE = 0.3;
function phraseSpans(words: SessionWord[], rate: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let from = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (!next || next.start - w.end >= RETAKE_PAUSE * rate) {
      spans.push({ from, to: i });
      from = i + 1;
    }
  });
  return spans;
}
/** Shared words (counted as often as both say them) over the longer phrase, and over the shorter. */
function overlap(a: string[], b: string[]): { ofLonger: number; ofShorter: number } {
  const count = new Map<string, number>();
  for (const t of a) count.set(t, (count.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of b) {
    const c = count.get(t) ?? 0;
    if (c > 0) {
      shared++;
      count.set(t, c - 1);
    }
  }
  return { ofLonger: shared / Math.max(a.length, b.length, 1), ofShorter: shared / Math.max(1, Math.min(a.length, b.length)) };
}
/**
 * Retakes (DS-07). Phrases within three of each other are takes of one another when they share 70% of their words
 * (repeated, or reworded) or the shorter, of four words or more, is 90% inside the longer (a take abandoned partway).
 * In each group the best take stays: the most complete (its distinct words against the group's most), less a point
 * for each filler, a quarter more for ending a sentence, the last take winning a tie as Descript keeps it. Each other take goes from its first word to the next word kept. Then, as
 * before, a run of RETAKE_RUN words said again within RETAKE_WINDOW words drops the earlier attempt (a restart inside
 * one phrase); four words, not three, as a single take can repeat three ("can do for you" ... "can do for your").
 */
function retakeRanges(words: SessionWord[], rate: number): { start: number; end: number }[] {
  const n = words.map((w) => norm(w.text));
  const gone = new Set<number>();
  const spans = phraseSpans(words, rate);
  const tokens = spans.map((s) => n.slice(s.from, s.to + 1).filter((t) => t !== ""));
  const grouped = new Set<number>();
  for (let a = 0; a < spans.length; a++) {
    if (grouped.has(a) || tokens[a].length < 3) continue;
    const group = [a];
    for (let b = a + 1; b < spans.length && b <= group[group.length - 1] + 3; b++) {
      if (grouped.has(b) || tokens[b].length < 3) continue;
      const o = overlap(tokens[group[group.length - 1]], tokens[b]);
      if (o.ofLonger >= 0.7 || (Math.min(tokens[group[group.length - 1]].length, tokens[b].length) >= 4 && o.ofShorter >= 0.9)) group.push(b);
    }
    if (group.length < 2) continue;
    const most = Math.max(...group.map((g) => new Set(tokens[g]).size));
    const score = (g: number, order: number) => {
      const s = spans[g];
      const fillers = words.slice(s.from, s.to + 1).filter((w) => w.filler).length;
      return (2 * new Set(tokens[g]).size) / most - fillers + (/[.?!]$/.test(words[s.to].text.trim()) ? 0.25 : 0) + 0.01 * order;
    };
    const best = group.reduce((x, g, order) => (score(g, order) > score(x, group.indexOf(x)) ? g : x), group[0]);
    for (const g of group) {
      grouped.add(g);
      if (g !== best) for (let i = spans[g].from; i <= spans[g].to; i++) gone.add(i);
    }
  }
  let i = 0;
  while (i + RETAKE_RUN <= words.length) {
    let found = -1;
    for (let j = i + RETAKE_RUN; j + RETAKE_RUN <= words.length && j <= i + RETAKE_WINDOW && found < 0; j++) {
      let same = true;
      for (let k = 0; k < RETAKE_RUN && same; k++) same = n[i + k] !== "" && n[i + k] === n[j + k] && !gone.has(i + k) && !gone.has(j + k);
      if (same) found = j;
    }
    if (found >= 0) {
      // judged like the phrase takes: the earlier attempt [i, found) against the retake; the better stays, the last on a
      // tie. (The model can stretch a word over the pause between takes, so takes can arrive here as one phrase.) The
      // retake is found by alignment, not by pauses (a speaker pauses inside a take, "Ask, not."): the words it shares
      // in order with the earlier attempt, then on while its words still come from it, short of a full second's stop
      // and at most two words longer than the earlier attempt
      let common = 0;
      while (found + common < words.length && i + common < found && n[i + common] === n[found + common]) common++;
      let later = found + common - 1;
      const earlierWords = new Set(n.slice(i, found));
      while (later + 1 < words.length && later + 1 <= found + (found - i) + 2 && !gone.has(later + 1) && earlierWords.has(n[later + 1]) && words[later + 1].start - words[later].end < rate) later++;
      const toks = (a: number, b: number) => n.slice(a, b + 1).filter((t) => t !== "");
      const most = Math.max(new Set(toks(i, found - 1)).size, new Set(toks(found, later)).size, 1);
      const judge = (a: number, b: number, order: number) =>
        (2 * new Set(toks(a, b)).size) / most - words.slice(a, b + 1).filter((w) => w.filler).length + (/[.?!]$/.test(words[b].text.trim()) ? 0.25 : 0) + 0.01 * order;
      if (judge(i, found - 1, 0) > judge(found, later, 1)) {
        for (let k = found; k <= later; k++) gone.add(k);
        i = later + 1;
      } else {
        for (let k = i; k < found; k++) gone.add(k);
        i = found;
      }
    } else i += 1;
  }
  // each removed run goes from its first word to the next word kept (its trailing pause with it)
  const ranges: { start: number; end: number }[] = [];
  for (let k = 0; k < words.length; k++) {
    if (!gone.has(k)) continue;
    let e = k;
    while (e + 1 < words.length && gone.has(e + 1)) e++;
    ranges.push({ start: words[k].start, end: e + 1 < words.length ? words[e + 1].start : words[e].end });
    k = e;
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
  <button type="button" class="fw-ibtn" data-t="delete">Delete selected words</button><button type="button" class="fw-ibtn" data-t="move" title="Move the selected words, and their audio on every track, to the text cursor (click between words to place it; double-click a word to correct its text)">Move to cursor</button>
  <span class="fw-share"><select data-share="layout" aria-label="Video layout"><option value="square">Square 1:1</option><option value="portrait">Portrait 9:16</option><option value="landscape">Landscape 16:9</option></select><input type="text" data-share="title" maxlength="80" placeholder="Title" aria-label="Title on the video"><button type="button" class="fw-ibtn" data-t="share" title="A video of the selected words (or the whole session) with its waveform, the title and the words as captions, to post or send">Share as video</button></span>
  <select data-t-fill="mode" aria-label="What Remove filler words does" title="Cut fillers out of the audio, silence them where they are (timing kept, for picture), or hide them in the transcript only (audio untouched)"><option value="cut">Cut them out</option><option value="silence">Silence them in place</option><option value="hide">Hide them in the transcript only</option></select>
  <label class="fw-sam-opt" title="Fade 10 ms either side of every cut so the joins do not click"><input type="checkbox" data-t-fill="smooth" checked> Smooth cuts</label>
  <button type="button" class="fw-ibtn" data-t="fillers">Remove filler words</button>
  <label class="fw-field"><span>Gaps over</span><input type="number" data-t-gap="over" value="${GAP_OVER}" min="0.1" max="10" step="0.05" aria-label="Shorten gaps longer than, seconds"><span>s</span></label>
  <label class="fw-field"><span>Keep</span><input type="number" data-t-gap="keep" value="${GAP_KEEP}" min="0" max="5" step="0.05" aria-label="Length each shortened gap keeps, seconds"><span>s</span></label>
  <button type="button" class="fw-ibtn" data-t="gaps">Shorten gaps</button>
  <button type="button" class="fw-ibtn" data-t="retakes">Remove retakes</button><button type="button" class="fw-ibtn" data-t="speakers" title="Tell the speakers apart inside each transcribed recording, by their voices, and label the words">Tell speakers apart</button>
  <button type="button" class="fw-ibtn" data-t="clip">Make a clip from selected words</button>
  <button type="button" class="fw-ibtn" data-t="srt" title="The transcript as subtitles in session time: 42 characters a line, two lines a cue, fillers left out">Subtitles (SubRip)</button><button type="button" class="fw-ibtn" data-t="vtt" title="The same subtitles as WebVTT">Subtitles (WebVTT)</button>
  <div class="fw-word-timing" hidden><label class="fw-sam-opt"><span>Start</span><input type="number" data-wt="start" step="0.01" min="0" aria-label="The selected word's start in seconds"> s</label><label class="fw-sam-opt"><span>End</span><input type="number" data-wt="end" step="0.01" min="0" aria-label="The selected word's end in seconds"> s</label><button type="button" class="fw-ibtn" data-t="timing" title="Move the selected word's start and end; deleting the word then removes exactly that span">Set word timing</button><label class="fw-sam-opt"><span>Gap after</span><input type="number" data-wt="gap" step="0.05" min="0" aria-label="The gap after the selected word in seconds"> s</label><button type="button" class="fw-ibtn" data-t="gap" title="Shorten the gap to the next word to this length, closing up everything after it">Set gap</button></div>
</div>
<div class="fw-transcript-text" role="listbox" aria-multiselectable="true" aria-label="Transcript"></div>`;
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const stateLine = body.querySelector<HTMLElement>(".fw-transcript-state");
  const actions = body.querySelector<HTMLElement>(".fw-transcript-actions");
  const text = body.querySelector<HTMLElement>(".fw-transcript-text");
  const transcripts = new Map<string, MediaWord[]>();
  let words: SessionWord[] = [];
  // DS-01: a text cursor between words, as the index of the word it stands before (words.length: after the last)
  let caret: number | null = null;
  const caretEl = document.createElement("span");
  caretEl.className = "fw-caret";
  caretEl.setAttribute("aria-hidden", "true");
  const placeCaret = () => {
    const box = text;
    if (caret === null || caret < 0 || caret > words.length || !box) {
      caret = null;
      caretEl.remove();
      return;
    }
    const before = caret < words.length ? box.querySelector<HTMLElement>(`.fw-word[data-key="${CSS.escape(words[caret].key)}"]`) : null;
    if (caretEl.parentElement !== box || caretEl.nextSibling !== before) box.insertBefore(caretEl, before);
  };
  // DS-01: Left and Right move the cursor a word at a time while the transcript has focus
  if (text && !text.hasAttribute("tabindex")) text.setAttribute("tabindex", "0");
  text?.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !words.length) return;
    e.preventDefault();
    caret = Math.max(0, Math.min(words.length, (caret ?? words.length) + (e.key === "ArrowLeft" ? -1 : 1)));
    placeCaret();
  });
  // DS-01, typed corrections: double-click a word to correct its text in the engine's transcript (the audio untouched);
  // Enter or leaving the field keeps it, Escape cancels
  body.addEventListener("dblclick", (e) => {
    // the word double-clicked, or the one selected (the double-click's first click selects it)
    const hit = (e.target as HTMLElement).closest<HTMLElement>(".fw-word");
    const key = hit?.dataset.key ?? (selected.size === 1 ? [...selected][0] : undefined);
    const span = key && text ? (hit ?? text.querySelector<HTMLElement>(`.fw-word[data-key="${CSS.escape(key)}"]`)) : null;
    const w = words.find((x) => x.key === span?.dataset.key);
    if (!span || !w) return;
    const input = document.createElement("input");
    input.className = "fw-word-edit";
    input.value = w.text;
    input.size = Math.max(3, w.text.length + 1);
    input.setAttribute("aria-label", "Corrected word: Enter keeps it, Escape cancels");
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (keep: boolean) => {
      if (done) return;
      done = true;
      input.replaceWith(span);
      const value = input.value.trim();
      if (!keep || !value || value === w.text) return;
      const res = await fetch(`/api/media/${w.mediaId}/transcript/word`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: Number(w.key.split(":").pop()), start: w.mediaStart, end: w.mediaEnd, text: value }),
      });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown; words?: MediaWord[] };
      if (!res.ok || !out.words) {
        setText(notice, `Could not correct the word: ${typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`}`);
        return;
      }
      transcripts.set(w.mediaId, out.words);
      render();
      setText(notice, `Corrected "${w.text}" to "${value}"; the audio is unchanged`);
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") void finish(true);
      else if (ev.key === "Escape") void finish(false);
    });
    // the double-click's first click selected the word and moved the playhead, which can take focus away at once; a
    // blur in the field's first 300 ms is that, not the user leaving it
    const opened = performance.now();
    input.addEventListener("blur", () => {
      if (performance.now() - opened < 300) input.focus();
      else void finish(true);
    });
  });
  let signature = "";
  let selected = new Set<string>();
  let anchor: string | null = null;
  let current: HTMLElement | null = null;

  const timing = body.querySelector<HTMLElement>(".fw-word-timing");
  const field = (k: string) => body.querySelector<HTMLInputElement>(`[data-wt="${k}"]`);
  // DS-11: an edge dragged in the lanes lands here as session samples; it fills Start or End and applies them through
  // the timing action (kept between the neighbours there, as typed values are)
  document.addEventListener("fw-word-edge", (e) => {
    const { edge, at } = (e as CustomEvent<{ edge: "start" | "end"; at: number }>).detail;
    const input = field(edge);
    if (!input || selected.size !== 1) return;
    input.value = (at / engine.get("document").sampleRate).toFixed(3);
    body.querySelector<HTMLButtonElement>('[data-t="timing"]')?.click();
  });
  const paintSelection = () => {
    for (const span of text?.querySelectorAll<HTMLElement>(".fw-word") ?? []) {
      const on = selected.has(span.dataset.key ?? "");
      if (span.classList.contains("is-selected") !== on) span.classList.toggle("is-selected", on);
      if (span.getAttribute("aria-selected") !== String(on)) span.setAttribute("aria-selected", String(on));
    }
    const one = selected.size === 1 ? words.findIndex((w) => selected.has(w.key)) : -1;
    if (timing && timing.hidden === one >= 0) timing.hidden = one < 0;
    // DS-11: the lanes draw the selected word's span with edges to drag (null clears it)
    const span = one >= 0 ? { mediaId: words[one].mediaId, start: words[one].start, end: words[one].end } : null;
    const key = JSON.stringify(span);
    if (host.dataset.wordSpan !== key) {
      host.dataset.wordSpan = key;
      document.dispatchEvent(new CustomEvent("fw-word-span", { detail: span }));
    }
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
    const next = words.map((w) => `${w.key}@${w.start}@${w.speaker}@${w.text}`).join("|");
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
    placeCaret();
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
    if (target === text && words.length) {
      // DS-01: a click between words places the text cursor before the first word after the click (reading order)
      const me = e as MouseEvent;
      const spans = [...text.querySelectorAll<HTMLElement>(".fw-word")];
      const k = spans.findIndex((s) => {
        const r = s.getBoundingClientRect();
        return r.top > me.clientY || (r.bottom >= me.clientY && r.left + r.width / 2 > me.clientX);
      });
      caret = k < 0 ? words.length : k;
      selected.clear();
      paintSelection();
      placeCaret();
      setText(notice, `Cursor ${caret < words.length ? `before "${words[caret].text}"` : "after the last word"}: select words and Move to cursor to put them here`);
      return;
    }
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
    if (action === "srt" || action === "vtt") {
      // the comparison's Captions row: the transcript as a subtitle file, its cues in session time
      const cues = subtitleCues(words, engine.get("document").sampleRate);
      if (!cues.length) {
        setText(notice, "No transcribed words to make subtitles from.");
        return;
      }
      if (action === "srt") download("formwav-transcript.srt", toSubRip(cues), "application/x-subrip");
      else download("formwav-transcript.vtt", toWebVtt(cues), "text/vtt");
      setText(notice, `Subtitles: ${cues.length} cues, ${action === "srt" ? "SubRip" : "WebVTT"}.`);
      return;
    }
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
        if (!next || !(want >= 0)) {
          setText(notice, next ? "Type the gap you want after this word, in seconds" : "The last word has no gap after it");
          return;
        }
        if (Math.round(want * rate) > gap) {
          // DS-11, lengthened: silence inserted at the gap's middle, inside the pause, on every track, one undo step
          const doc = engine.get("document");
          engine.dispatch({ type: "insert-time", trackIds: doc.tracks.map((t) => t.id), at: Math.round(w.end + gap / 2), length: Math.round(want * rate) - gap });
          setText(notice, `Lengthened the gap after the word to ${want.toFixed(3)} s`);
          return;
        }
        if (Math.round(want * rate) === gap) return;
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
    if (action === "speakers") {
      // DS-12, RX-59: each transcribed recording's speakers told apart by the engine, the words labelled
      setText(notice, "Telling the speakers apart...");
      try {
        for (const mediaId of transcripts.keys()) {
          const res = await fetch(`/api/media/${mediaId}/transcript/speakers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const out = (await res.json().catch(() => ({}))) as { detail?: unknown; words?: MediaWord[] };
          if (!res.ok || !out.words) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
          transcripts.set(mediaId, out.words);
        }
        render();
        const found = new Set(words.map((w) => w.speaker)).size;
        setText(notice, `Found ${found} speaker${found === 1 ? "" : "s"}`);
      } catch (err) {
        setText(notice, `Could not tell the speakers apart: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    if (action === "share") {
      // DS-08: the selected words' span (0.2 s either side) or the whole session as a captioned waveform video
      const doc = engine.get("document");
      const rate = doc.sampleRate;
      const picked = words.filter((w) => selected.has(w.key));
      const length = Math.max(0, ...doc.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)));
      const span = picked.length ? { start: Math.max(0, picked[0].start - 0.2 * rate), end: Math.min(length, picked[picked.length - 1].end + 0.2 * rate) } : { start: 0, end: length };
      const layout = host.querySelector<HTMLSelectElement>('[data-share="layout"]')?.value ?? "square";
      const title = host.querySelector<HTMLInputElement>('[data-share="title"]')?.value ?? "";
      setText(notice, "Making the video...");
      const res = await fetch("/api/share/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: doc, words: words.map((w) => ({ text: w.text, start: w.start / rate, end: w.end / rate })), layout, title, start: span.start / rate, end: span.end / rate }),
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
        setText(notice, `Could not make the video: ${typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`}`);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `formwav-${layout}.mp4`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setText(notice, `Video ready: ${layout}, ${((span.end - span.start) / rate).toFixed(1)} s with captions`);
      return;
    }
    if (action === "move") {
      // DS-01, moving words: the selected run (first to last selected word) to the cursor, audio on every track
      const picked = words.map((w, i) => i).filter((i) => selected.has(words[i].key));
      if (!picked.length || caret === null) {
        setText(notice, "Select the words to move, then click between words to place the cursor");
        return;
      }
      const first = picked[0];
      const last = picked[picked.length - 1];
      if (caret > first && caret <= last + 1) {
        setText(notice, "Put the cursor outside the selected words");
        return;
      }
      const doc = engine.get("document");
      const to = caret < words.length ? words[caret].start : words[words.length - 1].end;
      engine.dispatch({ type: "move-range", trackIds: doc.tracks.map((t) => t.id), start: words[first].start, end: words[last].end, to });
      selected.clear();
      caret = null;
      setText(notice, `Moved ${last - first + 1} word${last === first ? "" : "s"} to the cursor`);
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
    else if (action === "retakes") cut(retakeRanges(words, engine.get("document").sampleRate), "retakes (the best take kept)");
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
