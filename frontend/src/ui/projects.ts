import type { Engine, SessionDoc } from "../engine";
import type { Player } from "../audio/player";
import { listProjects, openDemo, openProject, RevisionConflict, saveProject, type ProjectSummary } from "../io/projects-client";
import { templateOf } from "../engine/template";
import { delayedIndicator, patchList, setText } from "../vendor/nodemode/dom-stable";
import { currentView } from "./lanes";

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function when(savedAt: string | null): string {
  if (!savedAt) return "unknown date";
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The saved session's name while nothing has changed since it was saved (so the cloud saves it as it is), else null. */
let savedSession: () => string | null = () => null;
export const savedSessionName = (): string | null => savedSession();

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
  let known: { name: string; revision: number } | null = null;
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
      let base = known && known.name === name ? known.revision : 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // AU-34: the view goes with what is sent, not into the engine's document (so it is not an unsaved change)
          const saved = await saveProject(name, { ...doc, view: currentView(engine) }, base);
          known = { name, revision: saved.revision };
          lastSaved = doc;
          savedAt = new Date();
          writeState();
          host.dispatchEvent(new CustomEvent("fw-saved", { detail: name }));
          return `Saved ${name}`;
        } catch (err) {
          if (!(err instanceof RevisionConflict) || attempt > 0) return `Could not save: ${reason(err)}`;
          const question =
            base === 0
              ? `A saved session named "${name}" already exists. Replace it with this one?`
              : `"${name}" was saved from another window after this one opened it. Replace that version with this one?`;
          if (!window.confirm(question)) return `Not saved: "${name}" was kept as it is`;
          base = err.revision;
        }
      }
      return `Could not save ${name}`;
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
    const thumb = row.querySelector<HTMLImageElement>(".fw-session-thumb");
    if (thumb) {
      const src = p.thumbnail ? `/api/projects/${encodeURIComponent(p.name)}/thumbnail.png?r=${p.revision}` : "";
      if (src && thumb.getAttribute("src") !== src) thumb.setAttribute("src", src);
      if (thumb.hidden === !!p.thumbnail) thumb.hidden = !p.thumbnail;
    }
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
        row.innerHTML = `<img class="fw-session-thumb" alt="" width="160" height="32" hidden><span class="fw-popover-name"></span><span class="fw-popover-meta"></span>`;
        updateRow(row, p);
        return row;
      },
      update: updateRow,
    });
    const none = items.length === 0;
    if (empty.hidden === none) empty.hidden = !none;
    // Open lives in the File menu, which has closed by the time the list loads; anchor to whatever is on screen.
    const own = openButton.getBoundingClientRect();
    const r = own.width > 0 ? own : (openButton.closest(".fw-menu")?.querySelector(".fw-menu-btn")?.getBoundingClientRect() ?? own);
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
      if (opened.document.template) {
        // S13: a template starts a new session; saving it never writes over the template
        const { template: _t, ...fresh } = opened.document;
        engine.loadDocument(fresh);
        lastSaved = engine.get("document");
        known = null;
        savedAt = null;
        writeState();
        if (nameField && nameField.value !== "Untitled") nameField.value = "Untitled";
        return `Started a new session from the template ${opened.name}`;
      }
      engine.loadDocument(opened.document);
      lastSaved = engine.get("document");
      known = { name: opened.name, revision: opened.revision };
      savedAt = null;
      writeState();
      if (nameField && nameField.value !== opened.name) nameField.value = opened.name;
      return `Opened ${opened.name}`;
    });
  };
  // The cloud (ui/cloud.ts) opens a session it brought in through the same path, unsaved-changes guard included
  host.addEventListener("fw-open-project", (e) => open((e as CustomEvent<string>).detail));
  // PLAN_v13 S12: File > Open the demo session, a new unsaved session the engine makes in code
  host.querySelector('[data-action="demo"]')?.addEventListener("click", () => {
    if (unsaved() && !window.confirm("Open the demo session? Unsaved changes to the current session will be lost.")) return;
    void withNotice("Making the demo session", async () => {
      let made;
      try {
        made = await openDemo(engine.get("document").tracks.length ? engine.get("document").sampleRate : 48000);
      } catch (err) {
        return `Could not make the demo session: ${reason(err)}`;
      }
      player.stop();
      engine.loadDocument(made.document);
      lastSaved = engine.get("document");
      known = null;
      savedAt = null;
      writeState();
      if (nameField && nameField.value !== made.name) nameField.value = made.name;
      return "Opened the demo session: 16 bars at 104 BPM; save it to keep it";
    });
  });
  savedSession = () => (known && !unsaved() ? known.name : null);
  const docState = host.querySelector<HTMLElement>(".fw-doc-state");
  let savedAt: Date | null = null;
  const writeState = () => {
    const doc = engine.get("document");
    const time = savedAt ? savedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    setText(docState, unsaved() ? (known ? "Unsaved changes" : "Not saved yet") : known ? (time ? `Saved at ${time}` : "No changes since opening") : doc.tracks.length ? "Not saved yet" : "Nothing to save yet");
  };
  engine.subscribe("document", writeState);
  writeState();

  // Audacity's home screen of recent projects: the empty timeline lists the latest saved sessions.
  const emptyStage = host.querySelector<HTMLElement>(".fw-empty");
  const recent = document.createElement("div");
  recent.className = "fw-recent";
  recent.hidden = true;
  emptyStage?.append(recent);
  const showRecent = async () => {
    let items: ProjectSummary[] = [];
    try {
      items = await listProjects();
    } catch {
      items = [];
    }
    const top = [...items].sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? "")).slice(0, 6);
    const heading = document.createElement("h2");
    heading.className = "fw-recent-title";
    heading.textContent = "Recent sessions";
    recent.replaceChildren(
      ...(top.length ? [heading] : []),
      ...top.map((p) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "fw-recent-row";
        row.dataset.name = p.name;
        const title = document.createElement("span");
        title.className = "fw-recent-name";
        title.textContent = p.name;
        const meta = document.createElement("span");
        meta.className = "fw-recent-meta";
        meta.textContent = `${p.tracks} track${p.tracks === 1 ? "" : "s"}${p.savedAt ? ` · ${new Date(p.savedAt).toLocaleDateString()}` : ""}`;
        if (p.thumbnail) {
          const thumb = document.createElement("img");
          thumb.className = "fw-session-thumb";
          thumb.alt = "";
          thumb.width = 160;
          thumb.height = 32;
          thumb.src = `/api/projects/${encodeURIComponent(p.name)}/thumbnail.png?r=${p.revision}`;
          row.append(thumb);
        }
        row.append(title, meta);
        return row;
      }),
    );
    if (recent.hidden === top.length > 0) recent.hidden = top.length === 0;
  };
  recent.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".fw-recent-row");
    if (row?.dataset.name) open(row.dataset.name);
  });
  let wasEmpty = true;
  engine.subscribe("document", (doc) => {
    const isEmpty = doc.tracks.length === 0;
    if (isEmpty && !wasEmpty) void showRecent();
    wasEmpty = isEmpty;
  });
  void showRecent();

  saveButton?.addEventListener("click", () => void save());
  // S13: Save as template (asked for a name through the editing dialog) and Revert to saved (Open's own guard asks
  // before the changes go)
  host.querySelector('[data-action="save-template"]')?.addEventListener("click", () => {
    const doc = engine.get("document");
    if (!doc.tracks.length) return setText(notice, "Add a track first: a template keeps the tracks, buses and effects");
    const asked = new Promise<Record<string, unknown> | null>((done) =>
      host.dispatchEvent(new CustomEvent("fw-ask", { detail: { title: "Save as template", note: "The tracks, buses, routing, effects, automation, tempo and markers, without the audio. Open it to start a new session from it.", fields: [{ key: "name", label: "Name", value: `${sessionName()} template`, text: true }], ok: "Save", done } })),
    );
    void asked.then((v) => {
      const name = typeof v?.name === "string" ? v.name.trim() : "";
      if (!name) return;
      void withNotice(`Saving the template ${name}`, async () => {
        try {
          await saveProject(name, templateOf(doc), 0);
        } catch (err) {
          if (!(err instanceof RevisionConflict) || !window.confirm(`A saved session named "${name}" already exists. Replace it with this template?`)) return `Could not save the template: ${reason(err)}`;
          await saveProject(name, templateOf(doc), err.revision);
        }
        return `Saved the template ${name}: open it to start a new session from it`;
      });
    });
  });
  host.querySelector('[data-action="revert"]')?.addEventListener("click", () => {
    if (!known) return setText(notice, "Nothing to revert to: this session has not been saved");
    if (!unsaved()) return setText(notice, `No changes since ${known.name} was saved`);
    open(known.name);
  });
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

  // The desktop app hands over a .fmw the user opened with it as ?open=<path> (src-tauri main.rs); the address is
  // cleaned first so a reload does not open it again.
  const handed = new URLSearchParams(location.search).get("open");
  if (handed) {
    history.replaceState(null, "", location.pathname);
    void withNotice(`Opening ${handed.split(/[\\/]/).pop()}`, async () => {
      const res = await fetch("/api/projects/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: handed }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return `Could not open ${handed}: ${typeof out.detail === "string" ? out.detail : res.status}`;
      player.stop();
      engine.loadDocument(out.document);
      lastSaved = engine.get("document");
      known = { name: out.name, revision: out.revision };
      savedAt = null;
      writeState();
      if (nameField && nameField.value !== out.name) nameField.value = out.name;
      return `Opened ${out.name}`;
    });
  }
}
