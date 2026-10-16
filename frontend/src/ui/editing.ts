/**
 * PLAN_v13 S4's editing commands in the interface: the Edit menu's Duplicate, Repeat, Shift, Insert silence, the trims,
 * Separate on the grid, Heal, Strip silence and the time operations; the View menu's zoom to the selection, zoom
 * presets and Big Counter; the Transport menu's Tab to transients; their keys; and one small dialog for the values a
 * command asks for. Each command is built by engine/editing.ts from the lanes' range or selected clips (their own
 * events) and dispatched as one undo step.
 */
import type { Command, Engine } from "../engine";
import type { Player } from "../audio/player";
import { FADE_SHAPES, laneAt, nextMemoryNumber, type Clip, type FadeShape, type MediaRef, type Track } from "../engine/document";
import { clipGainToVolume, glideLane, thinLane, volumeToClipGain, writeLane } from "../engine/automation";
import { clipTransients, consolidate, createFades, deleteFades, editSpan, fadeToPlayhead, findMemory, healSeparations, insertSilence, lockClips, muteClips, nextMemory, nextStop, nudgeClips, repeatSpan, separateOnGrid, shiftClips, snapClips, spaceClips, stripGaps, timeOperation, trimToFile, trimToFill, trimToPlayhead, trimToRange, type EditRange, type EditTarget, type MemoryLocation } from "../engine/editing";
import { gridStepOf, NUDGE_DEFAULT, parseGrid } from "../engine/grid";
import { setText } from "../vendor/nodemode/dom-stable";
import { mountBigCounter } from "./big-counter";
import { commands } from "./commands";
import { frameRate, gridCuts, shuffleEnabled } from "./grid";
import { getZoom, samplesPerPixel, setZoom, zoomToSpan } from "./lanes";

type Field = { key: string; label: string; value: number | string | null; min?: number; max?: number; step?: number; unit?: string; placeholder?: string; options?: [string, string][]; text?: boolean };
type Values = Record<string, number | string | null>;
const num = (v: Values | null, key: string): number | null => (v && typeof v[key] === "number" ? (v[key] as number) : null);
const str = (v: Values | null, key: string): string => (v && typeof v[key] === "string" ? (v[key] as string) : "");

const PRESETS_KEY = "formwav.zoomPresets";
const DEFAULT_PRESETS = [0.25, 1, 8, 64, 1024];

export function mountEditing(host: HTMLElement, engine: Engine, player: Player): void {
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  const say = (text: string) => setText(notice, text);

  let range: EditRange | null = null;
  let clipIds: readonly string[] = [];
  host.addEventListener("fw-range", (e) => {
    const d = (e as CustomEvent<EditRange | null>).detail;
    range = d && d.end > d.start ? { trackId: d.trackId, start: d.start, end: d.end, ...(d.more?.length ? { more: [...d.more] } : {}) } : null;
  });
  host.addEventListener("fw-selection", (e) => {
    clipIds = (e as CustomEvent<string[]>).detail ?? [];
  });
  const allClipIds = () => new Set(engine.get("document").tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const target = (): EditTarget => {
    const live = allClipIds();
    return { range, clipIds: clipIds.filter((id) => live.has(id)) };
  };
  const run = (command: Command | null, done: string, none: string): boolean => {
    if (!command) {
      say(none);
      return false;
    }
    if (!engine.dispatch(command) && engine.get("document").tracks.some((t) => t.clips.some((c) => c.lock))) {
      say("A locked clip is in the way: Clip > Edit lock or Time lock unlocks it");
      return false;
    }
    say(done);
    return true;
  };
  const selectClips = (ids: string[]) => host.dispatchEvent(new CustomEvent("fw-select-clips", { detail: ids }));
  const setRange = (next: EditRange | null) => host.dispatchEvent(new CustomEvent("fw-set-range", { detail: next }));
  const rate = () => engine.get("document").sampleRate;
  const seconds = (n: number) => `${(n / rate()).toFixed(3)} s`;

  // One small dialog for the values a command asks for; Enter confirms, Escape or Cancel gives up, and each command's
  // last values come back the next time it asks
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog fw-ask-dialog";
  dialog.innerHTML = `<form method="dialog"><h2 class="fw-dialog-title"></h2><p class="fw-ask-note"></p><div class="fw-ask-fields"></div><div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="cancel">Cancel</button><button type="submit" class="fw-ibtn fw-btn-export" value="ok">OK</button></div></form>`;
  host.append(dialog);
  const remembered = new Map<string, Values>();
  let settle: ((values: Values | null) => void) | null = null;
  dialog.addEventListener("close", () => {
    if (dialog.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const done = settle;
    settle = null;
    if (!done) return;
    if (dialog.returnValue !== "ok") {
      done(null);
      return;
    }
    const values: Values = {};
    for (const input of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]")) {
      const n = Number(input.value);
      values[input.dataset.k ?? ""] = input instanceof HTMLSelectElement || input.type === "text" ? input.value : input.value.trim() === "" || !Number.isFinite(n) ? null : n;
    }
    remembered.set(dialog.dataset.ask ?? "", values);
    done(values);
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && /^(INPUT|SELECT)$/.test((e.target as HTMLElement).tagName)) {
      e.preventDefault();
      // the field gives up focus now: left in the closed dialog until the browser moves it, it took the next key,
      // which then reached no shortcut
      (e.target as HTMLElement).blur();
      dialog.close("ok");
    }
  });
  const ask = (title: string, note: string, fields: Field[], ok: string): Promise<Values | null> =>
    new Promise((resolve) => {
      settle?.(null);
      const last = remembered.get(title) ?? {};
      dialog.dataset.ask = title;
      setText(dialog.querySelector(".fw-dialog-title"), title);
      setText(dialog.querySelector(".fw-ask-note"), note);
      setText(dialog.querySelector('button[value="ok"]'), ok);
      dialog.querySelector(".fw-ask-fields")?.replaceChildren(
        ...fields.map((f) => {
          const label = document.createElement("label");
          label.className = "fw-ask-field";
          const input = f.options
            ? Object.assign(document.createElement("select"), { innerHTML: f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("") })
            : Object.assign(document.createElement("input"), f.text ? { type: "text", maxLength: 500, placeholder: f.placeholder ?? "" } : { type: "number", step: String(f.step ?? "any"), placeholder: f.placeholder ?? "" });
          input.dataset.k = f.key;
          if (input instanceof HTMLInputElement && f.min !== undefined) input.min = String(f.min);
          if (input instanceof HTMLInputElement && f.max !== undefined) input.max = String(f.max);
          const value = f.key in last && !f.text ? last[f.key] : f.value;
          input.value = value === null ? "" : String(value);
          label.append(Object.assign(document.createElement("span"), { textContent: f.label }), input, Object.assign(document.createElement("span"), { textContent: f.unit ?? "" }));
          return label;
        }),
      );
      settle = resolve;
      dialog.returnValue = "";
      dialog.showModal();
      const first = dialog.querySelector<HTMLInputElement | HTMLSelectElement>("[data-k]");
      if (first instanceof HTMLInputElement) first.select();
      else first?.focus();
    });
  // S7: other modules (the note editor's Event menu) ask through the same dialog with an fw-ask event
  host.addEventListener("fw-ask", (e) => {
    const d = (e as CustomEvent<{ title: string; note: string; fields: Field[]; ok: string; done: (values: Values | null) => void }>).detail;
    void ask(d.title, d.note, d.fields, d.ok).then(d.done);
  });

  const duplicate = () => {
    const doc = engine.get("document");
    const t = target();
    const before = allClipIds();
    if (!run(repeatSpan(doc, t, 1, shuffleEnabled()), t.range ? "Duplicated the range after itself" : "Duplicated the clips after themselves", "Select clips or a range to duplicate")) return;
    // the selection moves onto the copy, as Pro Tools' does, so a second Duplicate carries on from it
    if (t.range) setRange({ trackId: t.range.trackId, start: t.range.end, end: 2 * t.range.end - t.range.start });
    else selectClips([...allClipIds()].filter((id) => !before.has(id)));
  };
  const repeat = async () => {
    if (!editSpan(engine.get("document"), target())) {
      say("Select clips or a range to repeat");
      return;
    }
    const v = await ask("Repeat", "Copies placed end to end after the selection.", [{ key: "count", label: "Copies", value: 2, min: 1, max: 999, step: 1 }], "Repeat");
    const n = num(v, "count");
    if (n === null) return;
    run(repeatSpan(engine.get("document"), target(), Math.round(n), shuffleEnabled()), `Repeated the selection ${Math.round(n)} times`, "Type from 1 to 999 copies");
  };
  const shift = async () => {
    if (!target().clipIds.length) {
      say("Select the clips to shift");
      return;
    }
    const v = await ask("Shift", "The selected clips move later, or earlier for a negative amount.", [{ key: "by", label: "By", value: 1, step: 0.001, unit: "s" }], "Shift");
    const by = num(v, "by");
    if (by === null) return;
    run(shiftClips(engine.get("document"), target().clipIds, by * rate()), `Shifted the clips ${by >= 0 ? "later" : "earlier"} by ${Math.abs(by).toFixed(3)} s`, "The clips are already at the start");
  };
  const spanOrLoop = () => {
    const doc = engine.get("document");
    const span = editSpan(doc, target());
    if (span) return { start: span.start, end: span.end };
    return doc.loop && doc.loop.end > doc.loop.start ? { start: doc.loop.start, end: doc.loop.end } : null;
  };
  const timeOp = (kind: "insert" | "cut") => {
    const span = spanOrLoop();
    if (!span) {
      say(`Select a range, clips or the loop for the time to ${kind}`);
      return;
    }
    if (run(timeOperation(engine.get("document"), kind, span.start, span.end), kind === "insert" ? `Inserted ${seconds(span.end - span.start)} at ${seconds(span.start)} on every track` : `Cut ${seconds(span.end - span.start)} at ${seconds(span.start)} from every track`, "There are no tracks"))
      if (kind === "cut") setRange(null);
  };
  const needRange = (fn: (r: EditRange) => Command | null, done: string, none: string) => () => {
    if (!range) {
      say("Draw a range first: drag in a clip's upper half");
      return;
    }
    run(fn(range), done, none);
  };
  const playhead = () => engine.get("transport").positionSamples;
  const stripSilence = async () => {
    const doc = engine.get("document");
    const t = target();
    const picked = doc.tracks.flatMap((tr) => tr.clips.filter((c) => t.clipIds.includes(c.id)).map((c) => ({ trackId: tr.id, clip: c })));
    const scope = t.range ?? (picked.length ? { trackId: picked[0].trackId, start: Math.min(...picked.filter((p) => p.trackId === picked[0].trackId).map((p) => p.clip.start)), end: Math.max(...picked.filter((p) => p.trackId === picked[0].trackId).map((p) => p.clip.start + p.clip.length)) } : null);
    if (!scope) {
      say("Select clips or a range on the track to strip");
      return;
    }
    const v = await ask(
      "Strip silence",
      "Removes what lies below the threshold for at least the minimum length; leave the threshold empty to take it from the track's loud level.",
      [
        { key: "threshold", label: "Threshold", value: null, min: -96, max: 0, step: 1, unit: "dB", placeholder: "auto" },
        { key: "minimum", label: "Minimum length", value: 300, min: 1, max: 10000, step: 1, unit: "ms" },
        { key: "before", label: "Pad before", value: 5, min: 0, max: 1000, step: 1, unit: "ms" },
        { key: "after", label: "Pad after", value: 20, min: 0, max: 1000, step: 1, unit: "ms" },
      ],
      "Strip",
    );
    if (!v) return;
    const threshold = num(v, "threshold");
    const q = new URLSearchParams({ trackId: scope.trackId, gap: String(Math.max(0.001, (num(v, "minimum") ?? 300) / 1000)) });
    if (threshold !== null) q.set("threshold", String(Math.min(0, Math.max(-96, threshold))));
    say("Finding the silences...");
    try {
      const res = await fetch(`/api/render/activity?${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(engine.get("document")) });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown; regions?: [number, number][] };
      if (!res.ok || !out.regions) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const gaps = stripGaps(out.regions, rate(), scope.start, scope.end, Math.max(0, num(v, "before") ?? 0) / 1000, Math.max(0, num(v, "after") ?? 0) / 1000);
      const command: Command | null = gaps.length ? { type: "batch", label: "Stripped silence", commands: [{ type: "clear-ranges", trackIds: [scope.trackId], ranges: gaps, ripple: false }] } : null;
      const stripped = run(command, `Stripped ${gaps.length} silent stretch${gaps.length === 1 ? "" : "es"}`, "No silence to strip at that threshold and length");
      // what was selected stays selected as the pieces that remain of it, as Pro Tools leaves them
      if (stripped && !t.range) selectClips((engine.get("document").tracks.find((tr) => tr.id === scope.trackId)?.clips ?? []).filter((c) => c.start < scope.end && c.start + c.length > scope.start).map((c) => c.id));
    } catch (err) {
      say(`Could not strip: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // PLAN_v13 S6: Consolidate and Commit have the engine render the track (services/bounce.py) and place what comes back
  const bounceTrack = async (params: Record<string, string>): Promise<MediaRef> => {
    const res = await fetch(`/api/render/bounce?${new URLSearchParams(params)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(engine.get("document")) });
    const out = (await res.json().catch(() => ({}))) as { detail?: unknown; id?: string };
    if (!res.ok || !out.id) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return out as unknown as MediaRef;
  };
  const consolidateSelection = async () => {
    const t = target();
    const span = editSpan(engine.get("document"), t);
    if (!span) return say("Select a range, or clips on one track, to consolidate");
    if (span.trackIds.length !== 1) return say("Consolidate works on one track at a time: select clips on one track");
    const trackId = span.trackIds[0];
    say("Consolidating...");
    try {
      const media = await bounceTrack({ trackId, mode: "clips", start: String(span.start), end: String(span.end) });
      if (!run(consolidate(engine.get("document"), trackId, span.start, span.end, media), `Consolidated ${seconds(span.end - span.start)} into one clip`, "Nothing to consolidate there")) return;
      if (!t.range) selectClips((engine.get("document").tracks.find((tr) => tr.id === trackId)?.clips ?? []).filter((c) => c.mediaId === media.id && c.start === span.start).map((c) => c.id));
    } catch (err) {
      say(`Could not consolidate: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Tab and Shift Tab, while the lanes have focus (a click in them gives it): the playhead to the next or last clip edge
  // on the selected clips' tracks (the range's, else every track), and with Tab to transients on, to each transient too
  let toTransients = false;
  const transients = new Map<string, Promise<{ rate: number; seconds: number[] } | null>>();
  const transientsOf = (mediaId: string) => {
    let found = transients.get(mediaId);
    if (!found) {
      found = fetch(`/api/media/${encodeURIComponent(mediaId)}/transients`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rate: number; seconds: number[] }>) : null))
        .catch(() => null);
      transients.set(mediaId, found);
    }
    return found;
  };
  const tabTo = async (direction: 1 | -1) => {
    const doc = engine.get("document");
    const t = target();
    const trackIds = t.clipIds.length ? doc.tracks.filter((tr) => tr.clips.some((c) => t.clipIds.includes(c.id))).map((tr) => tr.id) : t.range ? [t.range.trackId] : null;
    const extra: number[] = [];
    if (toTransients) {
      for (const tr of doc.tracks) {
        if (trackIds && !trackIds.includes(tr.id)) continue;
        for (const c of tr.clips) {
          const found = await transientsOf(c.mediaId);
          if (found) extra.push(...clipTransients(doc, c, found.seconds, found.rate));
        }
      }
    }
    const at = nextStop(engine.get("document"), trackIds, playhead(), direction, extra);
    if (at === null) return;
    player.seek(at);
    say(`Playhead at ${seconds(at)}`);
  };

  // Zoom presets 1 to 5 (Pro Tools' zoom presets): a key or the View menu's button recalls one, with Shift stores the
  // zoom in view in it; kept on this machine
  let presets = [...DEFAULT_PRESETS];
  try {
    const saved = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "null") as unknown;
    if (Array.isArray(saved) && saved.length === 5 && saved.every((z) => typeof z === "number" && z > 0)) presets = saved as number[];
  } catch {
    presets = [...DEFAULT_PRESETS];
  }
  const preset = (n: number, store: boolean) => {
    if (store) {
      presets[n] = getZoom();
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
      } catch {
        say("Zoom presets are kept until the page closes: this browser does not store them");
      }
      say(`Zoom preset ${n + 1} stored`);
      return;
    }
    setZoom(presets[n]);
    say(`Zoom preset ${n + 1}`);
  };
  const zoomToSelection = () => {
    const span = spanOrLoop();
    if (!span) {
      say("Select a range, clips or the loop to zoom to");
      return;
    }
    zoomToSpan(engine.get("document"), span.start, span.end);
  };
  const separateGrid = () => {
    const doc = engine.get("document");
    const step = gridCuts(doc.sampleRate, doc.sampleRate / samplesPerPixel(doc));
    run(separateOnGrid(doc, target(), step), typeof step === "number" ? `Separated on the grid every ${seconds(step)}` : "Separated on the grid", target().range || target().clipIds.length ? "No grid line inside the selection (or the grid is too fine): zoom out" : "Select clips or a range to separate");
  };
  const counter = mountBigCounter(host, engine);

  // The menus' items, each running its command (the menu closes after any item, as the menu bar's do)
  const item = (label: string, key: string, title: string, act: () => void, checked?: () => boolean, onChange?: (sync: () => void) => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fw-ibtn";
    b.setAttribute("role", checked ? "menuitemcheckbox" : "menuitem");
    b.title = title;
    b.innerHTML = `<span class="fw-check" aria-hidden="true"></span><span></span>${key ? `<kbd>${key}</kbd>` : ""}`;
    (b.children[1] as HTMLElement).textContent = label;
    b.addEventListener("click", act);
    if (checked) {
      const sync = () => {
        const on = String(checked());
        if (b.getAttribute("aria-checked") !== on) b.setAttribute("aria-checked", on);
      };
      sync();
      onChange?.(sync);
    }
    return b;
  };
  const sep = () => Object.assign(document.createElement("span"), { className: "fw-menu-sep" });
  const proxied = (pop: string, action: string) => [...host.querySelectorAll<HTMLElement>(`${pop} [data-proxy]`)].find((b) => b.dataset.proxy?.includes(`"${action}"`)) ?? null;
  proxied(".fw-edit-pop", "redo")?.after(
    sep(),
    item("Duplicate", "⌘D", "Copy the selected clips or range right after themselves (over what lies there; with Shuffle, opening time for the copy)", duplicate),
    item("Repeat...", "⌥R", "Copy the selection end to end a number of times", () => void repeat()),
    item("Paste special: merge notes", "", "Add the copied note clip's notes into the note clip under the playhead, keeping what is there", () => host.dispatchEvent(new CustomEvent("fw-paste-merge"))),
    item("Paste special: repeat to fill selection", "", "Lay the copied clips end to end across the range from its start, the last copy cut at its end", () => host.dispatchEvent(new CustomEvent("fw-paste-repeat"))),
    item("Shift...", "⌥H", "Move the selected clips later or earlier by an amount", () => void shift()),
    item("Insert silence", "", "Open the range's length of silence at its start on its track, moving what follows later", () => run(insertSilence(engine.get("document"), target()), "Inserted silence", "Select a range or clips for the silence's place and length")),
    sep(),
    item("Trim to selection", "⌥T", "Keep only what lies inside the range of the clips it crosses", needRange((r) => trimToRange(engine.get("document"), r), "Trimmed to the selection", "No clip crosses the range's edges")),
    item("Trim start to playhead", "", "Cut the start of the selected clips under the playhead back to it", () => run(trimToPlayhead(engine.get("document"), target(), playhead(), "start"), "Trimmed the start to the playhead", "Put the playhead inside a selected clip")),
    item("Trim end to playhead", "", "Cut the end of the selected clips under the playhead back to it", () => run(trimToPlayhead(engine.get("document"), target(), playhead(), "end"), "Trimmed the end to the playhead", "Put the playhead inside a selected clip")),
    item("Trim to file edges", "", "Open the selected clips out to their whole files", () => run(trimToFile(engine.get("document"), target().clipIds), "Trimmed to the files' edges", "Select clips that do not already show their whole file")),
    item("Trim to fill selection", "", "Stretch the edges of the clips in the range out to the range, as far as their files reach", needRange((r) => trimToFill(engine.get("document"), r), "Trimmed to fill the selection", "No clip in the range can reach further")),
    sep(),
    item("Separate on the grid", "", "Split the selected clips, or those in the range, at every grid line", separateGrid),
    item("Heal separation", "", "Join clips split from one another back into one (in the range, the selected clips, or at the playhead)", () => run(healSeparations(engine.get("document"), target(), playhead()), "Healed the separation", "No split clips to heal there")),
    item("Consolidate", "⌥⇧3", "Render what plays in the range, or across the selected clips, into one clip in their place", () => void consolidateSelection()),
    item("Strip silence...", "", "Remove the silent stretches from the selected clips or the range, with a threshold, minimum length and pads", () => void stripSilence()),
    sep(),
    item("Insert time on every track", "", "Open the selection's length of time at its start on every track, moving markers, regions, the loop and automation after it", () => timeOp("insert")),
    item("Cut time from every track", "", "Remove the selection's time from every track, closing the gap and moving markers, regions, the loop and automation with it", () => timeOp("cut")),
  );

  const presetRow = document.createElement("div");
  presetRow.className = "fw-menu-zoom";
  presetRow.setAttribute("role", "group");
  presetRow.setAttribute("aria-label", "Zoom presets");
  presetRow.append(
    ...[0, 1, 2, 3, 4].map((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fw-ibtn";
      b.setAttribute("role", "menuitem");
      b.textContent = String(n + 1);
      b.title = `Zoom preset ${n + 1} (key ${n + 1}); Shift-click or Shift ${n + 1} stores the zoom in view`;
      b.addEventListener("click", (e) => preset(n, e.shiftKey));
      return b;
    }),
  );
  proxied(".fw-view-pop", "agent")?.after(
    sep(),
    item("Zoom to selection", "", "Zoom so the range, the selected clips or the loop fill the view", zoomToSelection),
    Object.assign(document.createElement("span"), { className: "fw-menu-label", textContent: "Zoom presets" }),
    presetRow,
    item("Big counter", "", "The playhead's position in large figures on a panel of its own", counter.toggle, counter.isOpen, (sync) => counter.onChange(sync)),
    item("Counters and rulers...", "", "The main and sub counters' timebases, the session's timecode rate and the rulers shown", () => host.dispatchEvent(new CustomEvent("fw-counters"))),
  );
  // PLAN_v13 S13, Commands Focus: single keys for the editing commands (Pro Tools' a-z button): A and S trim the start
  // and end to the playhead, D and G fade in to and out from it, F makes fades, B separates at it, P and ; move the
  // range up and down a track, L and ' tab back and on to clip edges; kept on this machine
  const FOCUS_KEY = "formwav.commandsFocus";
  let focusKeys = false;
  try {
    focusKeys = localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    focusKeys = false;
  }
  const focusListeners = new Set<() => void>();
  const runLabel = (label: string) => {
    const c = commands.all().find((x) => x.label === label);
    if (c) void commands.call(c.id);
  };
  const separateAtPlayhead = () => {
    const doc = engine.get("document");
    const at = playhead();
    const ids = target().clipIds;
    const track = trackNow();
    const list = doc.tracks.flatMap((t) => t.clips.filter((c) => (ids.length ? ids.includes(c.id) : t.id === track?.id) && at > c.start && at < c.start + c.length).map((c) => ({ type: "split-clip" as const, trackId: t.id, clipId: c.id, at })));
    if (!list.length) return say("No clip under the playhead to separate");
    engine.dispatch(list.length > 1 ? { type: "batch", commands: list } : list[0]);
  };
  const moveRange = (by: 1 | -1) => {
    if (!range) return say("Draw a range first: P and ; move it up and down a track");
    const shown = engine.get("document").tracks.filter((t) => !t.hidden);
    const next = shown[shown.findIndex((t) => t.id === range?.trackId) + by];
    if (next) setRange({ trackId: next.id, start: range.start, end: range.end });
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "?" && !dialog.open) {
        e.preventDefault();
        host.dispatchEvent(new CustomEvent("fw-shortcuts"));
        return;
      }
      if (!focusKeys) return;
      if (dialog.open || !engine.get("document").tracks.length) return;
      const act: Record<string, () => void> = {
        a: () => runLabel("Trim start to playhead"),
        s: () => runLabel("Trim end to playhead"),
        d: () => runLabel("Fade in to playhead"),
        g: () => runLabel("Fade out from playhead"),
        f: () => runLabel("Create fades"),
        b: separateAtPlayhead,
        p: () => moveRange(-1),
        ";": () => moveRange(1),
        l: () => void tabTo(-1),
        "'": () => void tabTo(1),
      };
      const fn = act[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fn();
    },
    true,
  );
  proxied(".fw-view-pop", "agent")?.after(
    item(
      "Commands Focus",
      "",
      "Single keys for editing: A and S trim to the playhead, D and G fade to it, F makes fades, B separates, P and ; move the range a track, L and ' tab to clip edges",
      () => {
        focusKeys = !focusKeys;
        try {
          localStorage.setItem(FOCUS_KEY, focusKeys ? "1" : "0");
        } catch {
          say("Commands Focus stays on until the page closes: this browser does not store it");
        }
        say(focusKeys ? "Commands Focus on: single keys edit (A S D G F B P ; L ')" : "Commands Focus off");
        for (const fn of focusListeners) fn();
      },
      () => focusKeys,
      (sync) => focusListeners.add(sync),
    ),
    item("Keyboard shortcuts", "?", "Every command with a key, by menu, and the Commands Focus keys", () => host.dispatchEvent(new CustomEvent("fw-shortcuts"))),
  );
  const tabListeners = new Set<() => void>();
  host.querySelector(".fw-transport-pop")?.append(
    sep(),
    item(
      "Tab to transients",
      "",
      "With the lanes in focus, Tab and Shift Tab stop at each transient as well as at clip edges",
      () => {
        toTransients = !toTransients;
        for (const fn of tabListeners) fn();
      },
      () => toTransients,
      (sync) => tabListeners.add(sync),
    ),
  );

  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (dialog.open || !engine.get("document").tracks.length) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate();
    } else if (e.altKey && !mod && !e.shiftKey && (e.code === "KeyR" || e.code === "KeyH" || e.code === "KeyT")) {
      e.preventDefault();
      if (e.code === "KeyR") void repeat();
      else if (e.code === "KeyH") void shift();
      else needRange((r) => trimToRange(engine.get("document"), r), "Trimmed to the selection", "No clip crosses the range's edges")();
    } else if (e.key === "Tab" && !mod && !e.altKey && stage && document.activeElement === stage) {
      e.preventDefault();
      void tabTo(e.shiftKey ? -1 : 1);
    } else if (!mod && !e.altKey && /^Digit[1-5]$/.test(e.code)) {
      e.preventDefault();
      preset(Number(e.code.slice(5)) - 1, e.shiftKey);
    }
  });

  // PLAN_v13 S5, editing depth: the Track and Clip menus, nudge, fades from a selection and memory locations. The track a
  // Track command acts on is the one picked last: a click on its head or an empty stretch of it, a clip on it, a range
  let current: string | null = null;
  let latest: "track" | "clips" | "range" = "clips";
  host.addEventListener("fw-track", (e) => {
    current = (e as CustomEvent<string>).detail;
    latest = "track";
  });
  host.addEventListener("fw-range", (e) => {
    if ((e as CustomEvent<unknown>).detail) latest = "range";
  });
  host.addEventListener("fw-selection", (e) => {
    if (((e as CustomEvent<string[]>).detail ?? []).length) latest = "clips";
  });
  const trackNow = (): Track | null => {
    const doc = engine.get("document");
    const t = target();
    const ofClips = doc.tracks.find((tr) => tr.clips.some((c) => t.clipIds.includes(c.id)))?.id;
    const order = latest === "track" ? [current, t.range?.trackId, ofClips] : latest === "range" ? [t.range?.trackId, ofClips, current] : [ofClips, t.range?.trackId, current];
    const id = order.find((x) => x && doc.tracks.some((tr) => tr.id === x));
    return doc.tracks.find((tr) => tr.id === id) ?? null;
  };
  const onTrack = (fn: (track: Track) => void) => () => {
    const track = trackNow();
    if (track) fn(track);
    else say("Click a track's name, or select a clip or a range on it, first");
  };
  const moveTrack = (by: 1 | -1) =>
    onTrack((track) => {
      const doc = engine.get("document");
      const at = doc.tracks.indexOf(track);
      if (at + by < 0 || at + by >= doc.tracks.length) return say(`${track.name} is already the ${by < 0 ? "first" : "last"} track`);
      engine.dispatch({ type: "move-track", trackId: track.id, to: at + by });
      say(`Moved ${track.name} ${by < 0 ? "up" : "down"}`);
    });
  const heights = ["small", "medium", "large", "jumbo"] as const;
  const trackListeners = new Set<() => void>();
  const syncTracks = () => {
    for (const fn of trackListeners) fn();
  };
  engine.subscribe("document", syncTracks);
  host.addEventListener("fw-track", syncTracks);
  host.addEventListener("fw-selection", () => queueMicrotask(syncTracks));
  host.addEventListener("fw-range", () => queueMicrotask(syncTracks));
  const comments = onTrack(async (track) => {
    const v = await ask("Track comments", `Notes kept with ${track.name}, shown when the pointer rests on its name.`, [{ key: "text", label: "Comments", value: track.comments ?? "", text: true, placeholder: "Mic, take notes, anything" }], "Keep");
    if (!v) return;
    engine.dispatch({ type: "set-track-comments", trackId: track.id, comments: str(v, "text") });
    say(str(v, "text").trim() ? `Comments kept with ${track.name}` : `Cleared the comments of ${track.name}`);
  });
  const commitTrack = onTrack(async (track) => {
    if (track.surround) return say(`Take ${track.name} off the surround pad to commit it`);
    say(`Committing ${track.name}...`);
    try {
      const media = await bounceTrack({ trackId: track.id, mode: "track" });
      run({ type: "commit-track", trackId: track.id, media, length: media.frames }, `Committed ${track.name}: ${track.name}.cm plays it as it was; the original is inactive and hidden`, "");
    } catch (err) {
      say(`Could not commit: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const groupOf = (track: Track) => (engine.get("document").groups ?? []).find((g) => g.trackIds.includes(track.id));
  const groupTracks = async () => {
    const doc = engine.get("document");
    const ids = target().clipIds;
    const picked = new Set([...doc.tracks.filter((t) => t.clips.some((c) => ids.includes(c.id))).map((t) => t.id), ...(range ? [range.trackId, ...(range.more ?? [])] : [])]);
    if (picked.size < 2) return say("Select clips or a range on two tracks or more to group them");
    const v = await ask("Group tracks", `${picked.size} tracks move together as the group links them; Track > Group active suspends it.`, [
      { key: "name", label: "Name", value: `Group ${(doc.groups?.length ?? 0) + 1}`, text: true },
      { key: "links", label: "Links", value: "all", options: [["all", "Volume, mute, solo and editing"], ["mix", "Volume, mute and solo"], ["volume", "Volume only"], ["edit", "Editing only"]] },
    ], "Group");
    if (!v) return;
    const links = String(v.links);
    const mix = links === "all" || links === "mix";
    engine.dispatch({ type: "set-group", group: { id: `g${Date.now().toString(36)}`, name: str(v, "name"), trackIds: [...picked], volume: mix || links === "volume", mute: mix, solo: mix, edit: links === "all" || links === "edit", active: true } });
    say(`Grouped ${picked.size} tracks`);
  };
  const commitTracks = async () => {
    const doc = engine.get("document");
    const ids = target().clipIds;
    let tracks = doc.tracks.filter((t) => !t.inactive && t.clips.some((c) => ids.includes(c.id)));
    const busId = trackNow()?.busId;
    if (tracks.length < 2 && busId) tracks = doc.tracks.filter((t) => !t.inactive && t.busId === busId);
    tracks = tracks.filter((t) => !t.surround);
    if (!tracks.length) return say("Select clips on the tracks to commit, or click a track in a folder to commit the folder");
    const commands: { type: "commit-track"; trackId: string; media: MediaRef; length: number }[] = [];
    try {
      for (const [n, track] of tracks.entries()) {
        say(`Committing ${track.name} (${n + 1} of ${tracks.length})...`);
        const media = await bounceTrack({ trackId: track.id, mode: "track" });
        commands.push({ type: "commit-track", trackId: track.id, media, length: media.frames });
      }
    } catch (err) {
      return say(`Could not commit: ${err instanceof Error ? err.message : String(err)}`);
    }
    engine.dispatch({ type: "batch", commands, label: `Committed ${commands.length} track${commands.length === 1 ? "" : "s"}` });
    say(`Committed ${commands.length} track${commands.length === 1 ? "" : "s"}: one Undo takes them all back`);
  };
  // S9: automation edits, each one undo step in its own words
  const autoBatch = (track: Track, commands: Command[], label: string, none: string) => {
    if (!commands.length) return say(none);
    engine.dispatch({ type: "batch", commands, label: `${label} on ${track.name}` });
    say(`${label} on ${track.name}`);
  };
  const thin = onTrack((track) => {
    const commands: Command[] = [];
    for (const [param, tol] of [["volume", 0.5], ["pan", 0.02], ["trim", 0.5]] as const) {
      const lane = track.automation?.[param] ?? [];
      const thinned = thinLane(lane, tol);
      if (thinned.length < lane.length) commands.push({ type: "set-automation", trackId: track.id, param, points: thinned });
    }
    autoBatch(track, commands, "Thinned automation", `${track.name}'s automation has no point to spare`);
  });
  const rangeOn = (track: Track) => (range && range.trackId === track.id ? range : null);
  const glide = onTrack((track) => {
    const r = rangeOn(track);
    if (!r) return say("Select a range on the track first: drag in a clip's upper half");
    autoBatch(track, [{ type: "set-automation", trackId: track.id, param: "volume", points: glideLane(track.automation?.volume ?? [], r.start, r.end, track.gainDb) }], "Glided the volume", "");
  });
  const writeFader = onTrack((track) => {
    const r = rangeOn(track);
    if (!r) return say("Select a range on the track first: drag in a clip's upper half");
    const lane = track.automation?.volume ?? [];
    const value = laneAt(lane, engine.get("transport").positionSamples, track.gainDb);
    autoBatch(track, [{ type: "set-automation", trackId: track.id, param: "volume", points: writeLane(lane, r.start, r.end, value, track.gainDb) }], "Wrote the volume", "");
  });
  const toClipGain = onTrack((track) => autoBatch(track, volumeToClipGain(track), "Moved the volume into clip gain", `${track.name} has no volume to move`));
  const toVolume = onTrack((track) => autoBatch(track, clipGainToVolume(track), "Moved clip gain into the volume", `${track.name} has no clips`));
  const trackPop = host.querySelector(".fw-track-pop");
  trackPop?.append(
    item("New track", "", "Add an empty stereo track at the bottom", () => engine.dispatch({ type: "add-track" })),
    item("Duplicate", "⌥⇧D", "A copy of the track right below it: its clips, playlists, effects, automation, sends and routing", onTrack((track) => {
      engine.dispatch({ type: "duplicate-track", trackId: track.id });
      say(`Duplicated ${track.name}`);
    })),
    item("Move up", "", "Move the track one place up, in the lanes and the mixer", moveTrack(-1)),
    item("Move down", "", "Move the track one place down, in the lanes and the mixer", moveTrack(1)),
    sep(),
    item("Hide", "", "Hide the track from the lanes and the mixer; it still plays", onTrack((track) => {
      engine.dispatch({ type: "set-tracks-hidden", trackIds: [track.id], hidden: true });
      if (current === track.id) current = null;
      say(`Hid ${track.name}; Track > Show hidden tracks brings it back`);
    })),
    item("Show hidden tracks", "", "Show every hidden track again", () => {
      const ids = engine.get("document").tracks.filter((t) => t.hidden).map((t) => t.id);
      if (!ids.length) return say("No track is hidden");
      engine.dispatch({ type: "set-tracks-hidden", trackIds: ids, hidden: false });
      say(`Showed ${ids.length} hidden track${ids.length === 1 ? "" : "s"}`);
    }),
    item(
      "Inactive",
      "",
      "Stop the track playing and exporting, keeping it as it is (again to make it active)",
      onTrack((track) => {
        engine.dispatch({ type: "set-tracks-inactive", trackIds: [track.id], inactive: !track.inactive });
        say(track.inactive ? `Made ${track.name} active` : `Made ${track.name} inactive: it neither plays nor exports`);
      }),
      () => !!trackNow()?.inactive,
      (sync) => trackListeners.add(sync),
    ),
    item("Commit", "⌥⇧C", "Render the track through its fader and effects onto a new track below it, and make the original inactive and hidden", () => void commitTrack()),
    item("Commit selected tracks", "", "Commit every track with a selected clip, or every track in the clicked track's folder, as one step", () => void commitTracks()),
    sep(),
    item("Group selected tracks...", "", "Link the tracks with a selected clip or range: their faders, mutes and solos move together, and an edit on one edits them all", () => void groupTracks()),
    item("Ungroup", "", "Take the clicked track's group apart", onTrack((track) => {
      const g = groupOf(track);
      if (!g) return say(`${track.name} is in no group`);
      engine.dispatch({ type: "remove-group", groupId: g.id });
      say(`Ungrouped ${g.name}`);
    })),
    item(
      "Group active",
      "",
      "Suspend or resume the clicked track's group, keeping its tracks",
      onTrack((track) => {
        const g = groupOf(track);
        if (!g) return say(`${track.name} is in no group`);
        engine.dispatch({ type: "set-group", group: { ...g, active: !g.active } });
        say(g.active ? `Suspended ${g.name}` : `Resumed ${g.name}`);
      }),
      () => { const t = trackNow(); return !!t && !!groupOf(t)?.active; },
      (sync) => trackListeners.add(sync),
    ),
    sep(),
    item("Thin automation", "", "Remove the volume, pan and trim points the lines can do without (within 0.5 dB)", thin),
    item("Glide the volume across the selection", "", "A straight line across the selected range from the volume at its start to the volume at its end", glide),
    item("Write the volume across the selection", "", "The volume at the playhead written across the selected range", writeFader),
    item("Volume automation to clip gain", "", "Write the track's volume (its lane or its fader) into each clip's gain line and set the fader to 0 dB", toClipGain),
    item("Clip gain to volume automation", "", "Write each clip's gain and gain line into the track's volume lane and set the clips to 0 dB", toVolume),
    sep(),
    Object.assign(document.createElement("span"), { className: "fw-menu-label", textContent: "Height" }),
    ...heights.map((h) =>
      item(
        h[0].toUpperCase() + h.slice(1),
        "",
        `Make the track ${h}`,
        onTrack((track) => engine.dispatch({ type: "set-track-height", trackId: track.id, height: h })),
        () => (trackNow()?.height ?? "medium") === h && !!trackNow(),
        (sync) => trackListeners.add(sync),
      ),
    ),
    sep(),
    item("Comments...", "", "Notes kept with the track", () => void comments()),
  );

  const clipsNow = () => target().clipIds;
  const firstClip = () => {
    const doc = engine.get("document");
    const id = clipsNow()[0];
    for (const t of doc.tracks) for (const c of t.clips) if (c.id === id) return { track: t, clip: c };
    return null;
  };
  const rename = async () => {
    const hit = firstClip();
    if (!hit) return say("Select the clip to rename");
    const doc = engine.get("document");
    const shown = hit.clip.name ?? (doc.media[hit.clip.mediaId]?.name ?? "").replace(/\.[a-z0-9]+$/i, "");
    const v = await ask("Rename clip", "A name for this clip alone; leave it empty to show its file's name again.", [{ key: "name", label: "Name", value: shown, text: true }], "Rename");
    if (!v) return;
    engine.dispatch({ type: "rename-clip", trackId: hit.track.id, clipId: hit.clip.id, name: str(v, "name") });
    say(str(v, "name").trim() ? `Renamed the clip ${str(v, "name").trim()}` : "The clip shows its file's name again");
  };
  const space = async () => {
    if (clipsNow().length < 2) return say("Select two or more clips on a track to space");
    const v = await ask(
      "Space clips",
      "The selected clips one after another from the first, this far apart.",
      [
        { key: "gap", label: "Gap", value: 0, step: 0.001, unit: "s" },
        { key: "mode", label: "From", value: "end", options: [["end", "each end to the next start"], ["start", "each start to the next start"]] },
      ],
      "Space",
    );
    const gap = num(v, "gap");
    if (gap === null) return;
    run(spaceClips(engine.get("document"), clipsNow(), Math.round(gap * rate()), str(v, "mode") === "start"), `Spaced the clips ${gap.toFixed(3)} s apart`, "The clips are already spaced so (or locked)");
  };
  const nudgeBy = () => {
    const doc = engine.get("document");
    const g = parseGrid(doc.snap?.nudge ?? NUDGE_DEFAULT) ?? parseGrid(NUDGE_DEFAULT);
    return g ? gridStepOf(doc, g, frameRate()) : rate() / 10;
  };
  const nudge = (direction: 1 | -1) => {
    const by = nudgeBy() * direction;
    if (clipsNow().length) {
      run(nudgeClips(engine.get("document"), clipsNow(), by), `Nudged the clips ${direction > 0 ? "later" : "earlier"} by ${seconds(Math.abs(by))}`, "The clips are at the start already, or locked");
      return;
    }
    if (range) {
      const start = Math.max(0, Math.round(range.start + by));
      setRange({ trackId: range.trackId, start, end: start + range.end - range.start });
      say(`Nudged the range ${direction > 0 ? "later" : "earlier"}`);
      return;
    }
    say("Select clips or a range to nudge");
  };
  const fadeShapes = Object.keys(FADE_SHAPES).map((s): [string, string] => [s, s[0].toUpperCase() + s.slice(1).replace("-", " ")]);
  const makeFades = async () => {
    if (!range) return say("Draw a range across a clip's edge or a join between two clips first");
    const v = await ask("Create fades", "A fade-in or fade-out where the range crosses a clip's edge, a crossfade where it crosses a join between two clips.", [{ key: "shape", label: "Shape", value: "equal-power", options: fadeShapes }], "Create");
    if (!v || !range) return;
    run(createFades(engine.get("document"), range, (str(v, "shape") || "equal-power") as FadeShape), "Created fades", "The range crosses no clip's edge or join");
  };
  // PLAN_v13 S13: clip gain bypassed, copied and pasted, or rendered into the audio
  const chosen = () => {
    const ids = new Set(clipsNow());
    return engine.get("document").tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((clip) => ({ trackId: t.id, clip })));
  };
  let gainCopy: { gainDb: number; envelope: { at: number; db: number }[] } | null = null;
  const bypassGain = () => {
    const picked = chosen();
    if (!picked.length) return say("Select the clips whose clip gain to bypass");
    const bypass = !picked[0].clip.gainBypass;
    engine.dispatch({ type: "set-clips-gain-bypass", clipIds: picked.map((p) => p.clip.id), bypass });
    say(bypass ? `Bypassed the clip gain of ${picked.length} clip${picked.length === 1 ? "" : "s"}` : "Clip gain back on");
  };
  const copyGain = () => {
    const first = chosen()[0];
    if (!first) return say("Select the clip whose clip gain to copy");
    const c = first.clip;
    gainCopy = { gainDb: c.gainDb, envelope: (c.envelope ?? []).map((p) => ({ at: p.at - c.sourceIn, db: p.db })) };
    say(`Copied the clip gain: ${c.gainDb > 0 ? "+" : ""}${c.gainDb.toFixed(1)} dB${gainCopy.envelope.length ? ` and ${gainCopy.envelope.length} points` : ""}`);
  };
  const pasteGain = () => {
    const picked = chosen();
    if (!gainCopy) return say("Copy a clip's gain first (Clip > Copy clip gain)");
    if (!picked.length) return say("Select the clips to paste the clip gain onto");
    const copy = gainCopy;
    const list: Command[] = picked.flatMap(({ trackId, clip }) => [
      { type: "set-clip-gain", trackId, clipId: clip.id, gainDb: copy.gainDb },
      { type: "set-clip-envelope", trackId, clipId: clip.id, points: copy.envelope.filter((p) => p.at <= clip.length).map((p) => ({ at: p.at + clip.sourceIn, db: p.db })) },
    ]);
    engine.dispatch({ type: "batch", commands: list, label: `Pasted clip gain onto ${picked.length} clip${picked.length === 1 ? "" : "s"}` });
  };
  const renderGain = async () => {
    const picked = chosen().filter(({ clip }) => clip.gainDb !== 0 || clip.envelope?.length);
    if (!picked.length) return say("Select clips with clip gain or a gain line to render");
    say(`Rendering the clip gain of ${picked.length} clip${picked.length === 1 ? "" : "s"}...`);
    const list: Command[] = [];
    try {
      for (const { trackId, clip } of picked) {
        const res = await fetch(`/api/media/${encodeURIComponent(clip.mediaId)}/clip-gain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gainDb: clip.gainBypass ? 0 : clip.gainDb, envelope: clip.gainBypass ? [] : clip.envelope ?? [] }) });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `the engine answered ${res.status}`);
        const media = (await res.json()) as MediaRef;
        list.push({ type: "set-clip-media", trackId, clipId: clip.id, media }, { type: "set-clip-gain", trackId, clipId: clip.id, gainDb: 0 }, { type: "set-clip-envelope", trackId, clipId: clip.id, points: [] });
        if (clip.gainBypass) list.push({ type: "set-clips-gain-bypass", clipIds: [clip.id], bypass: false });
      }
    } catch (err) {
      return say(`Could not render the clip gain: ${err instanceof Error ? err.message : String(err)}`);
    }
    engine.dispatch({ type: "batch", commands: list, label: `Rendered clip gain on ${picked.length} clip${picked.length === 1 ? "" : "s"}` });
    say(`Rendered the clip gain of ${picked.length} clip${picked.length === 1 ? "" : "s"}: the audio now carries it, at 0 dB`);
  };
  // PLAN_v13 S13, clip group files: the selected clips (a whole group when any member is selected) with their media as
  // one .fwclips file; importing one lays its clips at the playhead from the current track down, as one new group
  const exportClips = async () => {
    const doc = engine.get("document");
    const picked = new Set(clipsNow());
    const groups = new Set(doc.tracks.flatMap((t) => t.clips.filter((c) => picked.has(c.id) && c.groupId).map((c) => c.groupId)));
    const tracks = doc.tracks.map((t) => ({ name: t.name, clips: t.clips.filter((c) => picked.has(c.id) || (c.groupId && groups.has(c.groupId))) })).filter((t) => t.clips.length);
    if (!tracks.length) return say("Select the clips (or one clip of a group) to keep as a file");
    const used = new Set(tracks.flatMap((t) => t.clips.map((c) => c.mediaId)));
    const media = Object.fromEntries(Object.entries(doc.media).filter(([id]) => used.has(id)));
    const res = await fetch("/api/projects/clips-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sampleRate: doc.sampleRate, media, tracks }) });
    if (!res.ok) return say(`Could not keep the clips: ${((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${tracks[0].clips[0].name ?? tracks[0].name}.fwclips` });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(`Kept ${tracks.reduce((n, t) => n + t.clips.length, 0)} clips from ${tracks.length} track${tracks.length === 1 ? "" : "s"} as a file`);
  };
  const clipsInput = Object.assign(document.createElement("input"), { type: "file", accept: ".fwclips", hidden: true });
  clipsInput.className = "fw-clips-file";
  host.append(clipsInput);
  clipsInput.addEventListener("change", async () => {
    const file = clipsInput.files?.[0];
    clipsInput.value = "";
    if (!file) return;
    const res = await fetch("/api/projects/clips-file/open", { method: "POST", body: file });
    if (!res.ok) return say(`Could not bring the clips in: ${((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? res.status}`);
    const group = (await res.json()) as { sampleRate: number; media: Record<string, MediaRef>; tracks: { name: string; clips: Omit<Clip, "id">[] }[] };
    let doc = engine.get("document");
    const start = Math.max(0, doc.tracks.findIndex((t) => t.id === trackNow()?.id));
    const missing = Math.max(0, start + group.tracks.length - doc.tracks.length);
    if (missing) engine.dispatch({ type: "batch", commands: group.tracks.slice(group.tracks.length - missing).map((t) => ({ type: "add-track" as const, name: t.name })), label: "Added tracks for the clips" });
    doc = engine.get("document");
    const origin = Math.min(...group.tracks.flatMap((t) => t.clips.map((c) => c.start)));
    const groupId = `g${Date.now().toString(36)}`;
    const commands: Command[] = [];
    for (const [i, t] of group.tracks.entries()) {
      const target = doc.tracks[start + i];
      for (const c of t.clips) commands.push({ type: "paste-clip", trackId: target.id, clip: { ...c, start: playhead() + c.start - origin, groupId }, media: group.media[c.mediaId] });
    }
    engine.dispatch({ type: "batch", commands, label: `Brought in ${file.name.replace(/\.fwclips$/, "")}` });
    say(`Brought in ${group.tracks.reduce((n, t) => n + t.clips.length, 0)} clips at the playhead as a group`);
  });
  const clipPop = host.querySelector(".fw-clip-pop");
  clipPop?.append(
    item("Mute or unmute", "", "Silence the selected clips in playback and export, keeping them in place (again to unmute)", () => run(muteClips(engine.get("document"), clipsNow()), "Muted or unmuted the clips", "Select the clips to mute")),
    item("Edit lock", "", "Keep the selected clips from any edit but their gain (again to unlock)", () => run(lockClips(engine.get("document"), clipsNow(), "edit"), "Changed the clips' edit lock", "Select the clips to lock")),
    item("Time lock", "", "Keep the selected clips where they are in time; they can still be trimmed (again to unlock)", () => run(lockClips(engine.get("document"), clipsNow(), "time"), "Changed the clips' time lock", "Select the clips to lock")),
    item("Rename...", "", "A name for the selected clip alone", () => void rename()),
    sep(),
    item("Export clips as a file...", "", "Keep the selected clips (a whole group when one of its clips is selected) and their audio as a .fwclips file", () => void exportClips()),
    item("Import a clips file...", "", "Bring in a .fwclips file at the playhead, from the current track down, as one group", () => clipsInput.click()),
    sep(),
    item("Bypass clip gain", "", "Play the selected clips at 0 dB with no gain line, keeping both (again to bring them back)", bypassGain),
    item("Copy clip gain", "", "Keep the first selected clip's gain and gain line to paste onto others", copyGain),
    item("Paste clip gain", "", "Give the selected clips the copied gain and gain line, from each clip's start", pasteGain),
    item("Render clip gain", "", "Write the selected clips' gain and gain line into their audio, as new media; they then play the same at 0 dB", () => void renderGain()),
    sep(),
    item("Space clips...", "", "Set the selected clips one after another, a gap apart", () => void space()),
    item("Snap to previous", "", "Move each selected clip so its start meets the end of the clip before it", () => run(snapClips(engine.get("document"), clipsNow(), "previous"), "Snapped to the previous clip", "No clip before to snap to (or the clips are locked)")),
    item("Snap to next", "", "Move each selected clip so its end meets the start of the clip after it", () => run(snapClips(engine.get("document"), clipsNow(), "next"), "Snapped to the next clip", "No clip after to snap to (or the clips are locked)")),
    item("Nudge earlier", ",", "Move the selected clips, or the range, earlier by the nudge value (the keypad's minus too)", () => nudge(-1)),
    item("Nudge later", ".", "Move the selected clips, or the range, later by the nudge value (the keypad's plus too)", () => nudge(1)),
    sep(),
    item("Create fades...", "⌘F", "Fade in, fade out or crossfade where the range crosses a clip's edge or a join", () => void makeFades()),
    item("Delete fades", "", "Remove the fades of the clips in the range, or of the selected clips", () => run(deleteFades(engine.get("document"), target()), "Deleted the fades", "No fades on the selected clips or in the range")),
    item("Fade in to playhead", "", "Fade the clips under the playhead in from their start to it", () => run(fadeToPlayhead(engine.get("document"), target(), playhead(), "start"), "Faded in to the playhead", "Put the playhead inside a selected clip")),
    item("Fade out from playhead", "", "Fade the clips under the playhead out from it to their end", () => run(fadeToPlayhead(engine.get("document"), target(), playhead(), "end"), "Faded out from the playhead", "Put the playhead inside a selected clip")),
  );

  // Memory locations (Pro Tools' Memory Locations): Enter adds one at the playhead, playing or not; a number on the keypad
  // between two points recalls it; previous and next step through them; a selection location sets the range again
  const recall = (m: MemoryLocation | null, missing: string) => {
    if (!m) return say(missing);
    player.seek(m.start);
    if (m.kind === "region") {
      const doc = engine.get("document");
      const trackId = trackNow()?.id ?? doc.tracks[0]?.id;
      if (trackId) setRange({ trackId, start: m.start, end: m.end });
    }
    say(`Memory location ${m.number} at ${seconds(m.start)}`);
  };
  const addMemory = () => {
    const doc = engine.get("document");
    const n = nextMemoryNumber(doc);
    const at = playhead();
    engine.dispatch({ type: "add-marker", at, label: `Marker ${n}` });
    say(`Memory location ${n} at ${seconds(at)}`);
  };
  host.querySelector(".fw-transport-pop")?.append(
    sep(),
    item("Add memory location", "Enter", "A numbered marker at the playhead, while playing too", addMemory),
    item("Previous memory location", "", "The playhead to the memory location before it", () => recall(nextMemory(engine.get("document"), playhead(), -1), "No memory location before the playhead")),
    item("Next memory location", "", "The playhead to the memory location after it", () => recall(nextMemory(engine.get("document"), playhead(), 1), "No memory location after the playhead")),
    item("Memory locations", "", "The numbered markers and regions, with their comments and colours (the editor's Labels)", () => {
      const panel = host.querySelector<HTMLElement>(".fw-labels-panel");
      if (panel?.hidden) host.querySelector<HTMLButtonElement>(".fw-tool-tray [data-labels]")?.click();
    }),
  );
  host.addEventListener("fw-recall-memory", (e) => recall(findMemory(engine.get("document"), (e as CustomEvent<number>).detail), "No memory location with that number"));

  let typed: string | null = null;
  let typedAt = 0;
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (dialog.open || !engine.get("document").tracks.length) return;
    const mod = e.metaKey || e.ctrlKey;
    // the keypad's point, a number and the point (or Enter) recall that memory location
    if (typed !== null && performance.now() - typedAt > 3000) typed = null;
    if (!mod && !e.altKey && e.code === "NumpadDecimal") {
      e.preventDefault();
      if (typed) {
        const n = Number(typed);
        typed = null;
        recall(findMemory(engine.get("document"), n), `No memory location ${n}`);
      } else {
        typed = "";
        typedAt = performance.now();
      }
      return;
    }
    if (typed !== null && /^Numpad[0-9]$/.test(e.code)) {
      e.preventDefault();
      typed += e.code.slice(6);
      typedAt = performance.now();
      return;
    }
    if (typed && e.code === "NumpadEnter") {
      e.preventDefault();
      const n = Number(typed);
      typed = null;
      recall(findMemory(engine.get("document"), n), `No memory location ${n}`);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f" && range) {
      e.preventDefault();
      void makeFades();
    } else if (e.altKey && e.shiftKey && !mod && e.code === "KeyD") {
      e.preventDefault();
      onTrack((track) => {
        engine.dispatch({ type: "duplicate-track", trackId: track.id });
        say(`Duplicated ${track.name}`);
      })();
    } else if (e.altKey && e.shiftKey && !mod && (e.code === "KeyC" || e.code === "Digit3")) {
      e.preventDefault();
      void (e.code === "KeyC" ? commitTrack() : consolidateSelection());
    } else if (!mod && !e.altKey && ((e.key === "," && e.code !== "NumpadDecimal") || e.code === "NumpadSubtract")) {
      e.preventDefault();
      nudge(-1);
    } else if (!mod && !e.altKey && ((e.key === "." && e.code !== "NumpadDecimal") || e.code === "NumpadAdd")) {
      e.preventDefault();
      nudge(1);
    } else if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey && (document.activeElement === document.body || document.activeElement === stage || !document.activeElement)) {
      e.preventDefault();
      addMemory();
    }
  });
}
