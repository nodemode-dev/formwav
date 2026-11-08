import { setText } from "../vendor/nodemode/dom-stable";
import { t } from "./i18n";
import "../styles/prefs-models.css";

/**
 * Preferences > Models on this computer, and Keys and Models (2.25.0). The first lists every model the engine can
 * install here, grouped as the Media pane offers them, each with its size and licence, what Install downloads and about
 * how long it takes (the engine's one table, services/model_sizes.py: at the speed measured on this session's first
 * download, else at 50 and 200 Mbit/s, plus the setup), its state in words (the engine's own step while it installs,
 * with the bytes done of the total and the time left, polled every three seconds while the dialog is open), an Install
 * button and a Remove button; above them the models folder, what the installed models take on disk and Open folder.
 * Remove deletes the model's files from the engine (never anything outside the models folder) after a confirmation.
 * The second is FormVis's API keys section: each provider key the engine sends (kept in the system password store, else
 * a file only the user can read; a key in the environment comes first and cannot be cleared here; the page never
 * receives a key back, only whether it is set, its last four characters and whether the service refused it), with a
 * password field and Show, Save key, Get a key and Clear; and the in-app agent's model. Rows are made once and patched
 * in place, so the dialog never shifts.
 */
/** What an install downloads and should take, from the engine's one table (services/model_sizes.py). */
interface Download {
  bytes: number;
  measured: boolean;
  setupSeconds: number;
  estimates: Record<string, number>;
  measuredBps: number;
  measuredSeconds: number;
}
interface Progress {
  done: number;
  total: number;
  secondsLeft: number;
}
interface Engine {
  id: string;
  name: string;
  license?: string;
  size?: string;
  installed: boolean;
  installing: string;
  download?: Download;
  progress?: Progress | null;
}
interface DubLang {
  code: string;
  name: string;
  installed: boolean;
  installing: string;
  download?: Download;
  progress?: Progress | null;
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
  link: string;
  set: boolean;
  source: string;
  last4: string;
  refused: boolean;
  refusedAt: number;
}

/** The keys the engine sends, in the order /api/keys lists them (services/secrets.py KEYS). */
const KEY_ROWS: [name: string, label: string, link: string][] = [
  ["ELEVENLABS_API_KEY", "ElevenLabs", "https://elevenlabs.io/app/settings/api-keys"],
  ["FAL_KEY", "fal", "https://fal.ai/dashboard/keys"],
  ["ANTHROPIC_API_KEY", "Anthropic", "https://console.anthropic.com/settings/keys"],
  ["ACESTEP_API_KEY", "ACE-Step server", ""],
];
const EYE =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/><path data-eye="slash" d="M2.5 2.5l11 11"/></svg>';

/** A download size as the installers state them: decimal megabytes and gigabytes ("4.7 GB", "570 MB"). */
const downloadText = (bytes: number): string => (bytes < 1e9 ? `${Math.max(1, Math.round(bytes / 1e6))} MB` : `${Number((bytes / 1e9).toFixed(bytes % 1e8 ? 2 : 1))} GB`);
/** "about 13 min at 50 Mbit/s", or "under a minute at ..." */
const timeAt = (seconds: number, at: string): string => (seconds < 60 ? `under a minute at ${at}` : `about ${Math.round(seconds / 60)} min at ${at}`);
const progressText = (p: Progress): string => {
  const done = Math.round(p.done / 1e6);
  if (!p.total) return `${done} MB downloaded`;
  const total = Math.round(p.total / 1e6);
  return p.secondsLeft ? `${done} of ${total} MB, about ${Math.max(1, Math.round(p.secondsLeft / 60))} min left` : `${done} of ${total} MB`;
};
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

/** One model's row: its name, its state, its size and licence, what Install downloads and how long it should take (or,
 *  while it installs, the bytes done and the time left), Install and Remove. Every span is there from the start. */
const modelRow = (id: string, kind: string, name = id) =>
  `<div class="fw-prefs-row fw-model-row" data-model="${kind}:${id}"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" data-m="name" translate="no">${name}</span><span class="fw-prefs-row-hint"><span data-m="state">Not installed</span> <span data-m="note" translate="no"></span></span><span class="fw-prefs-row-hint fw-model-dl" data-m="dl"><span data-m="dl-size"></span><span data-m="dl-sep">, </span><span data-m="dl-time"></span><span data-m="dl-sep2"> · </span><span data-m="dl-time2"></span><span data-m="dl-est"></span></span></div><div class="fw-prefs-row-ctl">${button("install", "Install", ' data-for="m"')}${button("remove", "Remove", ' data-for="m"')}</div></div>`;

/** The markup of the two sections; the rows are patched by `mountModelsKeys`. */
export function modelsMarkup(): { models: string; keys: string } {
  const head = (label: string) => `<h4 class="fw-prefs-group">${label}</h4>`;
  const models =
    head("Models folder") +
    `<div class="fw-prefs-row"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" data-m="folder" translate="no">models</span><span class="fw-prefs-row-hint"><span>Installed models take</span> <span data-m="total" translate="no">0 MB</span> <span data-m="runtime" translate="no"></span></span></div><div class="fw-prefs-row-ctl">${button("open-folder", "Open folder")}</div></div>` +
    GROUPS.map(([id, label, engines]) => head(label) + `<div data-models-group="${id}">${engines.map((e) => modelRow(e, "engine")).join("")}</div>`).join("") +
    head("Dubbing languages") +
    `<div data-models-group="dub"></div><p class="fw-prefs-note" data-m="note-line" aria-live="polite"></p>`;
  // FormVis's API keys rows (its ApiKeysSection): the provider, whether a key is kept, where, its last four characters
  // and whether the service refused it; a password field with Show, Save key, Get a key and Clear (off for a key set in
  // the environment, which the engine cannot forget).
  const keyRow = (k: string, label: string, link: string) =>
    `<div class="fw-prefs-row fw-key-row" data-key="${k}"><div class="fw-prefs-row-text"><span class="fw-prefs-row-label" translate="no">${label}</span><span class="fw-prefs-row-hint"><span data-k="state">No key</span><span data-k="last4" translate="no"></span><span data-k="env-sep"></span><span data-k="env"></span><span data-k="refused-sep"></span><span data-k="refused"></span></span></div><form class="fw-prefs-row-ctl fw-key-paste" data-k="form"><input type="password" class="fw-prefs-key" data-k="input" autocomplete="off" spellcheck="false" placeholder="Paste your key" aria-label="${label}"><button type="button" class="fw-prefs-btn fw-key-eye" data-models-act="key-show" aria-pressed="false" aria-label="Show the key" title="Show the key">${EYE}</button><button type="submit" class="fw-prefs-btn" data-models-act="key-save" data-for="k">Save key</button>${link ? `<a class="fw-prefs-btn fw-key-link" data-k="link" href="${link}" target="_blank" rel="noopener">Get a key</a>` : ""}${button("key-forget", "Clear", ' data-for="k"')}</form></div>`;
  const keys =
    head("API keys") +
    KEY_ROWS.map(([k, label, link]) => keyRow(k, label, link)).join("") +
    `<p class="fw-prefs-note" aria-live="polite"><span data-k="where">Keys are kept in your system's password store; only the last four characters are shown here.</span> <span data-k="said"></span></p>` +
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
  /** What Install downloads and should take, before it runs; while it runs, the bytes done of the total and the time
   *  left. An installed model shows nothing here. */
  const patchDownload = (row: HTMLElement, item: { installed: boolean; download?: Download; progress?: Progress | null }, busy: boolean) => {
    const d = item.download;
    const p = busy ? item.progress : null;
    const show = !!d && !item.installed;
    const dl = $(row, '[data-m="dl"]');
    // the line keeps its height either way (prefs-models.css), so a row never shifts as a model installs
    if (dl && dl.dataset.off !== String(!show)) dl.dataset.off = String(!show);
    if (!d || !show) return;
    const measured = d.measuredBps > 0;
    const first = p ? progressText(p) : measured ? timeAt(d.measuredSeconds, `the measured ${Math.round((d.measuredBps * 8) / 1e6)} Mbit/s`) : timeAt(d.estimates["50"] ?? 0, "50 Mbit/s");
    const second = p || measured ? "" : timeAt(d.estimates["200"] ?? 0, "200 Mbit/s");
    setText($(row, '[data-m="dl-size"]'), `Download ${downloadText(d.bytes)}`);
    setText($(row, '[data-m="dl-time"]'), first);
    setText($(row, '[data-m="dl-sep2"]'), second ? " · " : "");
    setText($(row, '[data-m="dl-time2"]'), second);
    setText($(row, '[data-m="dl-est"]'), d.measured ? "" : " (estimated size)");
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
      patchDownload(row, e, busy);
    }
    const host = $(dialog, '[data-models-group="dub"]');
    if (host && !dubBuilt && dub.languages.length) {
      dubBuilt = true;
      host.innerHTML = dub.languages.map((l) => modelRow(l.code, "dub", l.name)).join("");
    }
    for (const l of dub.languages) {
      const row = $(dialog, `[data-model="dub:${l.code}"]`);
      if (!row) continue;
      const [state, busy] = stateOf(l);
      patchRow(row, l.name, state, "", l.installed, busy);
      patchDownload(row, l, busy);
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
      // FormVis's words: "key kept, ends 1234 (set in the environment), refused by the service: replace it"
      const env = k.set && k.source === "environment";
      setText($(row, '[data-k="state"]'), k.set ? (k.last4 ? "Key kept, ends" : "Key kept") : "No key");
      setText($(row, '[data-k="last4"]'), k.set && k.last4 ? ` ${k.last4}` : "");
      setText($(row, '[data-k="env-sep"]'), env ? " " : "");
      setText($(row, '[data-k="env"]'), env ? "(set in the environment)" : "");
      setText($(row, '[data-k="refused-sep"]'), k.set && k.refused ? " · " : "");
      setText($(row, '[data-k="refused"]'), k.set && k.refused ? "Refused by the service: replace it" : "");
      row.dataset.stale = String(k.set && k.refused);
      const forget = $<HTMLButtonElement>(row, '[data-models-act="key-forget"]');
      if (forget && forget.disabled !== (!k.set || env)) forget.disabled = !k.set || env;
      const input = $<HTMLInputElement>(row, '[data-k="input"]');
      const hint = k.set ? "Paste a new key to replace it" : "Paste your key";
      if (input && input.placeholder !== hint) input.placeholder = hint;
    }
    setText(
      $(dialog, '[data-k="where"]'),
      found.store === "system" ? "Keys are kept in your system's password store; only the last four characters are shown here." : "No system password store was found: keys are kept in a file on this computer only you can read.",
    );
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

  // the keys' own status line, under the rows, as FormVis says what Save key and Clear did
  const keySaid = (text: string) => {
    setText($(dialog, '[data-k="said"]'), text);
    void refreshKeys().catch(() => undefined);
  };
  // Save key is the form's submit, so Return in the field saves too
  dialog.addEventListener("submit", (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-k="form"]');
    if (!form) return;
    e.preventDefault();
    const keyRow = form.closest<HTMLElement>("[data-key]");
    const input = $<HTMLInputElement>(form, '[data-k="input"]');
    const value = input?.value.trim() ?? "";
    if (!keyRow || !input) return;
    if (!value) {
      keySaid("Paste a key first.");
      input.focus();
      return;
    }
    void api<{ kept: string }>(`/api/keys/${keyRow.dataset.key}`, jsonInit("PUT", { value })).then(
      (got) => {
        input.value = "";
        keySaid(got.kept === "file" ? "Key saved in a file on this computer only you can read." : "Key saved in your system's password store.");
      },
      (err: Error) => keySaid(err.message),
    );
  });

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
    } else if (keyRow && act === "key-show") {
      const input = $<HTMLInputElement>(keyRow, '[data-k="input"]');
      const shown = input?.type === "text";
      if (input) input.type = shown ? "password" : "text";
      target.setAttribute("aria-pressed", String(!shown));
      const words = shown ? "Show the key" : "Hide the key";
      target.setAttribute("aria-label", words);
      target.title = words;
    } else if (keyRow && act === "key-forget") {
      void api(`/api/keys/${keyRow.dataset.key}`, { method: "DELETE" }).then(() => keySaid("Key cleared."), (err: Error) => keySaid(err.message));
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
