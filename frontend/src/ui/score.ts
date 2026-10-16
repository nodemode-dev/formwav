import type { Engine } from "../engine";
import { layout, musicXml, scoreSvg } from "../engine/score";
import { noteTracks, sessionMidi } from "../engine/smf";
import { setText } from "../vendor/nodemode/dom-stable";

const sessionName = (host: HTMLElement) => host.querySelector<HTMLInputElement>(".fw-session-name")?.value.trim() || "formwav session";
const fileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "session";

function download(data: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** S8: the session's note tracks as a MIDI file, as MusicXML and as a printable score, from the File menu and from the
 *  Score panel, which shows the score as it stands. */
export function mountScore(host: HTMLElement, engine: Engine): void {
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const anchor = pane?.querySelector<HTMLElement>(".fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]') ?? host.querySelector<HTMLElement>(".fw-tool-tray");
  const filePop = host.querySelector<HTMLElement>(".fw-menu-pop[aria-label='File']");
  let bars = 4;

  const none = () => {
    if (noteTracks(engine.get("document")).length) return false;
    setText(notice, "No note track to write: import a MIDI file, record MIDI or add a note clip first");
    return true;
  };
  const exportMidi = () => {
    if (none()) return;
    const name = sessionName(host);
    download(sessionMidi(engine.get("document"), name), `${fileName(name)}.mid`, "audio/midi");
    setText(notice, `Exported ${fileName(name)}.mid: ${noteTracks(engine.get("document")).length} note tracks with the tempo, meter and markers`);
  };
  const exportXml = () => {
    if (none()) return;
    const name = sessionName(host);
    const score = layout(engine.get("document"), name);
    download(musicXml(score), `${fileName(name)}.musicxml`, "application/vnd.recordare.musicxml+xml");
    setText(notice, `Exported ${fileName(name)}.musicxml: ${score.parts.length} parts, ${score.measures} bars`);
  };
  const print = () => {
    if (none()) return;
    const name = sessionName(host);
    const svg = scoreSvg(layout(engine.get("document"), name), bars);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;inset-inline-start:-10000px;inline-size:900px;block-size:600px;border:0";
    document.body.append(frame);
    const page = frame.contentDocument;
    if (!page) return frame.remove();
    page.open();
    page.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name.replace(/</g, "&lt;")}</title><style>@page{margin:12mm}body{margin:0}svg{inline-size:100%;block-size:auto}</style></head><body>${svg}</body></html>`);
    page.close();
    setTimeout(() => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    }, 50);
  };

  if (filePop) {
    const after = filePop.querySelector('[data-proxy*="export"]');
    const items = (
      [
        ["Export MIDI file", "Every note track as a Standard MIDI File, with the session's tempo, meter and markers", exportMidi],
        ["Export MusicXML", "The note tracks as a score for Sibelius, MuseScore, Finale or Dorico", exportXml],
        ["Print score…", "The note tracks as a printable score", print],
      ] as const
    ).map(([label, title, run]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fw-ibtn";
      b.setAttribute("role", "menuitem");
      b.title = title;
      b.dataset.score = label === "Export MIDI file" ? "midi" : label === "Export MusicXML" ? "xml" : "print";
      b.innerHTML = "<span></span>";
      (b.firstElementChild as HTMLElement).textContent = label;
      b.addEventListener("click", run);
      return b;
    });
    if (after) after.after(...items);
    else filePop.append(...items);
  }

  if (!pane || !anchor || !view) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.dataset.scoreView = "";
  toggle.setAttribute("aria-pressed", "false");
  toggle.title = "Show the note tracks as a score";
  toggle.innerHTML = "<span>Score</span>";
  view.append(toggle);
  const panel = document.createElement("section");
  panel.className = "fw-score";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Score");
  panel.innerHTML = `<div class="fw-piano-head"><label class="fw-piano-opt">Bars per line <select data-score-bars aria-label="Bars per line"><option value="2">2</option><option value="3">3</option><option value="4" selected>4</option><option value="6">6</option></select></label><button type="button" class="fw-ibtn" data-score-act="print" title="The note tracks as a printable score">Print…</button><button type="button" class="fw-ibtn" data-score-act="xml" title="The note tracks as a score for Sibelius, MuseScore, Finale or Dorico">MusicXML</button><button type="button" class="fw-ibtn" data-score-act="midi" title="Every note track as a Standard MIDI File">MIDI file</button><span class="fw-piano-state" role="status"></span></div><div class="fw-score-body"></div>`;
  anchor.before(panel);
  const body = panel.querySelector<HTMLElement>(".fw-score-body") as HTMLElement;
  const state = panel.querySelector<HTMLElement>(".fw-piano-state");
  let shown = "";
  const render = () => {
    if (panel.hidden) return;
    const doc = engine.get("document");
    const tracks = noteTracks(doc);
    if (!tracks.length) {
      setText(state, "No note track");
      if (shown !== "") {
        shown = "";
        body.replaceChildren();
      }
      return;
    }
    const score = layout(doc, sessionName(host));
    const svg = scoreSvg(score, bars);
    setText(state, `${score.parts.length} parts · ${score.measures} bars`);
    if (svg === shown) return;
    shown = svg;
    const holder = document.createElement("div");
    holder.innerHTML = svg;
    const next = holder.firstElementChild;
    if (next) body.replaceChildren(next);
  };
  engine.subscribe("document", render);
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-pressed", String(!panel.hidden));
    render();
  });
  panel.addEventListener("change", (e) => {
    const pick = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-score-bars]");
    if (!pick) return;
    bars = Number(pick.value) || 4;
    render();
  });
  panel.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-score-act]")?.dataset.scoreAct;
    if (act === "print") print();
    else if (act === "xml") exportXml();
    else if (act === "midi") exportMidi();
  });
}
