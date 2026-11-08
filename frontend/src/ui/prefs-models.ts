import { setText } from "../vendor/nodemode/dom-stable";
import { t } from "./i18n";

/**
 * Preferences > Models on this computer, and Keys and Models (2.25.0). The first lists every model the engine can
 * install here, grouped as the Media pane offers them, each with its size and licence, its state in words (the engine's
 * own step while it installs, polled every three seconds while the dialog is open), an Install button and a Remove
 * button; above them the models folder, what it takes on disk and Open folder. Remove deletes the model's files from
 * the engine (never anything outside the models folder) after a confirmation. The second sets the three provider keys
 * (kept in the system password store, else a file only the user can read; the page never receives a key back, only
 * whether it is set and its last four characters) and the in-app agent's model. Rows are made once and patched in place,
 * so the dialog never shifts.
 */
interface Engine {
  id: string;
  name: string;
  license?: string;
  size?: string;
  installed: boolean;
  installing: string;
}
interface DubLang {
  code: string;
  name: string;
  installed: boolean;
  installing: string;
}
interface Disk {
  folder: string;
  bytes: number;
  runtimeBytes: number;
  exists: boolean;
}
interface KeyInfo {
  name: string;
  label: string;
  set: boolean;
  source: string;
  last4: string;
}
interface Keys {
  store: string;
  backend: string;
  keys: KeyInfo[];
  agentModel: string;
  defaultAgentModel: string;
}

const GROUPS: [id: string, label: string, engines: string[]][] = [
  ["speech", "Speech and cloning", ["kokoro", "pocket", "chatterbox"]],
  ["songs", "Songs", ["acestep", "soulx-singer"]],
  ["effects", "Sound effects", ["ezaudio"]],
  ["separation", "Separation", ["tiger"]],
];

const sizeText = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `the engine answered ${res.status}`);
  return body as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const button = (act: string, label: string, extra = "") => `<button type="button" class="fw-prefs-btn" data-models-act="${act}"${extra}>${label}</button>`;

/** The markup of the two sections; the rows are patched by `mountModelsKeys`. */
export function modelsMarkup(): { models: string; keys: string } {
  const head = (label: string) => `<h4 class="fw-prefs-group">${label}</h4>`;
  const modelRow = (id: string, kind: string) =>
    `<div class="fw-prefs-row fw-model-row" data-model="${kind}:${id}"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" data-m="name" translate="no">${id}</span><span class="fw-prefs-row-hint"><span data-m="state">Not installed</span> <span data-m="note" translate="no"></span></span></div><div class="fw-prefs-row-ctl">${button("install", "Install", ' data-for="m"')}${button("remove", "Remove", ' data-for="m"')}</div></div>`;
  const models =
    head("Models folder") +
    `<div class="fw-prefs-row"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" data-m="folder" translate="no">models</span><span class="fw-prefs-row-hint"><span>Taking</span> <span data-m="total" translate="no">0 MB</span> <span data-m="runtime" translate="no"></span></span></div><div class="fw-prefs-row-ctl">${button("open-folder", "Open folder")}</div></div>` +
    GROUPS.map(([id, label, engines]) => head(label) + `<div data-models-group="${id}">${engines.map((e) => modelRow(e, "engine")).join("")}</div>`).join("") +
    head("Dubbing languages") +
    `<div data-models-group="dub"></div><p class="fw-prefs-note" data-m="note-line" aria-live="polite"></p>`;
  const keyRow = (k: string, label: string) =>
    `<div class="fw-prefs-row fw-key-row" data-key="${k}"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" translate="no">${label}</span><span class="fw-prefs-row-hint"><span data-k="state">Not set</span> <span data-k="last4" translate="no"></span></span></div><div class="fw-prefs-row-ctl"><input type="password" class="fw-prefs-key" data-k="input" autocomplete="off" spellcheck="false" placeholder="Paste a key" aria-label="${label}">${button("key-save", "Save", ' data-for="k"')}${button("key-forget", "Forget", ' data-for="k"')}</div></div>`;
  const keys =
    head("Keys") +
    keyRow("ELEVENLABS_API_KEY", "ElevenLabs") +
    keyRow("FAL_KEY", "fal") +
    keyRow("ANTHROPIC_API_KEY", "Anthropic") +
    `<p class="fw-prefs-note"><span data-k="where">Keys are kept in the system password store.</span></p>` +
    head("Agent") +
    `<div class="fw-prefs-row" data-agent-model><div class="fw-prefs-row-text"><span class="fw-prefs-row-label">Agent model</span><span class="fw-prefs-row-hint">The model the in-app agent uses; empty goes back to the default</span></div><div class="fw-prefs-row-ctl"><input type="text" class="fw-prefs-key" data-k="agent-model" spellcheck="false" autocomplete="off" aria-label="Agent model" translate="no">${button("model-save", "Save")}</div></div>`;
  return { models, keys };
}

export function mountModelsKeys(dialog: HTMLElement): { start: () => void; stop: () => void; refresh: () => void } {
  const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
  const note = $(dialog, '[data-m="note-line"]');
  const say = (text: string) => setText(note, text);
  let timer = 0;
  let dubBuilt = false;

  const patchRow = (row: HTMLElement, name: string, state: string, note: string, installed: boolean, busy: boolean) => {
    setText($(row, '[data-m="name"]'), name);
    setText($(row, '[data-m="state"]'), state);
    setText($(row, '[data-m="note"]'), note);
    const install = $<HTMLButtonElement>(row, '[data-models-act="install"]');
    const remove = $<HTMLButtonElement>(row, '[data-models-act="remove"]');
    if (install && install.disabled !== (installed || busy)) install.disabled = installed || busy;
    if (remove && remove.disabled !== (!installed || busy)) remove.disabled = !installed || busy;
  };
  const stateOf = (item: { installed: boolean; installing: string }): [string, boolean] => {
    if (item.installing.startsWith("installing")) return [item.installing.charAt(0).toUpperCase() + item.installing.slice(1), true];
    if (item.installing) return [item.installing, false];
    return [item.installed ? "Installed" : "Not installed", false];
  };

  const refreshModels = async (): Promise<void> => {
    const [speech, dub, disk] = await Promise.all([
      api<{ engines: Engine[] }>("/api/providers/local-speech"),
      api<{ languages: DubLang[] }>("/api/providers/local-dub"),
      api<Disk>("/api/models/disk"),
    ]);
    for (const e of speech.engines) {
      const row = $(dialog, `[data-model="engine:${e.id}"]`);
      if (!row) continue;
      const [state, busy] = stateOf(e);
      const facts = [e.size, e.license].filter(Boolean).join(" · ");
      patchRow(row, e.name, state, facts ? `· ${facts}` : "", e.installed, busy);
    }
    const host = $(dialog, '[data-models-group="dub"]');
    if (host && !dubBuilt && dub.languages.length) {
      dubBuilt = true;
      host.innerHTML = dub.languages
        .map((l) => `<div class="fw-prefs-row fw-model-row" data-model="dub:${l.code}"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" data-m="name" translate="no">${l.name}</span><span class="fw-prefs-row-hint"><span data-m="state">Not installed</span> <span data-m="note" translate="no"></span></span></div><div class="fw-prefs-row-ctl">${button("install", "Install", ' data-for="m"')}${button("remove", "Remove", ' data-for="m"')}</div></div>`)
        .join("");
    }
    for (const l of dub.languages) {
      const row = $(dialog, `[data-model="dub:${l.code}"]`);
      if (!row) continue;
      const [state, busy] = stateOf(l);
      patchRow(row, l.name, state, "", l.installed, busy);
    }
    setText($(dialog, '[data-m="folder"]'), disk.folder);
    setText($(dialog, '[data-m="total"]'), sizeText(disk.bytes));
    setText($(dialog, '[data-m="runtime"]'), disk.runtimeBytes > 0 ? `+ ${sizeText(disk.runtimeBytes)}` : "");
  };

  const refreshKeys = async (): Promise<void> => {
    const found = await api<Keys>("/api/keys");
    for (const k of found.keys) {
      const row = $(dialog, `[data-key="${k.name}"]`);
      if (!row) continue;
      const state = !k.set ? "Not set" : k.source === "store" ? "Kept in the system password store" : k.source === "file" ? "Kept in a file only you can read" : "Set in the environment";
      setText($(row, '[data-k="state"]'), state);
      setText($(row, '[data-k="last4"]'), k.set && k.last4 ? `…${k.last4}` : "");
      const forget = $<HTMLButtonElement>(row, '[data-models-act="key-forget"]');
      if (forget && forget.disabled !== (!k.set || k.source === "environment")) forget.disabled = !k.set || k.source === "environment";
    }
    setText($(dialog, '[data-k="where"]'), found.store === "system" ? "Keys are kept in the system password store." : "No system password store was found: keys are kept in a file only you can read.");
    const model = $<HTMLInputElement>(dialog, '[data-k="agent-model"]');
    if (model) {
      model.placeholder = found.defaultAgentModel;
      if (document.activeElement !== model && model.value !== found.agentModel) model.value = found.agentModel;
    }
  };

  const refresh = (): void => {
    void refreshModels().catch(() => say("The engine could not be reached."));
    void refreshKeys().catch(() => undefined);
  };

  dialog.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-models-act]");
    if (!target) return;
    const act = target.dataset.modelsAct;
    const row = target.closest<HTMLElement>("[data-model]");
    const keyRow = target.closest<HTMLElement>("[data-key]");
    const done = (text = "") => {
      say(text);
      refresh();
    };
    if (act === "open-folder") {
      void api("/api/models/open-folder", { method: "POST" }).then(() => say(""), (err: Error) => say(err.message));
    } else if (row && (act === "install" || act === "remove")) {
      const [kind, id] = (row.dataset.model ?? ":").split(":");
      const name = row.querySelector('[data-m="name"]')?.textContent ?? id;
      const base = kind === "dub" ? `/api/providers/local-dub/${id}` : `/api/providers/local-speech/${id}`;
      if (act === "install") {
        void api(`${base}/install`, { method: "POST" }).then(() => done(), (err: Error) => done(err.message));
      } else {
        if (!window.confirm(`${t("Remove this model? Its files are deleted from this computer.")}\n${name}`)) return;
        void api(base, { method: "DELETE" }).then(() => done(), (err: Error) => done(err.message));
      }
    } else if (keyRow && act === "key-save") {
      const input = $<HTMLInputElement>(keyRow, '[data-k="input"]');
      const value = input?.value.trim() ?? "";
      if (!input || !value) return;
      void api(`/api/keys/${keyRow.dataset.key}`, jsonInit("PUT", { value })).then(
        () => {
          input.value = "";
          done();
        },
        (err: Error) => done(err.message),
      );
    } else if (keyRow && act === "key-forget") {
      void api(`/api/keys/${keyRow.dataset.key}`, { method: "DELETE" }).then(() => done(), (err: Error) => done(err.message));
    } else if (act === "model-save") {
      const model = $<HTMLInputElement>(dialog, '[data-k="agent-model"]');
      void api("/api/settings/agent-model", jsonInit("PUT", { model: model?.value ?? "" })).then(() => done(), (err: Error) => done(err.message));
    }
  });

  return {
    refresh,
    start: () => {
      refresh();
      if (!timer) timer = window.setInterval(refresh, 3000);
    },
    stop: () => {
      window.clearInterval(timer);
      timer = 0;
    },
  };
}
