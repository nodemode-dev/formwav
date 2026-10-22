// The desktop app's window chrome (src-tauri): the overlay title bar on macOS, caption buttons and a draggable title bar
// on Windows and Linux, the window title, and the native macOS menu's events. Everything here is a no-op in a plain
// browser: it speaks to Tauri only through window.__TAURI_INTERNALS__, so there is no @tauri-apps/api dependency.

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Internals {
  invoke: Invoke;
  transformCallback: (callback: (event: { payload: unknown }) => void, once?: boolean) => number;
  metadata?: { currentWindow?: { label?: string } };
}

function internals(): Internals | null {
  const found = (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__;
  return found && typeof found.invoke === "function" ? found : null;
}

function call(command: string, args?: Record<string, unknown>): void {
  try {
    void Promise.resolve(internals()?.invoke(command, args)).catch(() => undefined);
  } catch {
    /* the shell refused or is gone: the page works the same without it */
  }
}

const isMac = (): boolean => /Mac/.test(navigator.platform) || /Mac/.test(navigator.userAgent);

const WIN_ICONS = {
  min: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9"></path></svg>',
  max: '<svg class="fw-cap-max" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2"></rect></svg>' +
    '<svg class="fw-cap-restore" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="7" height="7" rx="1.2"></rect><path d="M5.5 5.5V4.7A1.2 1.2 0 0 1 6.7 3.5h5.6a1.2 1.2 0 0 1 1.2 1.2v5.6a1.2 1.2 0 0 1-1.2 1.2h-.8"></path></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
};

const TEXT_EDITS = new Set(["undo", "redo", "cut", "copy", "paste", "select-all"]);
const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"]);

function textFieldFocused(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return !active.readOnly && !active.disabled;
  if (active instanceof HTMLInputElement) return !NOT_TEXT.has(active.type) && !active.readOnly && !active.disabled;
  return active instanceof HTMLElement && active.isContentEditable;
}

function windowCall(command: string): void {
  const label = internals()?.metadata?.currentWindow?.label ?? "main";
  call(`plugin:window|${command}`, { label });
}

function mountCaptionButtons(actions: HTMLElement): void {
  const box = document.createElement("span");
  box.className = "fw-caption";
  box.setAttribute("role", "group");
  box.innerHTML =
    `<button class="fw-cap-btn" type="button" data-action="win-min" aria-label="Minimize" title="Minimize">${WIN_ICONS.min}</button>` +
    `<button class="fw-cap-btn" type="button" data-action="win-max" aria-label="Maximize" title="Maximize">${WIN_ICONS.max}</button>` +
    `<button class="fw-cap-btn fw-cap-close" type="button" data-action="win-close" aria-label="Close" title="Close">${WIN_ICONS.close}</button>`;
  actions.append(box);
  const maxButton = box.querySelector<HTMLElement>('[data-action="win-max"]');
  const look = (): void => {
    const shell = internals();
    if (!shell || !maxButton) return;
    const label = shell.metadata?.currentWindow?.label ?? "main";
    void Promise.resolve(shell.invoke("plugin:window|is_maximized", { label }))
      .then((on) => { maxButton.dataset.maximized = on ? "1" : "0"; })
      .catch(() => undefined);
  };
  box.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "win-min") windowCall("minimize");
    else if (action === "win-max") { windowCall("toggle_maximize"); window.setTimeout(look, 150); }
    else if (action === "win-close") windowCall("close");
  });
  window.addEventListener("resize", look, { passive: true });
  look();
}

function mirrorTitle(): void {
  let last = "";
  const send = (): void => {
    if (document.title === last) return;
    last = document.title;
    call("set_window_title", { title: last });
  };
  const watch = new MutationObserver(send);
  const title = document.querySelector("title");
  if (title) watch.observe(title, { childList: true, characterData: true, subtree: true });
  else watch.observe(document.head, { childList: true });
  send();
}

function listenMenu(host: HTMLElement): void {
  const shell = internals();
  if (!shell) return;
  const handler = shell.transformCallback((event) => {
    const id = String(event.payload);
    if (TEXT_EDITS.has(id) && textFieldFocused()) { call("text_edit", { action: id }); return; }
    const claimed = !host.dispatchEvent(new CustomEvent("fw-desktop-menu", { detail: id, cancelable: true }));
    // An edit item nobody answered goes to the web view like the context menu's, so Copy still copies a selection.
    if (!claimed && TEXT_EDITS.has(id)) call("text_edit", { action: id });
  });
  call("plugin:event|listen", { event: "fw-menu", target: { kind: "Any" }, handler });
}

/** Mounts the desktop window chrome once. Does nothing outside the desktop app. */
export function mountDesktop(host: HTMLElement): void {
  if (!internals()) return;
  const root = document.documentElement;
  const header = host.querySelector<HTMLElement>(".fw-topbar");
  if (isMac()) {
    root.classList.add("has-overlay-titlebar");
    listenMenu(host);
  } else {
    const actions = host.querySelector<HTMLElement>(".fw-topbar-actions");
    if (actions && !actions.querySelector(".fw-caption")) mountCaptionButtons(actions);
    root.classList.add("has-caption-buttons");
  }
  if (header) {
    // Tauri drags (and maximizes on a double click) only from an element carrying the attribute itself, so the header and
    // its empty containers carry it; buttons and fields inside them do not and keep their clicks.
    for (const el of [header, ...header.querySelectorAll<HTMLElement>(".fw-titlebar-left, .fw-topbar-mid, .fw-topbar-actions")]) {
      el.setAttribute("data-tauri-drag-region", "");
    }
  }
  mirrorTitle();
}

/** Tells the shell the page has drawn (call right after the reveal): one frame later, so the splash ends on a painted page. */
export function desktopReady(): void {
  if (!internals()) return;
  requestAnimationFrame(() => call("app_ready"));
}
