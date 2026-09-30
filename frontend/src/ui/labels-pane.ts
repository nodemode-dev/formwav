import type { Player } from "../audio/player";
import type { Engine, SessionDoc } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/** A marker (start equals end) or a region, in session samples. */
export interface Label {
  kind: "marker" | "region";
  id: string;
  start: number;
  end: number;
  text: string;
}
type Cue = { start: number; end: number; text: string };
type Dispatchable = Parameters<Engine["dispatch"]>[0];

export function labelsOf(doc: SessionDoc): Label[] {
  return [
    ...doc.markers.map((m): Label => ({ kind: "marker", id: m.id, start: m.at, end: m.at, text: m.label })),
    ...(doc.regions ?? []).map((r): Label => ({ kind: "region", id: r.id, start: r.start, end: r.end, text: r.label })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
export function stamp(seconds: number, sep: "." | ","): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

/** Subtitle cues in seconds: a region as it is; a marker runs to the next label's start, at least 1 s and at most 5 s. */
export function cues(labels: Label[], rate: number): Cue[] {
  return labels.map((l, i) => {
    const start = l.start / rate;
    if (l.kind === "region") return { start, end: l.end / rate, text: l.text };
    const next = labels.slice(i + 1).find((o) => o.start > l.start);
    const room = next ? next.start / rate - start : 5;
    return { start, end: start + Math.min(5, Math.max(1, room)), text: l.text };
  });
}

export const toWebVtt = (labels: Label[], rate: number) =>
  `WEBVTT\n\n${cues(labels, rate).map((c, i) => `${i + 1}\n${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;
export const toSubRip = (labels: Label[], rate: number) =>
  cues(labels, rate).map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
/** Podcasting 2.0 JSON chapters (version 1.2.0). */
export const toChapters = (labels: Label[], rate: number) =>
  JSON.stringify(
    {
      version: "1.2.0",
      chapters: labels.map((l) => ({
        startTime: Math.round((l.start / rate) * 1000) / 1000,
        ...(l.kind === "region" ? { endTime: Math.round((l.end / rate) * 1000) / 1000 } : {}),
        title: l.text,
      })),
    },
    null,
    2,
  );

const TIME = /(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})/;
/** SubRip cues in seconds; blocks without a timing line are skipped. */
export function parseSubRip(text: string): Cue[] {
  const out: Cue[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => TIME.test(line));
    if (at < 0) continue;
    const m = TIME.exec(lines[at]) as RegExpExecArray;
    const t = (h: string, mi: string, s: string, ms: string) => Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000;
    const cueText = lines.slice(at + 1).join("\n").trim();
    out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: cueText || "Region" });
  }
  return out;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountLabelsPane(host: HTMLElement, engine: Engine, player: Player): void {
  const body = host.querySelector<HTMLElement>(".fw-labels-body");
  if (!body) return;
  body.innerHTML = `
<div class="fw-transcript-actions">
  <button type="button" class="fw-ibtn" data-l="marker">Add marker at playhead</button>
  <button type="button" class="fw-ibtn" data-l="region">Add region from range</button>
</div>
<p class="fw-empty-note fw-labels-empty">No labels yet. Add a marker at the playhead, or drag a range with the Smart Tool and add a region.</p>
<div class="fw-labels-list" role="list"></div>
<div class="fw-transcript-actions">
  <button type="button" class="fw-ibtn" data-l="vtt">Export WebVTT</button>
  <button type="button" class="fw-ibtn" data-l="srt">Export SubRip</button>
  <button type="button" class="fw-ibtn" data-l="chapters">Export chapters</button>
  <label class="fw-ibtn fw-file-button">Import SubRip<input type="file" accept=".srt,text/plain" data-l="import" hidden></label>
</div>`;
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const list = body.querySelector<HTMLElement>(".fw-labels-list");
  const empty = body.querySelector<HTMLElement>(".fw-labels-empty");
  let range: { start: number; end: number } | null = null;
  let signature = "";
  host.addEventListener("fw-range", (e) => {
    const d = (e as CustomEvent<{ start: number; end: number } | null>).detail;
    range = d ? { start: d.start, end: d.end } : null;
  });

  const render = () => {
    const doc = engine.get("document");
    const labels = labelsOf(doc);
    if (empty && empty.hidden !== labels.length > 0) empty.hidden = labels.length > 0;
    const next = labels.map((l) => `${l.kind}:${l.id}:${l.start}:${l.end}`).join("|");
    if (next === signature || !list) {
      for (const l of labels) {
        const input = list?.querySelector<HTMLInputElement>(`input[data-id="${l.id}"]`);
        if (input && document.activeElement !== input && input.value !== l.text) input.value = l.text;
      }
      return;
    }
    signature = next;
    list.replaceChildren(
      ...labels.map((l) => {
        const row = document.createElement("div");
        row.className = "fw-label-row";
        row.setAttribute("role", "listitem");
        row.dataset.kind = l.kind;
        const time = document.createElement("button");
        time.type = "button";
        time.className = "fw-label-time";
        time.dataset.seek = String(l.start);
        time.title = "Go to this label";
        time.textContent = l.kind === "region" ? `${stamp(l.start / doc.sampleRate, ".").slice(3)} to ${stamp(l.end / doc.sampleRate, ".").slice(3)}` : stamp(l.start / doc.sampleRate, ".").slice(3);
        const input = document.createElement("input");
        input.type = "text";
        input.className = "fw-label-text";
        input.value = l.text;
        input.dataset.id = l.id;
        input.dataset.kind = l.kind;
        input.setAttribute("aria-label", `${l.kind === "region" ? "Region" : "Marker"} label`);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "fw-ibtn fw-label-remove";
        remove.dataset.remove = l.id;
        remove.dataset.kind = l.kind;
        remove.textContent = "Delete";
        row.append(time, input, remove);
        return row;
      }),
    );
  };

  body.addEventListener("change", async (e) => {
    const el = e.target as HTMLInputElement;
    if (el.classList.contains("fw-label-text") && el.dataset.id) {
      engine.dispatch(el.dataset.kind === "region" ? { type: "set-region", regionId: el.dataset.id, label: el.value } : { type: "set-marker", markerId: el.dataset.id, label: el.value });
    } else if (el.dataset.l === "import" && el.files?.[0]) {
      const parsed = parseSubRip(await el.files[0].text());
      el.value = "";
      if (!parsed.length) {
        setText(notice, "No SubRip cues found in that file");
        return;
      }
      const rate = engine.get("document").sampleRate;
      const commands: Dispatchable[] = parsed.map((c) => ({ type: "add-region", start: c.start * rate, end: c.end * rate, label: c.text }));
      engine.dispatch({ type: "batch", commands } as Dispatchable);
      setText(notice, `Imported ${parsed.length} regions from SubRip`);
    }
  });
  body.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const doc = engine.get("document");
    const seek = target.closest<HTMLElement>("[data-seek]")?.dataset.seek;
    if (seek !== undefined) {
      player.seek(Number(seek));
      return;
    }
    const remove = target.closest<HTMLElement>("[data-remove]");
    if (remove?.dataset.remove) {
      engine.dispatch(remove.dataset.kind === "region" ? { type: "remove-region", regionId: remove.dataset.remove } : { type: "remove-marker", markerId: remove.dataset.remove });
      return;
    }
    const action = target.closest<HTMLElement>("[data-l]")?.dataset.l;
    const labels = labelsOf(doc);
    if (action === "marker") {
      engine.dispatch({ type: "add-marker", at: engine.get("transport").positionSamples, label: `Marker ${doc.markers.length + 1}` });
    } else if (action === "region") {
      if (!range) setText(notice, "Drag a range with the Smart Tool first, then add it as a region");
      else engine.dispatch({ type: "add-region", start: range.start, end: range.end, label: `Region ${(doc.regions ?? []).length + 1}` });
    } else if (action === "vtt" || action === "srt" || action === "chapters") {
      if (!labels.length) {
        setText(notice, "There are no labels to export");
        return;
      }
      if (action === "vtt") download("formwav-labels.vtt", toWebVtt(labels, doc.sampleRate), "text/vtt");
      else if (action === "srt") download("formwav-labels.srt", toSubRip(labels, doc.sampleRate), "application/x-subrip");
      else download("formwav-chapters.json", toChapters(labels, doc.sampleRate), "application/json+chapters");
      setText(notice, `Exported ${labels.length} labels`);
    }
  });

  engine.subscribe("document", render);
  render();
}
