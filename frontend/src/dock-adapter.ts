import type { ConsentChoice, ConsentRequest, DockAdapter, DockAgentStatus, DockChannel, DockLegacy, DockOwnChat, DockTerminal, PtyKind, StoredChoice, StoredChoiceState } from "./dock/adapter";
import { Dock } from "./dock/dock";
import type { Engine } from "./engine";
import { WINDOW_KEY_HEADER, windowKey } from "./io/window-key";
import { ChatPane, el } from "./ui/chat-pane";
import { agentIcon } from "./ui/icons-agent";
import { setText } from "./vendor/nodemode/dom-stable";

export const DOCK_KEY = "formwav.dock";
export const DOCK_OLD_HEIGHT = "formwav.terminalHeight";
export const DOCK_KEEP_TIMELINE = 360;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export class EngineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) throw new EngineError(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`, res.status);
  return out as T;
}

export const oldHeight: DockLegacy = {
  keys: [DOCK_OLD_HEIGHT],
  read: (store) => {
    const h = Number(store.getItem(DOCK_OLD_HEIGHT));
    return h > 0 ? { h } : null;
  },
};

export function dockCombo(e: KeyboardEvent): "toggle" | "claude" | "chat" | null {
  if ((isMac ? e.metaKey : e.ctrlKey) && e.code === "KeyJ") return e.altKey ? "chat" : e.shiftKey ? "claude" : "toggle";
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "`") return "toggle";
  return null;
}

export interface AskedItem {
  id: string;
  name?: string;
  client?: string;
  agent?: string;
  what?: string;
  answers?: string[];
  expiresAt?: number;
}

const CHOICES: ConsentChoice[] = ["deny", "once", "always"];
const SAID: Record<ConsentChoice, string> = { deny: "denied", once: "allowed once", always: "always allowed" };
const waiting = new Map<string, string>();
const early: ConsentRequest[] = [];
let add: ((request: ConsentRequest) => void) | null = null;
let withdraw: (id: string) => void = () => undefined;
let record: (line: string) => void = () => undefined;

export const outsideAgents = {
  onRecord(fn: (line: string) => void): void {
    record = fn;
  },
  asked(item: AskedItem): void {
    if (waiting.has(item.id)) return;
    const agent = item.agent || item.client || "";
    const offers = CHOICES.filter((c) => !item.answers || item.answers.includes(c));
    const request: ConsentRequest = { id: item.id, agent, what: item.what || `use ${(item.name ?? "a tool").replace(/_/g, " ")}`, offers, always: "all", ...(item.expiresAt ? { expires: item.expiresAt } : {}) };
    waiting.set(item.id, agent);
    if (add) add(request);
    else early.push(request);
  },
  gone(id: string): void {
    if (waiting.delete(id)) withdraw(id);
  },
  subscribe(onAdd: (request: ConsentRequest) => void, onWithdraw: (id: string) => void): void {
    add = onAdd;
    withdraw = onWithdraw;
    for (const r of early.splice(0)) onAdd(r);
  },
  async answer(id: string, choice: ConsentChoice): Promise<void> {
    const agent = waiting.get(id) || "An outside agent";
    waiting.delete(id);
    await call("/api/bridge/result", { id, ok: true, result: choice });
    record(`${agent}: ${SAID[choice]}`);
  },
  async get(): Promise<StoredChoiceState> {
    const s = await call<{ value?: string; changedOutside?: boolean }>("/api/agents/outside");
    return { value: s.value === "allowed" || s.value === "blocked" ? s.value : "ask", changedOutside: s.changedOutside === true };
  },
  async set(value: StoredChoice): Promise<void> {
    await call("/api/agents/outside", { value });
  },
};

function channel(id: string): DockChannel {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/terminal/${encodeURIComponent(id)}?control=binary`);
  let data = (_chunk: string | Uint8Array): void => undefined;
  let exit = (): void => undefined;
  let closed = (): void => undefined;
  const held: string[] = [];
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "key", key: windowKey() }));
    for (const text of held.splice(0)) socket.send(text);
  });
  socket.addEventListener("message", (msg) => {
    if (typeof msg.data === "string") {
      data(msg.data);
      return;
    }
    try {
      if ((JSON.parse(new TextDecoder().decode(msg.data as ArrayBuffer)) as { type?: string }).type === "exit") exit();
    } catch {
      return;
    }
  });
  socket.addEventListener("close", () => closed());
  const send = (text: string): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
    else if (socket.readyState === WebSocket.CONNECTING) held.push(text);
  };
  return {
    send: (chunk) => send(JSON.stringify({ type: "input", data: chunk })),
    resize: (cols, rows) => send(JSON.stringify({ type: "resize", cols, rows })),
    onData: (handler) => {
      data = handler;
    },
    onExit: (handler) => {
      exit = handler;
    },
    onClose: (handler) => {
      closed = handler;
    },
    close: () => socket.close(),
  };
}

interface TermInfo {
  id: string;
  title: string;
  kind?: string;
  alive?: boolean;
}
const KINDS: (PtyKind | "antigravity")[] = ["shell", "claude", "codex", "cursor", "antigravity"];
const termRecord = (info: TermInfo): DockTerminal<"antigravity"> => ({ id: info.id, title: info.title, alive: info.alive !== false, kind: KINDS.find((k) => k === info.kind) ?? "shell" });

export interface DockDeps {
  host: HTMLElement;
  pane: HTMLElement | null;
  looking(): string;
  plain(): boolean;
  fail(err: unknown): void;
  handoff(session: string): void;
  openSettings(): void;
  homeShowing(): boolean;
}

export function formwavDock(deps: DockDeps): DockAdapter<"antigravity"> {
  return {
    words: {
      app: "formwav",
      noun: "session",
      example: "level the voices",
      start: "./formwav",
      lead: "Ask Claude in the line below to work on this session: tidy a recording, level the voices, set the loudness. Every change shows in the window, and every change can be undone.",
    },
    strings: { chatAbout: "Chat with Claude", empty: "No terminal is open. Start a shell with the plus button, Claude Code with the robot button, or Chat with the speech bubble." },
    placement: {
      mode: "own",
      storage: { key: DOCK_KEY, legacy: oldHeight },
      sizes: {
        minHeight: 140,
        maxHeightShare: 0.75,
        defaultHeight: 300,
        minWidth: 320,
        maxWidthShare: 0.5,
        defaultWidth: 420,
        maxHeight: () => (deps.pane?.clientHeight ? deps.pane.clientHeight * 0.75 : Infinity),
        maxWidth: () => (deps.pane?.clientWidth ? deps.pane.clientWidth - DOCK_KEEP_TIMELINE : Infinity),
      },
    },
    passKey: (e) => dockCombo(e) !== null,
    isDockChord: (e) => dockCombo(e) === "toggle",
    chordLabel: () => (isMac ? "Cmd+J" : "Ctrl+J"),
    tabs: () => ({ builtin: ["chat", "shell", "claude", "codex", "cursor", "antigravity"] }),
    classes: { iconButton: "fw-ibtn fw-ibtn-icon", button: "fw-ibtn", primaryButton: "fw-dock-primary", input: "fw-dock-input", select: "fw-dock-select", note: "fw-dock-note" },
    t: (_key, english) => english,
    onTheme: (handler) => document.addEventListener("nm:ui-settings-changed", handler),
    keyHeaders: () => ({ [WINDOW_KEY_HEADER]: windowKey() }),
    errors: {
      message: (err) => (err instanceof EngineError ? err.message : null),
      kind: (err) => {
        if (err instanceof TypeError) return "unreachable";
        if (!(err instanceof EngineError)) return null;
        if (err.status === 424) return "notInstalled";
        if (err.status === 502 || err.status === 503 || err.status === 504) return "unreachable";
        if (err.status === 403) return "refused";
        return (err.status === 404 || err.status === 405) && /^(Not Found|Method Not Allowed)$/i.test(err.message) ? "oldEngine" : null;
      },
    },
    firstRun: () => !deps.homeShowing(),
    terminal: {
      list: async () => (await call<{ terminals: TermInfo[] }>("/api/terminal/list")).terminals.map(termRecord),
      open: async (kind, o) => {
        if (kind === "shell") return termRecord(await call<TermInfo>("/api/terminal/open", { cols: o.cols, rows: o.rows }));
        if (kind !== "claude") return termRecord(await call<TermInfo>("/api/terminal/agent", { kind, cols: o.cols, rows: o.rows }));
        const looked = o.prompt && !deps.plain() ? deps.looking() : "";
        return termRecord(await call<TermInfo>("/api/claudecode/open", { prompt: o.prompt ? (looked ? `${o.prompt} (${looked})` : o.prompt) : undefined, resume: o.resume || undefined, cols: o.cols, rows: o.rows }));
      },
      restart: async (id) => {
        await call("/api/terminal/restart", { id });
      },
      close: async (id) => {
        await call("/api/terminal/close", { id });
      },
      channel,
      scrollback: 5000,
    },
    agentStatus: async () => {
      const said = await call<Record<string, { installed?: boolean; version?: string | null; install?: string; signedIn?: boolean | null; finding?: string; said?: string } | undefined>>("/api/agents/status");
      const out: DockAgentStatus<"antigravity"> = {};
      for (const kind of ["claude", "codex", "cursor", "antigravity"] as const) {
        const p = said[kind];
        if (p) out[kind] = { installed: p.installed === true, version: p.version ?? null, install: p.install ?? "", signedIn: p.signedIn ?? null, ...(p.finding && p.finding !== "runs" && p.said ? { note: p.said } : {}) };
      }
      return out;
    },
    chat: {
      pane: (box): DockOwnChat => {
        const chat = new ChatPane(deps.host);
        chat.onFail = deps.fail;
        chat.onHandoff = deps.handoff;
        chat.root.hidden = false;
        box.append(chat.root);
        return {
          send: async (text) => {
            if (chat.isBusy()) return false;
            const looked = deps.plain() ? "" : deps.looking();
            await chat.send(text, looked, looked);
            return true;
          },
          shown: () => {
            void chat.load();
          },
          busy: () => chat.isBusy(),
        };
      },
      ask: "line",
    },
    consent: { subscribe: (onAdd, onWithdraw) => outsideAgents.subscribe(onAdd, onWithdraw), answer: (id, choice) => outsideAgents.answer(id, choice) },
    storedChoice: { get: () => outsideAgents.get(), set: (value) => outsideAgents.set(value) },
    openSettings: deps.openSettings,
  };
}

export function mountFamilyDock(host: HTMLElement, engine: Engine): Dock<"antigravity"> {
  const pane = host.querySelector<HTMLElement>(".fw-pane-timeline");
  const anchor = host.querySelector<HTMLElement>(".fw-dock-anchor");
  const button = el<HTMLButtonElement>(`<button type="button" class="fw-ibtn" data-action="terminal" aria-pressed="false" title="A real shell on this machine (Ctrl+\`)">${agentIcon("terminal", 14)}<span>Terminal</span></button>`);
  host.querySelector<HTMLButtonElement>('[data-action="export"]')?.before(button);

  let looking: string[] = [];
  let plain = false;
  host.addEventListener("fw-selection", (e) => {
    looking = (e as CustomEvent<string[]>).detail ?? [];
  });
  const describe = (): string => {
    const doc = engine.get("document");
    for (const t of doc.tracks) {
      const c = t.clips.find((x) => x.id === looking[0]);
      if (c) return `Looking at ${t.name}, ${(doc.media[c.mediaId]?.name ?? "a clip").replace(/\.[^.]+$/, "")}`;
    }
    return "";
  };
  const asGiven = async (run: () => Promise<unknown>): Promise<void> => {
    plain = true;
    try {
      await run();
    } finally {
      plain = false;
    }
  };

  const dock: Dock<"antigravity"> = new Dock(
    formwavDock({
      host,
      pane,
      looking: describe,
      plain: () => plain,
      fail: (err) => setText(host.querySelector(".fw-notice"), err instanceof Error ? err.message : String(err)),
      handoff: (session) => void dock.claude(undefined, session),
      openSettings: () => {
        host.querySelector<HTMLElement>('.fw-settings-pop [data-action="agents"]')?.click();
        document.querySelector<HTMLElement>('.fw-agents-dialog [data-a="outside"]')?.focus();
      },
      homeShowing: () => {
        const home = document.querySelector<HTMLElement>(".fw-home");
        return !!home && !home.hidden;
      },
    }),
  );
  const pressed = (): void => {
    const on = String(dock.isOpen());
    if (button.getAttribute("aria-pressed") !== on) button.setAttribute("aria-pressed", on);
  };
  dock.onChange = pressed;
  dock.mount(anchor?.parentElement ?? pane ?? host, anchor);
  pressed();

  button.addEventListener("click", () => dock.toggle());
  window.addEventListener("keydown", (e) => {
    const k = dockCombo(e);
    if (k !== "claude" && k !== "chat") return;
    e.preventDefault();
    if (k === "claude") void dock.claude();
    else void dock.show("chat");
  });

  const listen = (name: string, run: (detail: Record<string, unknown>) => void): void => {
    window.addEventListener(name, (e) => run(((e as CustomEvent).detail ?? {}) as Record<string, unknown>));
    host.addEventListener(name, (e) => {
      if (!e.bubbles) run(((e as CustomEvent).detail ?? {}) as Record<string, unknown>);
    });
  };
  const words = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  listen("fw-dock-toggle", () => dock.toggle());
  listen("fw-dock-new", () => void dock.newTerminal());
  listen("fw-dock-chat", (d) => void (words(d.text) ? asGiven(() => dock.sendChat(words(d.text))) : dock.show("chat")));
  listen("fw-dock-claude", (d) => void asGiven(() => dock.claude(words(d.prompt) || undefined)));
  listen("fw-terminal", (d) => {
    if (d.claude) void dock.claude();
    else if (!dock.isOpen()) dock.toggle(true);
  });
  return dock;
}
