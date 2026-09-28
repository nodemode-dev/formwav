import type { Engine, SessionDoc } from "../engine";
import type { Player } from "../audio/player";
import { listProjects, openProject, saveProject, type ProjectSummary } from "../io/projects-client";
import { delayedIndicator, patchList, setText } from "../vendor/nodemode/dom-stable";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function when(savedAt: string | null): string {
  if (!savedAt) return "unknown date";
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function mountProjects(host: HTMLElement, engine: Engine, player: Player): void {
  const nameField = host.querySelector<HTMLInputElement>("input.fw-session-name");
  const saveButton = host.querySelector<HTMLButtonElement>('[data-action="save"]');
  const openButton = host.querySelector<HTMLButtonElement>('[data-action="open"]');
  const notice = host.querySelector<HTMLElement>(".fw-notice");

  const popover = document.createElement("div");
  popover.className = "fw-popover";
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Open a saved session");
  popover.innerHTML = `<div class="fw-popover-title">Saved sessions</div><div class="fw-popover-list"></div><div class="fw-popover-empty" hidden>No saved sessions yet</div>`;
  document.getElementById("overlay-root")?.append(popover);
  const list = popover.querySelector(".fw-popover-list") as HTMLElement;
  const empty = popover.querySelector(".fw-popover-empty") as HTMLElement;

  let lastSaved: SessionDoc = engine.get("document");
  let busy = false;
  const sessionName = () => nameField?.value.trim() || "Untitled session";
  const unsaved = () => {
    const doc = engine.get("document");
    return doc !== lastSaved && doc.tracks.length > 0;
  };

  const withNotice = async (pending: string, work: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    let shown = false;
    let final = "";
    const dismiss = delayedIndicator(
      () => {
        shown = true;
        setText(notice, pending);
      },
      () => setText(notice, final),
    );
    try {
      final = await work();
    } catch (err) {
      final = reason(err);
    } finally {
      dismiss();
      if (!shown) setText(notice, final);
      busy = false;
    }
  };

  const save = () =>
    withNotice(`Saving ${sessionName()}`, async () => {
      const name = sessionName();
      const doc = engine.get("document");
      try {
        await saveProject(name, doc);
      } catch (err) {
        return `Could not save: ${reason(err)}`;
      }
      lastSaved = doc;
      return `Saved ${name}`;
    });

  const close = () => {
    if (popover.hidden) return;
    popover.hidden = true;
    openButton?.setAttribute("aria-expanded", "false");
  };

  const updateRow = (row: HTMLElement, p: ProjectSummary) => {
    row.dataset.name = p.name;
    setText(row.querySelector(".fw-popover-name"), p.name);
    setText(row.querySelector(".fw-popover-meta"), `${p.tracks} ${p.tracks === 1 ? "track" : "tracks"} · ${when(p.savedAt)}`);
  };

  const show = async () => {
    if (!openButton || !popover.hidden) return;
    let items: ProjectSummary[];
    try {
      items = await listProjects();
    } catch (err) {
      setText(notice, `Could not list sessions: ${reason(err)}`);
      return;
    }
    patchList(list, items, {
      key: (p) => p.name,
      create: (p) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "fw-popover-row";
        row.innerHTML = `<span class="fw-popover-name"></span><span class="fw-popover-meta"></span>`;
        updateRow(row, p);
        return row;
      },
      update: updateRow,
    });
    const none = items.length === 0;
    if (empty.hidden === none) empty.hidden = !none;
    const r = openButton.getBoundingClientRect();
    popover.style.top = `${Math.round(r.bottom + 4)}px`;
    popover.style.left = `${Math.round(r.left)}px`;
    popover.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    list.querySelector<HTMLButtonElement>(".fw-popover-row")?.focus();
  };

  const open = (name: string) => {
    close();
    if (unsaved() && !window.confirm(`Open "${name}"? Unsaved changes to the current session will be lost.`)) return;
    void withNotice(`Opening ${name}`, async () => {
      let opened;
      try {
        opened = await openProject(name);
      } catch (err) {
        return `Could not open ${name}: ${reason(err)}`;
      }
      player.stop();
      engine.loadDocument(opened.document);
      lastSaved = engine.get("document");
      if (nameField && nameField.value !== opened.name) nameField.value = opened.name;
      return `Opened ${opened.name}`;
    });
  };

  saveButton?.addEventListener("click", () => void save());
  openButton?.setAttribute("aria-expanded", "false");
  openButton?.addEventListener("click", () => (popover.hidden ? void show() : close()));
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".fw-popover-row");
    if (row?.dataset.name) open(row.dataset.name);
  });
  nameField?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as Node;
    if (!popover.hidden && !popover.contains(target) && !openButton?.contains(target)) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void save();
    } else if (key === "o") {
      e.preventDefault();
      void show();
    }
  });
}
