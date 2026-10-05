/**
 * The comparison page's Pattern sequencer and clip launching row, launching (see HASHOUT_LOG): scenes by tracks, a
 * media file per cell, each launch and stop landing on the next bar and written into the arrangement as launched
 * repeats (as a session performance is recorded), so the player, exports and undo treat them as clips.
 */
import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

const SCENES = 4;

export function mountLauncher(host: HTMLElement, engine: Engine, notice: HTMLElement | null): void {
  const section = document.createElement("section");
  section.className = "fw-insp-section fw-launch";
  section.innerHTML = `<div class="fw-insp-head">Clip launcher</div>
<div class="fw-launch-scroll"><table class="fw-launch-grid"><thead><tr><th></th></tr></thead><tbody>${Array.from(
    { length: SCENES },
    (_, s) => `<tr><th><button type="button" class="fw-ibtn" data-launch-scene="${s}" title="Launch this row on every track, on the next bar">Scene ${s + 1}</button></th></tr>`,
  ).join("")}</tbody></table></div>
<div class="fw-analyze-buttons"><label class="fw-sam-opt"><span>Loops</span><input type="number" min="1" max="64" step="1" value="8" data-launch-loops aria-label="Times a launched clip repeats"></label><button type="button" class="fw-ibtn" data-launch-stopall title="End every track's launched clip on the next bar">Stop all</button></div>`;
  host.append(section);
  const headRow = section.querySelector<HTMLTableRowElement>("thead tr");
  const rows = [...section.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  const cols = new Map<string, { th: HTMLTableCellElement; cells: HTMLTableCellElement[] }>();
  let mediaSig = "";

  const fill = (select: HTMLSelectElement, media: [string, string][]) => {
    const keep = select.value;
    select.replaceChildren(new Option("(empty)", ""), ...media.map(([id, name]) => new Option(name.replace(/\.[a-z0-9]+$/i, ""), id)));
    select.value = media.some(([id]) => id === keep) ? keep : "";
  };

  const sync = () => {
    const doc = engine.get("document");
    const media = Object.values(doc.media).map((m) => [m.id, m.name] as [string, string]);
    for (const t of doc.tracks) {
      if (cols.has(t.id)) continue;
      const th = document.createElement("th");
      th.innerHTML = `<span class="fw-launch-name"></span><button type="button" class="fw-ibtn" data-launch-stop="${t.id}" title="End this track's launched clip on the next bar" aria-label="Stop the track's launched clip">&#9632;</button>`;
      headRow?.append(th);
      const cells = rows.map((row, s) => {
        const td = document.createElement("td");
        td.innerHTML = `<select data-launch-media aria-label="Clip for scene ${s + 1}"></select><button type="button" class="fw-ibtn" data-launch-slot="${s}" data-track="${t.id}" aria-label="Launch on the next bar">&#9654;</button>`;
        fill(td.querySelector<HTMLSelectElement>("select") as HTMLSelectElement, media);
        row.append(td);
        return td;
      });
      cols.set(t.id, { th, cells });
    }
    for (const [id, c] of cols) {
      if (doc.tracks.some((t) => t.id === id)) continue;
      c.th.remove();
      c.cells.forEach((td) => td.remove());
      cols.delete(id);
    }
    for (const t of doc.tracks) setText(cols.get(t.id)?.th.querySelector<HTMLElement>(".fw-launch-name") ?? null, t.name);
    const sig = media.map((m) => m.join(":")).join("|");
    if (sig !== mediaSig) {
      mediaSig = sig;
      for (const c of cols.values()) for (const td of c.cells) fill(td.querySelector<HTMLSelectElement>("select") as HTMLSelectElement, media);
    }
  };

  const nextBar = () => {
    const doc = engine.get("document");
    const bar = Math.round((doc.sampleRate * 60 * (doc.tempo?.beatsPerBar ?? 4)) / (doc.tempo?.bpm ?? 120));
    return { at: Math.ceil(engine.get("transport").positionSamples / bar) * bar, bar };
  };
  const loops = () => Math.min(64, Math.max(1, Math.round(Number(section.querySelector<HTMLInputElement>("[data-launch-loops]")?.value) || 1)));
  const slotMedia = (trackId: string, scene: number) => cols.get(trackId)?.cells[scene]?.querySelector<HTMLSelectElement>("select")?.value ?? "";

  section.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const { at, bar } = nextBar();
    const barNo = at / bar + 1;
    const slot = t.closest<HTMLElement>("[data-launch-slot]");
    if (slot) {
      const trackId = slot.dataset.track ?? "";
      const mediaId = slotMedia(trackId, Number(slot.dataset.launchSlot));
      if (!mediaId) return void (notice && setText(notice, "Choose a clip for that slot first"));
      engine.dispatch({ type: "launch-clip", trackId, mediaId, at, repeats: loops() });
      if (notice) setText(notice, `Launched on bar ${barNo}`);
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
      if (notice) setText(notice, `Launched scene ${s + 1} on bar ${barNo}: ${commands.length} track${commands.length === 1 ? "" : "s"}`);
      return;
    }
    const stop = t.closest<HTMLElement>("[data-launch-stop]");
    if (stop) {
      engine.dispatch({ type: "stop-launched", trackId: stop.dataset.launchStop ?? "", at });
      if (notice) setText(notice, `Stopping on bar ${barNo}`);
      return;
    }
    if (t.closest("[data-launch-stopall]")) {
      engine.dispatch({ type: "batch", commands: [...cols.keys()].map((trackId) => ({ type: "stop-launched" as const, trackId, at })) });
      if (notice) setText(notice, `Stopping every track on bar ${barNo}`);
    }
  });

  engine.subscribe("document", sync);
  sync();
}
