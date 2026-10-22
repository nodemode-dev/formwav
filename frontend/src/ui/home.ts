import type { Engine } from "../engine";
import { listProjects, type ProjectSummary } from "../io/projects-client";
import { setText } from "../vendor/nodemode/dom-stable";
import { icon as fvIcon } from "../vendor/formvis/icons";
import { icon, ICON_SIZE } from "./icons";

const AT_LAUNCH = "formwav.homeAtLaunch";
const FORMATS = ["WAV", "AIFF", "FLAC", "MP3", "M4A", "OGG", "MIDI", "FMW"];

/** Whether Home shows when formwav starts with no session (Preferences > General); on unless turned off. */
export function homeAtLaunch(): boolean {
  try {
    return localStorage.getItem(AT_LAUNCH) !== "0";
  } catch {
    return true;
  }
}
export function setHomeAtLaunch(on: boolean): void {
  try {
    localStorage.setItem(AT_LAUNCH, on ? "1" : "0");
  } catch {
    /* storage blocked: this visit only */
  }
}

export const HOME_HTML = `<section class="fw-home" aria-label="Home" hidden>
  <nav class="fw-home-nav" aria-label="Home pages">
    <div class="fw-home-brand"><span class="fw-home-logo"><img src="/logo-64.png" width="24" height="24" alt="" draggable="false"></span><span><b>formwav</b> <span class="fw-home-by">by NodeMode</span></span></div>
    <div class="fw-home-group">
      <button type="button" class="fw-home-item is-active" data-home-page="start">${fvIcon("menu", 16)}<span>Start</span></button>
      <button type="button" class="fw-home-item" data-home-page="recent">${fvIcon("history", 16)}<span>Recent</span><span class="fw-home-count" data-home-count translate="no"></span></button>
    </div>
    <div class="fw-home-group">
      <div class="fw-home-label">Create</div>
      <button type="button" class="fw-home-item" data-home-act="new">${fvIcon("newFile", 16)}<span>New session</span></button>
      <button type="button" class="fw-home-item" data-home-act="open">${icon("folderOpen", ICON_SIZE.control)}<span>Open a session</span></button>
      <button type="button" class="fw-home-item" data-home-act="import">${icon("upload", ICON_SIZE.control)}<span>Import audio</span></button>
      <button type="button" class="fw-home-item" data-home-act="record">${icon("record", ICON_SIZE.control)}<span>Record</span></button>
      <button type="button" class="fw-home-item" data-home-act="demo">${icon("play", ICON_SIZE.control)}<span>Try the demo</span></button>
    </div>
    <div class="fw-home-foot">
      <button type="button" class="fw-home-item" data-home-act="back">${fvIcon("chevronLeft", 16)}<span>Back to session</span></button>
      <button type="button" class="fw-home-item" data-home-act="prefs">${icon("settings", ICON_SIZE.control)}<span>Preferences</span></button>
      <button type="button" class="fw-home-item" data-home-act="help">${fvIcon("info", 16)}<span>Keyboard shortcuts</span></button>
    </div>
  </nav>
  <div class="fw-home-main">
    <div class="fw-home-page" data-home-view="start">
      <h1 class="fw-home-title" data-home-greeting>Welcome</h1>
      <p class="fw-home-sub">Record, edit, repair and mix on this computer.</p>
      <div class="fw-home-hero">
        <div class="fw-home-hero-text">
          <h2 class="fw-home-hero-title">Start a session</h2>
          <p class="fw-home-hero-body">Drop audio or video anywhere in the window, or start from one of these.</p>
          <div class="fw-home-formats" translate="no">${FORMATS.map((f) => `<span class="fw-home-chip">${f}</span>`).join("")}</div>
        </div>
        <div class="fw-home-actions">
          <button type="button" class="fw-home-btn is-primary" data-home-act="import">${icon("upload", ICON_SIZE.control)}<span>Import audio</span></button>
          <button type="button" class="fw-home-btn" data-home-act="open">${icon("folderOpen", ICON_SIZE.control)}<span>Open a session</span><kbd>⌘O</kbd></button>
          <button type="button" class="fw-home-btn" data-home-act="new">${fvIcon("newFile", 16)}<span>New session</span><kbd>⌘N</kbd></button>
        </div>
      </div>
      <div class="fw-home-section-head"><h2 class="fw-home-section-title">Recent sessions</h2><button type="button" class="fw-home-link" data-home-page="recent">Show all</button></div>
      <div class="fw-home-grid" data-home-recent="6" data-empty="Sessions you save show up here"></div>
    </div>
    <div class="fw-home-page" data-home-view="recent" hidden>
      <h1 class="fw-home-title">Recent sessions</h1>
      <p class="fw-home-sub">Every session saved on this computer, newest first.</p>
      <div class="fw-home-grid" data-home-recent="all" data-empty="Sessions you save show up here"></div>
    </div>
  </div>
</section>`;

/**
 * Home (formvis's HomeScreen, the BARS map section A): a page over the workspace, built once in the shell's markup and
 * shown or hidden, never rebuilt. It shows at launch when no session is open (unless turned off in Preferences), from
 * the brand button and View > Home; it hides on Back to session, Escape, any of its actions, or when a session gets
 * tracks. Its actions are the empty stage's own (proxied, so there is one path for each), its sessions the engine's
 * saved ones (/api/projects), opened through projects.ts (fw-open-project).
 */
export function mountHome(host: HTMLElement, engine: Engine): { show: () => void; hide: () => void } {
  const home = host.querySelector<HTMLElement>(".fw-home");
  const none = { show: () => {}, hide: () => {} };
  if (!home) return none;
  const greeting = home.querySelector<HTMLElement>("[data-home-greeting]");
  const count = home.querySelector<HTMLElement>("[data-home-count]");
  const grids = [...home.querySelectorAll<HTMLElement>("[data-home-recent]")];
  const greet = () => {
    const h = new Date().getHours();
    setText(greeting, h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  };
  const fill = async () => {
    let items: ProjectSummary[] = [];
    try {
      items = await listProjects();
    } catch {
      items = [];
    }
    const sorted = [...items].sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
    setText(count, sorted.length ? String(sorted.length) : "");
    for (const grid of grids) {
      const take = grid.dataset.homeRecent === "all" ? sorted : sorted.slice(0, Number(grid.dataset.homeRecent) || 6);
      grid.replaceChildren(
        ...take.map((p) => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "fw-home-card";
          card.dataset.name = p.name;
          const thumb = document.createElement("span");
          thumb.className = "fw-home-thumb";
          if (p.thumbnail) {
            const img = document.createElement("img");
            img.alt = "";
            img.width = 160;
            img.height = 32;
            img.src = `/api/projects/${encodeURIComponent(p.name)}/thumbnail.png?r=${p.revision}`;
            thumb.append(img);
          } else thumb.innerHTML = icon("waveform", 20);
          const name = document.createElement("span");
          name.className = "fw-home-card-name";
          name.translate = false;
          name.textContent = p.name;
          const meta = document.createElement("span");
          meta.className = "fw-home-card-meta";
          meta.textContent = `${p.tracks} track${p.tracks === 1 ? "" : "s"}${p.savedAt ? ` · ${new Date(p.savedAt).toLocaleDateString()}` : ""}`;
          card.append(thumb, name, meta);
          return card;
        }),
      );
    }
  };
  const page = (id: string) => {
    for (const v of home.querySelectorAll<HTMLElement>("[data-home-view]")) {
      const want = v.dataset.homeView !== id;
      if (v.hidden !== want) v.hidden = want;
    }
    for (const b of home.querySelectorAll<HTMLElement>(".fw-home-nav [data-home-page]")) b.classList.toggle("is-active", b.dataset.homePage === id);
  };
  const show = () => {
    greet();
    void fill();
    if (home.hidden) home.hidden = false;
    document.documentElement.dataset.home = "open";
  };
  const hide = () => {
    if (!home.hidden) home.hidden = true;
    delete document.documentElement.dataset.home;
  };
  const proxy = (sel: string) => host.querySelector<HTMLElement>(sel)?.click();
  home.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const pageBtn = t.closest<HTMLElement>("[data-home-page]");
    if (pageBtn?.dataset.homePage) return page(pageBtn.dataset.homePage);
    const card = t.closest<HTMLElement>(".fw-home-card");
    if (card?.dataset.name) {
      hide();
      host.dispatchEvent(new CustomEvent("fw-open-project", { detail: card.dataset.name }));
      return;
    }
    const act = t.closest<HTMLElement>("[data-home-act]")?.dataset.homeAct;
    if (!act) return;
    hide();
    if (act === "new") proxy('.fw-topbar [data-action="new"]');
    else if (act === "open") proxy('.fw-topbar [data-action="open"]');
    else if (act === "import" || act === "record" || act === "demo") proxy(`.fw-empty-actions [data-empty-act="${act}"]`);
    else if (act === "prefs") host.dispatchEvent(new CustomEvent("fw-preferences"));
    else if (act === "help") host.dispatchEvent(new CustomEvent("fw-shortcuts"));
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !home.hidden && !document.querySelector("dialog[open]")) hide();
  });
  host.querySelector(".fw-identity")?.addEventListener("click", () => (home.hidden ? show() : hide()));
  host.addEventListener("fw-home", () => show());
  // a session with tracks takes the window: Home steps aside (an import, an opened session, a recording)
  engine.subscribe("document", (doc) => {
    if (doc.tracks.length && !home.hidden) hide();
  });
  greet();
  if (homeAtLaunch() && !engine.get("document").tracks.length && !new URLSearchParams(location.search).has("open")) show();
  return { show, hide };
}
