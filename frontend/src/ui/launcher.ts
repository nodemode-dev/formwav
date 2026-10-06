/**
 * The comparison page's clip launching row, and L10's session view that plays: scenes by tracks (1 to 16 scenes), a
 * media file per slot, kept with the session (set-launcher-slot, set-launcher), each launch and stop landing where the
 * quantize choice says (now, the next beat, bar, two bars or four bars) and written into the arrangement as launched
 * repeats (as a session performance is recorded), so the player, exports and undo treat them as clips. Launching while
 * stopped starts playback; a slot whose loop is under the playhead is lit while it plays.
 */
import type { Engine } from "../engine";
import type { LauncherState } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

const QUANTIZE: [LauncherState["quantize"], string][] = [["none", "Now"], ["beat", "Next beat"], ["bar", "Next bar"], ["2bars", "Next 2 bars"], ["4bars", "Next 4 bars"]];

export function mountLauncher(host: HTMLElement, engine: Engine, notice: HTMLElement | null, player?: { play(open?: boolean): Promise<void> }): void {
  const section = document.createElement("section");
  section.className = "fw-insp-section fw-launch";
  section.innerHTML = `<div class="fw-insp-head">Clip launcher</div>
<div class="fw-launch-scroll"><table class="fw-launch-grid"><thead><tr><th></th></tr></thead><tbody></tbody></table></div>
<div class="fw-analyze-buttons"><label class="fw-sam-opt"><span>Scenes</span><input type="number" min="1" max="16" step="1" value="4" data-launch-scenes aria-label="Scenes in the launcher"></label><label class="fw-sam-opt"><span>Launch on</span><select data-launch-quantize aria-label="Where a launch lands">${QUANTIZE.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label><label class="fw-sam-opt"><span>Loops</span><input type="number" min="1" max="64" step="1" value="8" data-launch-loops aria-label="Times a launched clip repeats"></label><button type="button" class="fw-ibtn" data-launch-stopall title="End every launched clip where the quantize choice lands">Stop all</button></div>`;
  host.append(section);
  const headRow = section.querySelector<HTMLTableRowElement>("thead tr") as HTMLTableRowElement;
  const body = section.querySelector<HTMLTableSectionElement>("tbody") as HTMLTableSectionElement;
  const cols = new Map<string, { th: HTMLTableCellElement; cells: HTMLTableCellElement[] }>();
  let rows: HTMLTableRowElement[] = [];
  let mediaSig = "";
  const state = (): LauncherState => engine.get("document").launcher ?? { scenes: 4, slots: {}, quantize: "bar" };

  const fill = (select: HTMLSelectElement, media: [string, string][], chosen: string | null) => {
    select.replaceChildren(new Option("(empty)", ""), ...media.map(([id, name]) => new Option(name.replace(/\.[a-z0-9]+$/i, ""), id)));
    select.value = chosen && media.some(([id]) => id === chosen) ? chosen : "";
  };
  const rebuild = (scenes: number) => {
    for (const c of cols.values()) c.th.remove();
    cols.clear();
    body.replaceChildren(
      ...Array.from({ length: scenes }, (_, s) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<th><button type="button" class="fw-ibtn" data-launch-scene="${s}" title="Launch this row on every track">Scene ${s + 1}</button></th>`;
        return tr;
      }),
    );
    rows = [...body.querySelectorAll<HTMLTableRowElement>("tr")];
    mediaSig = "";
  };
  const sync = () => {
    const doc = engine.get("document");
    const l = state();
    if (rows.length !== l.scenes) rebuild(l.scenes);
    const scenesInput = section.querySelector<HTMLInputElement>("[data-launch-scenes]") as HTMLInputElement;
    if (document.activeElement !== scenesInput) scenesInput.value = String(l.scenes);
    (section.querySelector("[data-launch-quantize]") as HTMLSelectElement).value = l.quantize;
    const media = Object.values(doc.media).map((m) => [m.id, m.name] as [string, string]);
    for (const t of doc.tracks) {
      if (cols.has(t.id)) continue;
      const th = document.createElement("th");
      th.innerHTML = `<span class="fw-launch-name"></span><button type="button" class="fw-ibtn" data-launch-stop="${t.id}" title="End this track's launched clip where the quantize choice lands" aria-label="Stop the track's launched clip">Stop</button>`;
      headRow.append(th);
      const cells = rows.map((row, s) => {
        const td = document.createElement("td");
        td.innerHTML = `<select data-launch-media data-track="${t.id}" data-scene="${s}" aria-label="Clip for scene ${s + 1}"></select><button type="button" class="fw-ibtn" data-launch-slot="${s}" data-track="${t.id}" aria-label="Launch this slot">Play</button>`;
        row.append(td);
        return td;
      });
      cols.set(t.id, { th, cells });
      mediaSig = "";
    }
    for (const [id, c] of cols) {
      if (doc.tracks.some((t) => t.id === id)) continue;
      c.th.remove();
      c.cells.forEach((td) => td.remove());
      cols.delete(id);
    }
    for (const t of doc.tracks) setText(cols.get(t.id)?.th.querySelector<HTMLElement>(".fw-launch-name") ?? null, t.name);
    const sig = media.map((m) => m.join(":")).join("|") + JSON.stringify(l.slots);
    if (sig !== mediaSig) {
      mediaSig = sig;
      for (const [trackId, c] of cols) c.cells.forEach((td, s) => fill(td.querySelector("select") as HTMLSelectElement, media, l.slots[trackId]?.[s] ?? null));
    }
  };
  // a slot is lit while one of its track's launched copies of its media is under the playhead
  const lit = () => {
    const doc = engine.get("document");
    const at = engine.get("transport").positionSamples;
    const playing = engine.get("transport").playing;
    const l = state();
    for (const [trackId, c] of cols) {
      const t = doc.tracks.find((x) => x.id === trackId);
      const now = playing ? t?.clips.find((x) => x.launched && x.start <= at && at < x.start + x.length)?.mediaId : undefined;
      c.cells.forEach((td, s) => {
        const on = !!now && l.slots[trackId]?.[s] === now;
        if ((td.dataset.playing === "") !== on) on ? (td.dataset.playing = "") : delete td.dataset.playing;
      });
    }
  };

  const landing = () => {
    const doc = engine.get("document");
    const beat = (doc.sampleRate * 60) / (doc.tempo?.bpm ?? 120);
    const grid = { none: 0, beat, bar: beat * (doc.tempo?.beatsPerBar ?? 4), "2bars": 2 * beat * (doc.tempo?.beatsPerBar ?? 4), "4bars": 4 * beat * (doc.tempo?.beatsPerBar ?? 4) }[state().quantize];
    const pos = engine.get("transport").positionSamples;
    const at = grid ? Math.ceil(pos / grid - 1e-9) * grid : pos;
    return { at: Math.round(at), label: grid ? `bar ${(Math.round(at) / (beat * (doc.tempo?.beatsPerBar ?? 4)) + 1).toFixed(2).replace(/\.00$/, "")}` : "now" };
  };
  const loops = () => Math.min(64, Math.max(1, Math.round(Number(section.querySelector<HTMLInputElement>("[data-launch-loops]")?.value) || 1)));
  const slotMedia = (trackId: string, scene: number) => state().slots[trackId]?.[scene] ?? "";
  const go = () => {
    if (!engine.get("transport").playing) void player?.play();
  };

  section.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("[data-launch-media]")) {
      const sel = t as HTMLSelectElement;
      engine.dispatch({ type: "set-launcher-slot", trackId: sel.dataset.track ?? "", scene: Number(sel.dataset.scene), mediaId: sel.value || null });
    } else if (t.matches("[data-launch-scenes]")) {
      engine.dispatch({ type: "set-launcher", scenes: Number((t as HTMLInputElement).value) || 4 });
    } else if (t.matches("[data-launch-quantize]")) {
      engine.dispatch({ type: "set-launcher", quantize: (t as HTMLSelectElement).value as LauncherState["quantize"] });
    }
  });
  section.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const { at, label } = landing();
    const slot = t.closest<HTMLElement>("[data-launch-slot]");
    if (slot) {
      const trackId = slot.dataset.track ?? "";
      const mediaId = slotMedia(trackId, Number(slot.dataset.launchSlot));
      if (!mediaId) return void (notice && setText(notice, "Choose a clip for that slot first"));
      engine.dispatch({ type: "launch-clip", trackId, mediaId, at, repeats: loops() });
      go();
      if (notice) setText(notice, `Launched at ${label}`);
      return;
    }
    const scene = t.closest<HTMLElement>("[data-launch-scene]");
    if (scene) {
      const s = Number(scene.dataset.launchScene);
      const commands = [...cols.keys()].flatMap((trackId) => {
        const mediaId = slotMedia(trackId, s);
        return mediaId ? [{ type: "launch-clip" as const, trackId, mediaId, at, repeats: loops() }] : [];
      });
      if (!commands.length) return void (notice && setText(notice, `Scene ${s + 1} has no clips`));
      engine.dispatch({ type: "batch", commands });
      go();
      if (notice) setText(notice, `Launched scene ${s + 1} at ${label}: ${commands.length} track${commands.length === 1 ? "" : "s"}`);
      return;
    }
    const stop = t.closest<HTMLElement>("[data-launch-stop]");
    if (stop) {
      engine.dispatch({ type: "stop-launched", trackId: stop.dataset.launchStop ?? "", at });
      if (notice) setText(notice, `Stopping at ${label}`);
      return;
    }
    if (t.closest("[data-launch-stopall]")) {
      engine.dispatch({ type: "batch", commands: [...cols.keys()].map((trackId) => ({ type: "stop-launched" as const, trackId, at })) });
      if (notice) setText(notice, `Stopping every track at ${label}`);
    }
  });

  engine.subscribe("document", () => {
    sync();
    lit();
  });
  engine.subscribe("transport", lit);
  sync();
}
