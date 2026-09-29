import type { Engine, MediaRef, SessionDoc } from "../engine";
import { icon as fcIcon } from "../vendor/formcut/icons";
import { patchList, setText } from "../vendor/nodemode/dom-stable";

const length = (m: MediaRef) => {
  const s = m.frames / m.sampleRate;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

function fill(row: HTMLElement, m: MediaRef): void {
  setText(row.querySelector(".fw-media-name"), m.name);
  setText(row.querySelector(".fw-media-meta"), `${m.channels === 1 ? "mono" : m.channels === 2 ? "stereo" : `${m.channels} ch`} · ${(m.sampleRate / 1000).toFixed(1)} kHz · ${length(m)}`);
  if (row.title !== m.name) row.title = m.name;
}

/** The session's audio files, as formcut's media pane lists a project's media. */
export function mountMediaPane(host: HTMLElement, engine: Engine): void {
  const list = host.querySelector<HTMLElement>(".fw-media-list");
  const meta = host.querySelector<HTMLElement>(".fw-pane-media .fw-pane-meta");
  const end = host.querySelector<HTMLElement>(".fw-pane-media .fw-pane-end");
  if (!list) return;

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "fw-icon-btn fw-pane-action";
  importButton.setAttribute("aria-label", "Import audio");
  importButton.title = "Import any audio or video file";
  importButton.innerHTML = fcIcon("plus");
  importButton.addEventListener("click", () => host.querySelector<HTMLInputElement>(".fw-file")?.click());
  end?.append(importButton);

  const empty = document.createElement("p");
  empty.className = "fw-empty-note";
  empty.textContent = "Imported and recorded audio appears here. Add any file to a new track with its + button.";
  list.before(empty);

  const render = (doc: SessionDoc) => {
    const items = Object.values(doc.media);
    if (empty.hidden !== items.length > 0) empty.hidden = items.length > 0;
    setText(meta, items.length ? `${items.length} file${items.length === 1 ? "" : "s"}` : "");
    patchList(list, items, {
      key: (m) => m.id,
      create: (m) => {
        const row = document.createElement("div");
        row.className = "fw-media-item";
        row.innerHTML = `<span class="fw-media-name"></span><span class="fw-media-meta"></span><button type="button" class="fw-icon-btn fw-media-add" aria-label="Add to a new track" title="Add to a new track at the playhead">${fcIcon("addToTrack")}</button>`;
        fill(row, m);
        return row;
      },
      update: (row, m) => fill(row, m),
    });
  };

  list.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest(".fw-media-add")?.closest<HTMLElement>(".fw-media-item")?.dataset.key;
    const media = id ? engine.get("document").media[id] : undefined;
    if (media) engine.dispatch({ type: "import-media", media, at: engine.get("transport").positionSamples });
  });

  engine.subscribe("document", render);
  render(engine.get("document"));
}
