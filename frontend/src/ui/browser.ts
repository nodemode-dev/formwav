/**
 * The browser column of the agreed canvas: one search over the open tab (Media, Effects or Sounds) with / to reach it,
 * the hint that names where a click adds, the effect groups under the session's media (each opens the Effects tab at
 * its group), Made by the agent, the Sounds tab's sections folding under their heads, and media rows that add on a
 * click or a drag onto a lane. The tabs themselves switch in voice-pane.ts, as they always have.
 */
import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";
import { samplesPerPixel } from "./lanes";
import { FX_GROUPS } from "./browser-effects";

const MEDIA_TYPE = "application/x-formwav-media";
const CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>`;
const SOUNDS_ORDER = [".fw-library", ".fw-models", ".fw-voice-wrap", ".fw-generate", ".fw-steps", ".fw-launch"];

export function mountBrowser(host: HTMLElement, engine: Engine): void {
  const pane = host.querySelector<HTMLElement>(".fw-pane-media");
  const search = host.querySelector<HTMLInputElement>("[data-browse-search]");
  const hint = host.querySelector<HTMLElement>(".fw-browse-hint");
  const groups = host.querySelector<HTMLElement>(".fw-fx-groups");
  const list = host.querySelector<HTMLElement>(".fw-media-list");
  const sounds = host.querySelector<HTMLElement>(".fw-create-body");
  if (!pane || !search || !list) return;

  if (groups) {
    groups.innerHTML = FX_GROUPS.map(
      ([label, kinds]) => `<button type="button" class="fw-fx-group-row" role="listitem" data-fx-group="${label}" title="Open ${label} in the Effects tab"><span>${label}</span><span class="fw-fx-count">${kinds.length}</span>${CHEVRON}</button>`,
    ).join("");
    groups.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-fx-group]");
      if (!row) return;
      pane.querySelector<HTMLButtonElement>('.fw-pane-tab[data-tab="effects"]')?.click();
      pane.querySelector<HTMLElement>(`.fw-fxlib-group[aria-label="${row.dataset.fxGroup}"]`)?.scrollIntoView({ block: "start" });
    });
  }

  if (sounds) {
    const sections = SOUNDS_ORDER.map((s) => sounds.querySelector<HTMLElement>(`:scope > ${s}`)).filter((s): s is HTMLElement => !!s);
    for (const s of sounds.querySelectorAll<HTMLElement>(":scope > .fw-insp-section")) if (!sections.includes(s)) sections.push(s);
    sounds.append(...sections);
    sections.forEach((s, i) => {
      if (i > 0) s.classList.add("is-folded");
      const head = s.firstElementChild as HTMLElement | null;
      if (!head) return;
      head.setAttribute("role", "button");
      head.tabIndex = 0;
      head.setAttribute("aria-expanded", String(i === 0));
    });
    const fold = (head: HTMLElement) => {
      const section = head.parentElement;
      if (!section) return;
      const folded = section.classList.toggle("is-folded");
      head.setAttribute("aria-expanded", String(!folded));
    };
    sounds.addEventListener("click", (e) => {
      const head = (e.target as HTMLElement).closest<HTMLElement>("[role='button']");
      if (head && head.parentElement?.parentElement === sounds && head.parentElement.firstElementChild === head) fold(head);
    });
    sounds.addEventListener("keydown", (e) => {
      const head = e.target as HTMLElement;
      if ((e.key === "Enter" || e.key === " ") && head.getAttribute("role") === "button" && head.parentElement?.parentElement === sounds) {
        e.preventDefault();
        fold(head);
      }
    });
  }

  let selected: string[] = [];
  const selectedTrack = () => engine.get("document").tracks.find((t) => t.clips.some((c) => selected.includes(c.id)));
  const writeHint = () => {
    const track = selectedTrack();
    setText(hint, track ? `Click adds to ${track.name}, or drag onto any track` : "Click adds to a new track, or drag onto any track");
  };
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail ?? [];
    writeHint();
  });
  engine.subscribe("document", writeHint);
  writeHint();

  const add = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(selectedTrack() ? ".fw-media-place" : ".fw-media-add")?.click();
  list.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>(".fw-media-item");
    if (row && !target.closest("button")) add(row);
  });
  list.addEventListener("keydown", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".fw-media-item");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      add(row);
    }
  });
  list.addEventListener("dragstart", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".fw-media-item")?.dataset.key;
    if (!id || !e.dataTransfer) return;
    e.dataTransfer.setData(MEDIA_TYPE, id);
    e.dataTransfer.effectAllowed = "copy";
  });
  const stage = host.querySelector<HTMLElement>(".fw-stage");
  stage?.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(MEDIA_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  stage?.addEventListener("drop", (e) => {
    const id = e.dataTransfer?.getData(MEDIA_TYPE);
    if (!id) return;
    e.preventDefault();
    const doc = engine.get("document");
    const media = doc.media[id];
    if (!media) return;
    const lane = (e.target as HTMLElement).closest<HTMLElement>(".fw-lane");
    const body = lane?.querySelector<HTMLElement>(".fw-lane-body") ?? stage.querySelector<HTMLElement>(".fw-lane-body");
    const left = body ? body.getBoundingClientRect().left : stage.getBoundingClientRect().left;
    const at = Math.max(0, Math.round((e.clientX - left) * samplesPerPixel(doc)));
    const track = lane ? doc.tracks.find((t) => t.id === lane.dataset.key) : undefined;
    if (track) {
      const length = Math.round((media.frames * doc.sampleRate) / media.sampleRate);
      engine.dispatch({ type: "add-clip", trackId: track.id, mediaId: media.id, start: at, sourceIn: 0, length });
    } else engine.dispatch({ type: "import-media", media, at });
  });

  pane.addEventListener("click", (e) => {
    const ask = (e.target as HTMLElement).closest<HTMLElement>("[data-ask-agent]");
    if (ask) host.dispatchEvent(new CustomEvent("fw-ask-agent", { detail: ask.dataset.askAgent ?? "" }));
  });

  const filter = () => {
    const q = search.value.trim().toLowerCase();
    const hide = (el: Element, on: boolean) => {
      if (el.hasAttribute("data-search-hidden") !== on) el.toggleAttribute("data-search-hidden", on);
    };
    const match = (el: Element) => !q || (el.textContent ?? "").toLowerCase().includes(q);
    for (const row of list.querySelectorAll(".fw-media-item")) hide(row, !match(row));
    for (const row of pane.querySelectorAll<HTMLElement>(".fw-fx-group-row")) {
      const kinds = FX_GROUPS.find(([label]) => label === row.dataset.fxGroup)?.[1] ?? [];
      const inside = kinds.some((k) => match(pane.querySelector(`.fw-fxlib-item[data-kind="${k}"]`) ?? row));
      hide(row, !(match(row) || inside));
    }
    for (const card of pane.querySelectorAll(".fw-agent-card")) hide(card, !!q);
    for (const group of pane.querySelectorAll(".fw-fxlib-group")) {
      let any = false;
      for (const item of group.querySelectorAll(".fw-fxlib-item")) {
        const on = match(item);
        hide(item, !on);
        any ||= on;
      }
      hide(group, !any);
    }
    if (sounds) {
      for (const s of sounds.querySelectorAll<HTMLElement>(":scope > .fw-insp-section")) {
        const on = match(s);
        hide(s, !on);
        if (q && on && s.classList.contains("is-folded")) {
          s.classList.remove("is-folded");
          s.firstElementChild?.setAttribute("aria-expanded", "true");
        }
      }
    }
  };
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) {
      e.preventDefault();
      search.value = "";
      filter();
    }
  });
  engine.subscribe("document", () => {
    if (search.value.trim()) filter();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    search.focus();
    search.select();
  });
}
