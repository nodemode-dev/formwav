import type { Engine } from "../engine";
import { applyCommand, type Command } from "../engine/document";
import { describeCommand } from "../engine/describe";
import { isCommandType } from "../engine/catalogue";
import { inspectSession } from "../engine/inspect";
import { ERR, ExtensionHost, HostError, PERMISSION_WORDS, type ExtensionRecord, type Frame, type HostHandlers, type PanelDef, type Permission, type Theme } from "../vendor/formext/host-bridge";
import { patchList, setText } from "../vendor/nodemode/dom-stable";
import { commands, type Json } from "./commands";
import { savedSessionName } from "./projects";

export interface ExtensionRow extends ExtensionRecord {
  kind?: string;
}
interface ListAnswer {
  appVersion: string;
  stamp: number[];
  manage: string;
  extensions: ExtensionRow[];
}
type Range = { trackId: string; start: number; end: number; more?: string[] } | null;

const SOURCE: Record<string, string> = { catalogue: "Catalogue", sideload: "File", development: "Development" };
const CHIP: Record<Permission, string> = { document: "Document", "files-read": "Open files", "files-write": "Save files", network: "Internet", models: "Local models", "native-code": "Native code" };
const MAX_OPEN = 200 * 1024 * 1024;
const POLL_MS = 2000;
const CLOSE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`;

let listNow: () => ExtensionRow[] = () => [];
let runNow: (id: string, command: string, args: unknown) => Promise<unknown> = async () => {
  throw new HostError(ERR.UNAVAILABLE, "extensions are not loaded");
};
let stateNow: (ext: ExtensionRow) => string = (ext) => ext.state;

export const extensionsApi = {
  list: () =>
    listNow().map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      source: e.source,
      state: stateNow(e),
      ...(e.reason ? { reason: e.reason } : {}),
      permissions: e.permissions,
      commands: e.commands.map((c) => ({ id: c.id, title: c.title, ...(c.panel ? { panel: c.panel } : {}) })),
      panels: e.panels,
      ...(e.path ? { path: e.path } : {}),
    })),
  run: (id: string, command: string, args: unknown) => runNow(id, command, args),
};

const base64Of = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function themeNow(): Theme {
  const style = getComputedStyle(document.body);
  const v = (n: string) => style.getPropertyValue(n).trim();
  const tokens: Record<string, string> = {
    "--bg": v("--bg-primary"),
    "--panel": v("--bg-secondary"),
    "--text": v("--text-primary"),
    "--muted": v("--text-secondary"),
    "--accent": v("--accent-color"),
    "--border": v("--border-color"),
    "--radius": v("--radius"),
  };
  for (const n of ["--bg-primary", "--bg-secondary", "--bg-tertiary", "--text-primary", "--text-secondary", "--accent-color", "--border-color", "--font-ui", "--font-mono"]) tokens[n] = v(n);
  return { mode: document.body.classList.contains("theme-light") ? "light" : "dark", tokens };
}

export function mountExtensions(host: HTMLElement, engine: Engine): void {
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  const menuPop = host.querySelector<HTMLElement>(".fw-ext-pop");
  const menuList = menuPop?.querySelector<HTMLElement>(".fw-ext-menu-commands") ?? null;
  const menuSep = menuPop?.querySelector<HTMLElement>(".fw-ext-menu-sep") ?? null;
  const anchor = host.querySelector<HTMLElement>(".fw-pane-timeline .fw-dock-anchor");
  const view = host.querySelector<HTMLElement>('.fw-tool-tray [data-group="view"]');

  const panel = document.createElement("section");
  panel.className = "fw-editor-panel fw-ext-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Extensions");
  panel.innerHTML = `<div class="fw-ext-head"><span class="fw-ext-tabs" role="tablist" aria-label="Extensions"><button type="button" role="tab" class="fw-ext-tab" data-ext-tab="installed" aria-selected="true">Installed</button></span><span class="fw-ext-head-end"><button type="button" class="fw-ibtn" data-ext-act="reload" title="Read the installed and development extensions again">Reload</button><button type="button" class="fw-ibtn" data-ext-act="manage" title="Install, update and remove extensions in FormPortal">Manage in FormPortal</button></span></div><div class="fw-ext-body" data-ext-view="installed"><div class="fw-ext-list" role="list" aria-label="Extensions"></div><div class="fw-ext-empty" hidden><p class="fw-ext-empty-text">No extensions yet. Find them in FormPortal or make one with form.ext.</p><button type="button" class="fw-ibtn" data-ext-act="manage">Manage in FormPortal</button></div></div>`;
  (anchor ?? host).before(panel);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fw-mode";
  toggle.dataset.extToggle = "";
  toggle.setAttribute("aria-pressed", "false");
  toggle.title = "Show the Extensions panel";
  toggle.textContent = "Extensions";
  (view ?? host).append(toggle);
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-pressed", String(!panel.hidden));
  });
  const tabs = panel.querySelector<HTMLElement>(".fw-ext-tabs") as HTMLElement;
  const list = panel.querySelector<HTMLElement>(".fw-ext-list") as HTMLElement;
  const empty = panel.querySelector<HTMLElement>(".fw-ext-empty") as HTMLElement;
  const installed = panel.querySelector<HTMLElement>('[data-ext-view="installed"]') as HTMLElement;

  const headless = document.createElement("div");
  headless.className = "fw-ext-headless";
  headless.setAttribute("aria-hidden", "true");
  document.body.append(headless);

  const consent = document.createElement("dialog");
  consent.className = "fw-export-dialog fw-ext-consent";
  consent.innerHTML = `<form method="dialog"><h2 class="fw-dialog-title">Allow this extension?</h2><p class="fw-ext-consent-who" translate="no"></p><p class="fw-ext-consent-note">It asks to:</p><ul class="fw-ext-consent-list"></ul><div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="no">Not now</button><button type="submit" class="fw-ibtn fw-ext-allow" value="yes">Allow</button></div></form>`;
  document.body.append(consent);
  const consentList = consent.querySelector<HTMLElement>(".fw-ext-consent-list") as HTMLElement;
  const confirmSave = document.createElement("dialog");
  confirmSave.className = "fw-export-dialog fw-ext-consent fw-ext-save";
  confirmSave.innerHTML = `<form method="dialog"><h2 class="fw-dialog-title">Save this file?</h2><p class="fw-ext-consent-who fw-ext-save-name" translate="no"></p><p class="fw-ext-consent-note">It goes into your Downloads folder.</p><div class="fw-dialog-actions"><button type="submit" class="fw-ibtn" value="no">Cancel</button><button type="submit" class="fw-ibtn fw-ext-allow" value="yes">Save</button></div></form>`;
  document.body.append(confirmSave);
  const dialogs = new Map<string, HTMLDialogElement>();

  let rows: ExtensionRow[] = [];
  let signatures = new Map<string, string>();
  let stamp = "";
  let loaded = false;
  let selected: string[] = [];
  let range: Range = null;

  const sec = (n: number) => Math.round((n / engine.get("document").sampleRate) * 1e6) / 1e6;
  const say = (text: string) => setText(notice, text);
  const byId = (id: string) => rows.find((r) => r.id === id);

  const askConsent = (ext: ExtensionRecord) =>
    new Promise<boolean>((done) => {
      setText(consent.querySelector(".fw-ext-consent-who"), `${ext.name} ${ext.version} (${SOURCE[ext.source] ?? ext.source})`);
      consentList.replaceChildren(...ext.permissions.map((p) => Object.assign(document.createElement("li"), { textContent: PERMISSION_WORDS[p] ?? p })));
      consent.returnValue = "";
      consent.addEventListener("close", () => done(consent.returnValue === "yes"), { once: true });
      consent.showModal();
      consent.querySelector<HTMLButtonElement>(".fw-ext-allow")?.focus();
    });

  const selection = () => {
    const doc = engine.get("document");
    const clips = doc.tracks.flatMap((t) => t.clips.filter((c) => selected.includes(c.id)).map((c) => ({ track_id: t.id, clip_id: c.id, name: c.name ?? (doc.media[c.mediaId]?.name ?? "").replace(/\.[^.]+$/, ""), start_s: sec(c.start), length_s: sec(c.length) })));
    return { clips, range: range ? { track_id: range.trackId, tracks: [range.trackId, ...(range.more ?? [])], start: range.start, end: range.end, start_s: sec(range.start), end_s: sec(range.end) } : null };
  };

  const readDocument = (_ext: ExtensionRecord, params: { what?: string }) => {
    const doc = engine.get("document");
    const t = engine.get("transport");
    const what = params.what ?? "session";
    if (what === "selection") return { ...selection(), playhead_s: sec(t.positionSamples) };
    if (what === "markers")
      return {
        sample_rate: doc.sampleRate,
        markers: doc.markers.map((m) => ({ id: m.id, at: m.at, at_s: sec(m.at), label: m.label, ...(m.number !== undefined ? { number: m.number } : {}), ...(m.comment ? { comment: m.comment } : {}), ...(m.color ? { color: m.color } : {}), ...(m.clipId ? { clip_id: m.clipId } : {}) })),
        regions: (doc.regions ?? []).map((r) => ({ id: r.id, start: r.start, end: r.end, start_s: sec(r.start), end_s: sec(r.end), label: r.label, ...(r.number !== undefined ? { number: r.number } : {}), ...(r.comment ? { comment: r.comment } : {}), ...(r.color ? { color: r.color } : {}) })),
      };
    if (what === "media") return { media: Object.values(doc.media).map((m) => ({ id: m.id, name: m.name, sample_rate: m.sampleRate, channels: m.channels, frames: m.frames, seconds: Math.round((m.frames / m.sampleRate) * 1000) / 1000 })) };
    if (what === "transport") return { playhead_s: sec(t.positionSamples), playing: t.playing, recording: t.recording, loop: doc.loop ? { start_s: sec(doc.loop.start), end_s: sec(doc.loop.end), enabled: doc.loop.enabled } : null };
    if (what !== "session") throw new HostError(ERR.INVALID, `what must be session, selection, markers, media or transport, not ${what}`);
    const { done } = engine.historyEntries();
    return {
      product: "formwav",
      name: host.querySelector<HTMLInputElement>(".fw-session-name")?.value ?? "",
      ...inspectSession(doc, {
        regions: (doc.regions ?? []).map((r) => ({ id: r.id, label: r.label, start_s: sec(r.start), end_s: sec(r.end) })),
        playhead_s: sec(t.positionSamples),
        selection: selection(),
        undo: done.length ? done[done.length - 1].label : null,
        steps: done.length,
        unsaved: savedSessionName() === null && doc.tracks.length > 0,
      }),
    };
  };

  const applyDocument = async (ext: ExtensionRecord, label: string, ops: { command: string; args?: unknown }[]) => {
    if (!ops.length) throw new HostError(ERR.INVALID, "give at least one op");
    const list: Command[] = ops.map((op) => {
      if (!isCommandType(op.command) || op.command === "batch") throw new HostError(ERR.INVALID, `formwav has no session command ${op.command}`);
      const args = op.args && typeof op.args === "object" && !Array.isArray(op.args) ? (op.args as Json) : {};
      return { ...args, type: op.command } as unknown as Command;
    });
    const before = engine.get("document");
    const batch = { type: "batch", commands: list, label: label.slice(0, 80) || ext.name, whole: true } as Command;
    const changed = engine.dispatch(batch) !== false && engine.get("document") !== before;
    if (!changed && applyCommand(before, { type: "batch", commands: list }, () => "probe") !== before) throw new HostError(ERR.REFUSED, "the session refused these changes: a clip they touch is locked");
    return { applied: changed ? list.length : 0, results: list.map((c) => ({ command: c.type, changed })), step: changed ? describeCommand(batch, before) : null };
  };

  const appCommands = () =>
    commands
      .all()
      .filter((c) => !c.id.startsWith("extension."))
      .map((c) => {
        const d = commands.describe(c);
        return { id: d.id, title: d.label, group: d.group, args: d.params, mutates: d.mutates, risky: d.risky };
      });

  const appRun = async (_ext: ExtensionRecord, id: string, args: unknown) => {
    if (id.startsWith("extension.")) throw new HostError(ERR.REFUSED, "an extension cannot run another extension's command");
    const r = await commands.call(id, args && typeof args === "object" && !Array.isArray(args) ? (args as Json) : {});
    if (!r.ok) throw new HostError(ERR.REFUSED, r.error ?? `${id} failed`);
    return { result: r.result ?? null, step: r.undoName ?? null };
  };

  const openFiles = (_ext: ExtensionRecord, accept: string[], multiple: boolean) =>
    new Promise<{ name: string; type: string; size: number; data: string }[]>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.hidden = true;
      if (accept.length) input.accept = accept.join(",");
      input.multiple = multiple;
      document.body.append(input);
      const end = () => input.remove();
      input.addEventListener("cancel", () => {
        end();
        reject(new HostError(ERR.CANCELLED, "no file was chosen"));
      });
      input.addEventListener("change", async () => {
        const files = [...(input.files ?? [])];
        end();
        if (!files.length) return reject(new HostError(ERR.CANCELLED, "no file was chosen"));
        if (files.reduce((n, f) => n + f.size, 0) > MAX_OPEN) return reject(new HostError(ERR.REFUSED, "the files are larger than 200 MB together"));
        resolve(await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, size: f.size, data: base64Of(await f.arrayBuffer()) }))));
      });
      input.click();
    });

  const saveFile = async (_ext: ExtensionRecord, name: string, type: string, data: string) => {
    const blob = new Blob([bytesOf(data)], { type });
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ name: string; createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({ suggestedName: name });
        const out = await handle.createWritable();
        await out.write(blob);
        await out.close();
        return { saved: true, name: handle.name };
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") throw new HostError(ERR.CANCELLED, "the save was cancelled");
        throw new HostError(ERR.REFUSED, `could not save ${name}`);
      }
    }
    setText(confirmSave.querySelector(".fw-ext-save-name"), name);
    confirmSave.returnValue = "";
    const yes = await new Promise<boolean>((done) => {
      confirmSave.addEventListener("close", () => done(confirmSave.returnValue === "yes"), { once: true });
      confirmSave.showModal();
      confirmSave.querySelector<HTMLButtonElement>(".fw-ext-allow")?.focus();
    });
    if (!yes) throw new HostError(ERR.CANCELLED, "the save was cancelled");
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { saved: true, name };
  };

  const netFetch = async (_ext: ExtensionRecord, req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
    const res = await fetch("/api/extensions/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body: req.body }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new HostError(ERR.REFUSED, typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
    return out as { status: number; headers: Record<string, string>; body: string };
  };

  const handlers: HostHandlers = {
    product: "formwav",
    app: "formwav",
    appVersion: "",
    locale: () => document.documentElement.lang || "en",
    theme: themeNow,
    notify: (ext, message) => say(`${ext.name}: ${message}`),
    setTitle: (ext, frame, title) => {
      const text = `${ext.name}: ${title || ext.name}`;
      for (const d of dialogs.values()) if (d.contains(frame)) setText(d.querySelector(".fw-dialog-title"), text);
      const viewEl = frame.closest<HTMLElement>(".fw-ext-view");
      if (viewEl) setText(tabs.querySelector(`[data-ext-tab="${CSS.escape(viewEl.dataset.extView ?? "")}"] .fw-ext-tab`), text);
    },
    readDocument,
    applyDocument,
    commands: appCommands,
    run: appRun,
    openFiles,
    saveFile,
    fetch: netFetch,
    consent: askConsent,
  };
  const extHost = new ExtensionHost(handlers);
  stateNow = (ext) => (ext.state === "refused" ? "refused" : extHost.isGranted(ext) ? "ready" : "needs-permission");

  const views = new Map<string, { frame: Frame; el: HTMLElement; tab: HTMLElement }>();
  const showView = (key: string) => {
    for (const b of tabs.querySelectorAll<HTMLElement>("[data-ext-tab]")) {
      const tab = b.matches(".fw-ext-tab") ? b : b.querySelector<HTMLElement>(".fw-ext-tab");
      const on = String(b.dataset.extTab === key);
      if (tab && tab.getAttribute("aria-selected") !== on) tab.setAttribute("aria-selected", on);
    }
    if (installed.hidden !== (key !== "installed")) installed.hidden = key !== "installed";
    for (const [k, v] of views) if (v.el.hidden !== (k !== key)) v.el.hidden = k !== key;
    if (panel.hidden) toggle.click();
  };
  const closeView = (key: string) => {
    const v = views.get(key);
    if (!v) return;
    v.frame.dispose();
    v.el.remove();
    v.tab.remove();
    views.delete(key);
    if (!installed.hidden || [...views.values()].some((x) => !x.el.hidden)) return;
    showView("installed");
  };

  const openPanel = async (ext: ExtensionRow, panelId: string, activation?: { command?: string; args?: unknown }) => {
    const def: PanelDef | undefined = ext.panels.find((p) => p.id === panelId);
    if (!def) throw new HostError(ERR.NOT_FOUND, `${ext.name} has no panel ${panelId}`);
    if (ext.state !== "ready") throw new HostError(ERR.REFUSED, `${ext.name} is refused: ${ext.reason ?? ""}`);
    const refused = () => {
      paint();
      say(`${ext.name} was not allowed to open`);
      return new HostError(ERR.PERMISSION, `${ext.name} was not allowed to run`);
    };
    const title = `${ext.name}: ${def.title}`;
    const key = `${ext.id}/${def.id}`;
    const reason = activation?.command ? { reason: "command" as const, panel: def.id, command: activation.command, args: activation.args } : { reason: "panel" as const, panel: def.id };
    if (def.location === "dialog") {
      let dialog = dialogs.get(key);
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.className = "fw-export-dialog fw-ext-dialog";
        dialog.innerHTML = `<h2 class="fw-dialog-title" translate="no"></h2><div class="fw-ext-dialog-body"></div><div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-ext-close>Close</button></div>`;
        const d = dialog;
        const body = d.querySelector<HTMLElement>(".fw-ext-dialog-body") as HTMLElement;
        const opened = await extHost.open(ext, body, { onResize: (h) => body.style.setProperty("--fw-ext-h", `${h}px`) });
        if (!opened) throw refused();
        paint();
        const frame = opened;
        document.body.append(d);
        d.querySelector("[data-ext-close]")?.addEventListener("click", () => d.close());
        d.addEventListener("close", () => {
          frame.dispose();
          d.remove();
          dialogs.delete(key);
        });
        dialogs.set(key, d);
        setText(d.querySelector(".fw-dialog-title"), title);
        d.showModal();
        await frame.activate(reason);
        return { opened: key };
      }
      return { opened: key };
    }
    let v = views.get(key);
    if (!v) {
      const el = document.createElement("div");
      el.className = "fw-ext-view";
      el.dataset.extView = key;
      el.hidden = true;
      const frame = await extHost.open(ext, el);
      if (!frame) throw refused();
      paint();
      const tab = document.createElement("span");
      tab.className = "fw-ext-tabwrap";
      tab.dataset.extTab = key;
      tab.innerHTML = `<button type="button" role="tab" class="fw-ext-tab" aria-selected="false" translate="no"></button><button type="button" class="fw-ext-tab-x" aria-label="Close this panel" title="Close this panel">${CLOSE_ICON}</button>`;
      setText(tab.querySelector(".fw-ext-tab"), title);
      tabs.append(tab);
      panel.append(el);
      v = { frame, el, tab };
      views.set(key, v);
      tab.querySelector(".fw-ext-tab")?.addEventListener("click", () => showView(key));
      tab.querySelector(".fw-ext-tab-x")?.addEventListener("click", () => closeView(key));
      showView(key);
      await frame.activate(reason);
    } else {
      showView(key);
      if (activation?.command) await v.frame.activate(reason);
    }
    return { opened: key };
  };

  const runCommand = async (id: string, commandId: string, args: unknown) => {
    const ext = byId(id);
    if (!ext) throw new HostError(ERR.NOT_FOUND, `there is no extension ${id}; extensions_list gives the ids`);
    if (ext.state !== "ready") throw new HostError(ERR.REFUSED, `${ext.name} is refused: ${ext.reason ?? ""}`);
    const command = ext.commands.find((c) => c.id === commandId);
    if (!command) throw new HostError(ERR.NOT_FOUND, `${ext.name} has no command ${commandId}`);
    if (command.panel) return openPanel(ext, command.panel, { command: commandId, args });
    try {
      const result = await extHost.runCommand(ext, commandId, args ?? {}, headless);
      return { result: result ?? null };
    } finally {
      paint();
    }
  };
  runNow = runCommand;
  listNow = () => rows;

  const commandIds = new Set<string>();
  const syncCommands = () => {
    const wanted = new Map<string, { ext: ExtensionRow; id: string; title: string }>();
    for (const ext of rows) if (ext.state === "ready") for (const c of ext.commands) wanted.set(`extension.${ext.id}.${c.id}`, { ext, id: c.id, title: c.title });
    for (const id of [...commandIds]) {
      const w = wanted.get(id);
      if (w && signatures.get(id) === JSON.stringify([w.ext.name, w.ext.version, w.title])) continue;
      commands.remove(id);
      commandIds.delete(id);
    }
    for (const [cid, w] of wanted) {
      if (commandIds.has(cid)) continue;
      commands.add({
        id: cid,
        label: `${w.ext.name}: ${w.title}`,
        group: "Extensions",
        description: `${w.ext.name}: ${w.title} (an extension, ${w.ext.id} ${w.ext.version})`,
        params: { args: { type: "object", description: "What the extension's command takes" } },
        run: (params) => runCommand(w.ext.id, w.id, params.args ?? {}),
      });
      commandIds.add(cid);
      signatures.set(cid, JSON.stringify([w.ext.name, w.ext.version, w.title]));
    }
    const items = rows.filter((e) => e.state === "ready").flatMap((ext) => ext.commands.map((c) => ({ ext, c })));
    if (menuList)
      patchList(menuList, items, {
        key: (x) => `${x.ext.id}.${x.c.id}`,
        create: (x) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "fw-ibtn";
          b.setAttribute("role", "menuitem");
          b.dataset.extCommand = `${x.ext.id}.${x.c.id}`;
          b.innerHTML = "<span></span>";
          setText(b.firstElementChild, `${x.ext.name}: ${x.c.title}`);
          return b;
        },
        update: (b, x) => setText(b.firstElementChild, `${x.ext.name}: ${x.c.title}`),
      });
    if (menuSep && menuSep.hidden !== !items.length) menuSep.hidden = !items.length;
  };

  const rowNode = () => {
    const row = document.createElement("div");
    row.className = "fw-ext-row";
    row.setAttribute("role", "listitem");
    row.innerHTML = `<div class="fw-ext-line"><strong class="fw-ext-name" translate="no"></strong><span class="fw-ext-version" translate="no"></span><span class="fw-ext-source"></span><span class="fw-ext-state"></span><span class="fw-ext-acts"></span></div><p class="fw-ext-desc" translate="no"></p><div class="fw-ext-chips"></div><p class="fw-ext-reason" translate="no" hidden></p><p class="fw-ext-path" translate="no" hidden></p>`;
    return row;
  };
  const STATE_WORDS: Record<string, string> = { ready: "Ready", "needs-permission": "Needs permission", refused: "Refused" };
  const updateRow = (row: HTMLElement, ext: ExtensionRow) => {
    setText(row.querySelector(".fw-ext-name"), ext.name);
    setText(row.querySelector(".fw-ext-version"), ext.version);
    setText(row.querySelector(".fw-ext-source"), SOURCE[ext.source] ?? ext.source);
    const state = stateNow(ext);
    const stateEl = row.querySelector<HTMLElement>(".fw-ext-state");
    if (stateEl && stateEl.dataset.state !== state) stateEl.dataset.state = state;
    setText(stateEl, STATE_WORDS[state]);
    setText(row.querySelector(".fw-ext-desc"), ext.description ?? "");
    const chips = row.querySelector<HTMLElement>(".fw-ext-chips") as HTMLElement;
    patchList(chips, ext.permissions, {
      key: (p) => p,
      create: (p) => Object.assign(document.createElement("span"), { className: "fw-ext-chip", textContent: CHIP[p] ?? p, title: PERMISSION_WORDS[p] ?? p }),
      update: () => undefined,
    });
    const reason = row.querySelector<HTMLElement>(".fw-ext-reason");
    setText(reason, ext.state === "refused" ? `Refused: ${ext.reason ?? ""}` : "");
    if (reason && reason.hidden !== (ext.state !== "refused")) reason.hidden = ext.state !== "refused";
    const path = row.querySelector<HTMLElement>(".fw-ext-path");
    setText(path, ext.path ?? "");
    if (path && path.hidden !== !ext.path) path.hidden = !ext.path;
    const acts = row.querySelector<HTMLElement>(".fw-ext-acts") as HTMLElement;
    patchList(acts, ext.state === "ready" ? ext.panels : [], {
      key: (p) => p.id,
      create: (p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fw-ibtn";
        b.dataset.extOpen = `${ext.id}/${p.id}`;
        b.innerHTML = `<span>Open</span>${ext.panels.length > 1 ? ` <span translate="no"></span>` : ""}`;
        if (ext.panels.length > 1) setText(b.lastElementChild, p.title);
        return b;
      },
      update: () => undefined,
    });
  };
  const paint = () => {
    patchList(list, rows, {
      key: (e) => e.id,
      create: (e) => {
        const row = rowNode();
        updateRow(row, e);
        return row;
      },
      update: updateRow,
    });
    const none = loaded && rows.length === 0;
    if (empty.hidden !== !none) empty.hidden = !none;
    if (list.hidden !== none) list.hidden = none;
  };

  const load = async (reload = false) => {
    try {
      const res = await fetch(`/api/extensions${reload ? "?reload=1" : ""}`);
      if (!res.ok) throw new Error(String(res.status));
      const out = (await res.json()) as ListAnswer;
      handlers.appVersion = out.appVersion;
      stamp = JSON.stringify(out.stamp);
      const next = new Map(out.extensions.map((e) => [e.id, JSON.stringify(e)]));
      for (const [id, sig] of signatures) {
        if (id.startsWith("extension.")) continue;
        if (next.get(id) === sig) continue;
        extHost.disposeExtension(id);
        for (const key of [...views.keys()]) if (key.startsWith(`${id}/`)) closeView(key);
        for (const [key, d] of [...dialogs]) if (key.startsWith(`${id}/`)) d.close();
      }
      signatures = new Map([...[...signatures].filter(([k]) => k.startsWith("extension.")), ...next]);
      rows = out.extensions;
      loaded = true;
      syncCommands();
      paint();
      return rows.length;
    } catch {
      loaded = true;
      paint();
      return -1;
    }
  };
  const poll = async () => {
    if (!document.hasFocus()) return;
    try {
      const res = await fetch("/api/extensions/stamp");
      if (!res.ok) return;
      const out = (await res.json()) as { stamp: number[] };
      if (JSON.stringify(out.stamp) !== stamp) await load();
    } catch {
      return;
    }
  };
  window.setInterval(() => void poll(), POLL_MS);
  void load();

  const manage = async () => {
    const out = await fetch("/api/extensions/manage", { method: "POST" })
      .then((r) => r.json())
      .catch(() => ({ opened: false, url: "formai://extensions?product=formwav" }));
    if (!out.opened) window.open(String(out.url ?? "formai://extensions?product=formwav"), "_blank", "noopener");
    say("Opening FormPortal's extensions for formwav");
  };
  const reload = async () => {
    const n = await load(true);
    say(n < 0 ? "Could not read the extensions: the engine is not answering" : n === 0 ? "No extensions for formwav" : `Reloaded ${n} extensions`);
  };
  const act = (e: Event) => {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLElement>("[data-ext-act]")?.dataset.extAct;
    if (a === "reload") void reload();
    else if (a === "manage") void manage();
    else if (a === "panel") showView("installed");
    const open = t.closest<HTMLElement>("[data-ext-open]")?.dataset.extOpen;
    if (open) {
      const [id, pid] = open.split("/");
      const ext = byId(id);
      if (ext) void openPanel(ext, pid).catch((err) => say(err instanceof Error ? err.message : String(err)));
    }
    const cmd = t.closest<HTMLElement>("[data-ext-command]")?.dataset.extCommand;
    if (cmd) {
      const dot = cmd.indexOf(".");
      void runCommand(cmd.slice(0, dot), cmd.slice(dot + 1), {}).catch((err) => say(err instanceof Error ? err.message : String(err)));
    }
  };
  panel.addEventListener("click", act);
  menuPop?.addEventListener("click", act);
  tabs.querySelector('[data-ext-tab="installed"]')?.addEventListener("click", () => showView("installed"));

  let queued = false;
  engine.subscribe("document", () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const { done } = engine.historyEntries();
      extHost.broadcast("document.changed", { undo: done.length ? done[done.length - 1].label : null, steps: done.length });
    });
  });
  const sendSelection = () => {
    const s = selection();
    extHost.broadcast("selection.changed", { clips: s.clips.map((c) => c.clip_id), range: s.range });
  };
  host.addEventListener("fw-selection", (e) => {
    selected = (e as CustomEvent<string[]>).detail ?? [];
    sendSelection();
  });
  host.addEventListener("fw-range", (e) => {
    range = (e as CustomEvent<Range>).detail ?? null;
    sendSelection();
  });
  let playing = engine.get("transport").playing;
  let recording = engine.get("transport").recording;
  engine.subscribe("transport", (t) => {
    if (t.playing === playing && t.recording === recording) return;
    playing = t.playing;
    recording = t.recording;
    extHost.broadcast("transport.changed", { playing, recording, playhead_s: sec(t.positionSamples) });
  });
  let themeKey = "";
  const sendTheme = () => {
    const theme = themeNow();
    const k = JSON.stringify(theme);
    if (k === themeKey) return;
    themeKey = k;
    extHost.setTheme(theme);
  };
  const watch = new MutationObserver(() => requestAnimationFrame(sendTheme));
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
  watch.observe(document.body, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
  requestAnimationFrame(sendTheme);
}
