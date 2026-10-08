/**
 * PLAN_v13 S4's editing commands in the interface: the Edit menu's Duplicate, Repeat, Shift, Insert silence, the trims,
 * Separate on the grid, Heal, Strip silence and the time operations; the View menu's zoom to the selection, zoom
 * presets and Big Counter; the Transport menu's Tab to transients; their keys; and one small dialog for the values a
 * command asks for. Each command is built by engine/editing.ts from the lanes' range or selected clips (their own
 * events) and dispatched as one undo step.
 */
import type { Command, Engine } from "../engine";
import type { Player } from "../audio/player";
import { clipTransients, editSpan, healSeparations, insertSilence, nextStop, repeatSpan, separateOnGrid, shiftClips, stripGaps, timeOperation, trimToFile, trimToFill, trimToPlayhead, trimToRange, type EditRange, type EditTarget } from "../engine/editing";
import { setText } from "../vendor/nodemode/dom-stable";
import { mountBigCounter } from "./big-counter";
import { gridStep, shuffleEnabled } from "./grid";
import { getZoom, samplesPerPixel, setZoom, zoomToSpan } from "./lanes";

type Field = { key: string; label: string; value: number | null; min?: number; max?: number; step?: number; unit?: string; placeholder?: string };
type Values = Record<string, number | null>;

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
    range = d && d.end > d.start ? { trackId: d.trackId, start: d.start, end: d.end } : null;
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
    engine.dispatch(command);
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
    for (const input of dialog.querySelectorAll<HTMLInputElement>("input[data-k]")) {
      const n = Number(input.value);
      values[input.dataset.k ?? ""] = input.value.trim() === "" || !Number.isFinite(n) ? null : n;
    }
    remembered.set(dialog.dataset.ask ?? "", values);
    done(values);
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
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
          const input = Object.assign(document.createElement("input"), { type: "number", step: String(f.step ?? "any"), placeholder: f.placeholder ?? "" });
          input.dataset.k = f.key;
          if (f.min !== undefined) input.min = String(f.min);
          if (f.max !== undefined) input.max = String(f.max);
          const value = f.key in last ? last[f.key] : f.value;
          input.value = value === null ? "" : String(value);
          label.append(Object.assign(document.createElement("span"), { textContent: f.label }), input, Object.assign(document.createElement("span"), { textContent: f.unit ?? "" }));
          return label;
        }),
      );
      settle = resolve;
      dialog.returnValue = "";
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>("input[data-k]")?.select();
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
    const n = v?.count;
    if (!v || n === null || n === undefined) return;
    run(repeatSpan(engine.get("document"), target(), Math.round(n), shuffleEnabled()), `Repeated the selection ${Math.round(n)} times`, "Type from 1 to 999 copies");
  };
  const shift = async () => {
    if (!target().clipIds.length) {
      say("Select the clips to shift");
      return;
    }
    const v = await ask("Shift", "The selected clips move later, or earlier for a negative amount.", [{ key: "by", label: "By", value: 1, step: 0.001, unit: "s" }], "Shift");
    const by = v?.by;
    if (!v || by === null || by === undefined) return;
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
    const q = new URLSearchParams({ trackId: scope.trackId, gap: String(Math.max(0.001, (v.minimum ?? 300) / 1000)) });
    if (v.threshold !== null && v.threshold !== undefined) q.set("threshold", String(Math.min(0, Math.max(-96, v.threshold))));
    say("Finding the silences...");
    try {
      const res = await fetch(`/api/render/activity?${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(engine.get("document")) });
      const out = (await res.json().catch(() => ({}))) as { detail?: unknown; regions?: [number, number][] };
      if (!res.ok || !out.regions) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
      const gaps = stripGaps(out.regions, rate(), scope.start, scope.end, Math.max(0, v.before ?? 0) / 1000, Math.max(0, v.after ?? 0) / 1000);
      const command: Command | null = gaps.length ? { type: "batch", label: "Stripped silence", commands: [{ type: "clear-ranges", trackIds: [scope.trackId], ranges: gaps, ripple: false }] } : null;
      const stripped = run(command, `Stripped ${gaps.length} silent stretch${gaps.length === 1 ? "" : "es"}`, "No silence to strip at that threshold and length");
      // what was selected stays selected as the pieces that remain of it, as Pro Tools leaves them
      if (stripped && !t.range) selectClips((engine.get("document").tracks.find((tr) => tr.id === scope.trackId)?.clips ?? []).filter((c) => c.start < scope.end && c.start + c.length > scope.start).map((c) => c.id));
    } catch (err) {
      say(`Could not strip: ${err instanceof Error ? err.message : String(err)}`);
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
    const step = gridStep(doc.sampleRate, doc.sampleRate / samplesPerPixel(doc));
    run(separateOnGrid(doc, target(), step), `Separated on the grid every ${seconds(step)}`, target().range || target().clipIds.length ? "No grid line inside the selection (or the grid is too fine): zoom out" : "Select clips or a range to separate");
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
}
