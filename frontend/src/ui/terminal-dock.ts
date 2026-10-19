import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { Engine } from "../engine";
import { setClass, setText } from "../vendor/nodemode/dom-stable";
import { ChatPane, el, engineCall, escapeHtml, q, setHidden } from "./chat-pane";
import { agentIcon } from "./icons-agent";

interface TermInfo {
  id: string;
  title: string;
  kind?: string;
  alive?: boolean;
}

interface Tab {
  id: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLElement;
  tab: HTMLElement;
  socket: WebSocket | null;
  kind: string;
}

const HEIGHT_KEY = "formwav.terminalHeight";
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function combo(e: KeyboardEvent): "toggle" | "claude" | "chat" | null {
  if ((isMac ? e.metaKey : e.ctrlKey) && e.code === "KeyJ") return e.altKey ? "chat" : e.shiftKey ? "claude" : "toggle";
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "`") return "toggle";
  return null;
}

/**
 * The bottom dock, between the lanes and the transport: tabs for shells, Claude Code terminals and the Chat, an Ask
 * line, a height dragged from its top edge. Terminals live in the engine and survive this page; the dock builds each of
 * its parts once and only hides and shows them.
 */
export function mountTerminalDock(host: HTMLElement, engine: Engine): void {
  const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]');
  const button = el<HTMLButtonElement>(`<button type="button" class="fw-ibtn" data-action="terminal" aria-pressed="false" title="A real shell on this machine (Ctrl+\`)">${agentIcon("terminal", 14)}<span>Terminal</span></button>`);
  exportButton?.before(button);

  const root = el(`<section class="fw-tdock" aria-label="Terminal" hidden>
<div class="fw-tdock-rsz" role="separator" aria-orientation="horizontal" aria-label="Resize the terminal"></div>
<div class="fw-tdock-head">
<div class="fw-tdock-tabs" role="tablist" aria-label="Terminals"></div>
<span class="fw-tdock-spacer"></span>
<button type="button" class="fw-ibtn fw-ibtn-icon fw-tdock-btn" data-tdock="new" title="New Terminal" aria-label="New Terminal">${agentIcon("plus", 15)}</button>
<button type="button" class="fw-ibtn fw-ibtn-icon fw-tdock-btn" data-tdock="chat" title="Chat with Claude" aria-label="Chat">${agentIcon("agentChat", 15)}</button>
<button type="button" class="fw-ibtn fw-ibtn-icon fw-tdock-btn" data-tdock="claude" title="Claude Code" aria-label="Claude Code">${agentIcon("agent", 15)}</button>
<button type="button" class="fw-ibtn fw-ibtn-icon fw-tdock-btn" data-tdock="restart" title="Restart this tab" aria-label="Restart this tab" disabled>${agentIcon("refresh", 15)}</button>
<button type="button" class="fw-ibtn fw-ibtn-icon fw-tdock-btn" data-tdock="hide" title="Hide the terminal; its programs keep running" aria-label="Hide the terminal">${agentIcon("close", 15)}</button>
</div>
<div class="fw-tdock-stage"><p class="fw-tdock-empty">No terminal is open. Start a shell with the plus button, Claude Code with the robot button, or Chat with the speech bubble.</p></div>
<form class="fw-tdock-ask" autocomplete="off">
<span class="fw-tdock-ask-mark">${agentIcon("agent", 15)}</span>
<input class="fw-tdock-ask-input" type="text" spellcheck="false" placeholder="Ask Claude Code to work on your session" aria-label="Ask Claude Code">
<button type="submit" class="fw-ibtn fw-ibtn-icon fw-tdock-btn" title="Send" aria-label="Send">${agentIcon("send", 14)}</button>
</form>
</section>`);
  const anchor = host.querySelector<HTMLElement>(".fw-dock-anchor");
  if (anchor) anchor.before(root);
  else host.append(root);

  const tabsEl = q(root, ".fw-tdock-tabs");
  const stage = q(root, ".fw-tdock-stage");
  const empty = q(root, ".fw-tdock-empty");
  const ask = q<HTMLInputElement>(root, ".fw-tdock-ask-input");
  const restartButton = q<HTMLButtonElement>(root, '[data-tdock="restart"]');
  const tabs = new Map<string, Tab>();
  let active: string | null = null;
  let chat: ChatPane | null = null;
  let chatTab: HTMLElement | null = null;
  let shown = false;
  let looking: string[] = [];

  const fail = (err: unknown) => {
    setText(host.querySelector(".fw-notice"), err instanceof Error ? err.message : String(err));
  };

  const describe = () => {
    const doc = engine.get("document");
    for (const t of doc.tracks) {
      const c = t.clips.find((x) => x.id === looking[0]);
      if (c) return `Looking at ${t.name}, ${(doc.media[c.mediaId]?.name ?? "a clip").replace(/\.[^.]+$/, "")}`;
    }
    return "";
  };
  host.addEventListener("fw-selection", (e) => {
    looking = (e as CustomEvent<string[]>).detail ?? [];
  });

  const syncEmpty = () => setHidden(empty, tabs.size > 0 || !!chatTab);
  const syncAsk = () => {
    const text = active === "chat" ? "Ask Claude about your session (Enter to send)" : "Ask Claude Code to work on your session";
    if (ask.placeholder !== text) ask.placeholder = text;
  };

  const theme = () => ({
    background: token("--surface-0", "#111111"),
    foreground: token("--text-primary", "#f7f7f7"),
    cursor: token("--accent-color", "#f97316"),
    cursorAccent: token("--surface-0", "#111111"),
    selectionBackground: token("--accent-color-dim", "#f9731633"),
  });

  const sendSize = (t: Tab) => {
    if (t.socket?.readyState === WebSocket.OPEN) t.socket.send(JSON.stringify({ type: "resize", cols: t.term.cols, rows: t.term.rows }));
  };

  const fitActive = () => {
    const t = active ? tabs.get(active) : null;
    if (!t || t.host.hidden || stage.clientHeight < 20) return;
    const before = `${t.term.cols}x${t.term.rows}`;
    t.fit.fit();
    if (`${t.term.cols}x${t.term.rows}` !== before) sendSize(t);
  };

  const focus = () => {
    if (active === "chat") ask.focus();
    else if (active) tabs.get(active)?.term.focus();
  };

  const select = (id: string) => {
    active = id;
    for (const [tid, t] of tabs) {
      const on = tid === id;
      setHidden(t.host, !on);
      setClass(t.tab, "is-on", on);
      t.tab.setAttribute("aria-selected", String(on));
    }
    if (chat) setHidden(chat.root, id !== "chat");
    if (chatTab) {
      setClass(chatTab, "is-on", id === "chat");
      chatTab.setAttribute("aria-selected", String(id === "chat"));
    }
    syncAsk();
    restartButton.disabled = id === "chat";
    fitActive();
    focus();
  };

  const connect = (t: Tab) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/terminal/${encodeURIComponent(t.id)}`);
    t.socket = socket;
    socket.addEventListener("open", () => sendSize(t));
    socket.addEventListener("message", (msg) => {
      const data = String(msg.data);
      if (data === '{"type": "exit"}') {
        t.term.write(`\r\n\x1b[2m[${t.kind === "claude" ? "Claude Code ended. Restart runs it again." : "The shell ended. Restart runs it again."}]\x1b[0m\r\n`);
        return;
      }
      t.term.write(data);
    });
    t.term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
  };

  const mount = (info: TermInfo, show: boolean) => {
    const kind = info.kind ?? "shell";
    const term = new Terminal({ fontFamily: token("--font-mono", "monospace"), fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, allowProposedApi: false, theme: theme() });
    term.attachCustomKeyEventHandler((e) => !combo(e));
    const fit = new FitAddon();
    term.loadAddon(fit);
    const pane = el(`<div class="fw-tdock-term" data-id="${escapeHtml(info.id)}" hidden></div>`);
    const tab = el(`<button type="button" class="fw-tdock-tab${kind === "claude" ? " is-claude" : ""}" role="tab" aria-selected="false">${agentIcon(kind === "claude" ? "agent" : "terminal", 13)}<span class="fw-tdock-tab-title"></span><span class="fw-tdock-tab-x" role="button" aria-label="Close this tab">${agentIcon("close", 11)}</span></button>`);
    setText(q(tab, ".fw-tdock-tab-title"), info.title);
    tab.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".fw-tdock-tab-x")) void closeTab(info.id);
      else select(info.id);
    });
    stage.appendChild(pane);
    tabsEl.appendChild(tab);
    const t: Tab = { id: info.id, term, fit, host: pane, tab, socket: null, kind };
    tabs.set(info.id, t);
    syncEmpty();
    term.open(pane);
    if (show || !active) select(info.id);
    connect(t);
  };

  const sync = async () => {
    const listed = await engineCall<{ terminals: TermInfo[] }>("/api/terminal/list").catch(() => ({ terminals: [] as TermInfo[] }));
    for (const t of listed.terminals) if (!tabs.has(t.id)) mount(t, false);
  };

  const size = () => {
    const t = active ? tabs.get(active) : null;
    return t ? { cols: t.term.cols, rows: t.term.rows } : { cols: 100, rows: 20 };
  };

  const openShell = async () => {
    try {
      mount(await engineCall<TermInfo>("/api/terminal/open", { cols: 100, rows: 20 }), true);
    } catch (err) {
      fail(err);
    }
  };

  const openClaude = async (prompt?: string, resume?: string) => {
    const { cols, rows } = size();
    try {
      const info = await engineCall<TermInfo>("/api/claudecode/open", { prompt: prompt || undefined, resume: resume || undefined, cols, rows });
      if (tabs.has(info.id)) select(info.id);
      else mount(info, true);
    } catch (err) {
      fail(err);
    }
  };

  const closeChat = () => {
    chatTab?.remove();
    chatTab = null;
    if (chat) setHidden(chat.root, true);
    if (active === "chat") {
      active = null;
      const next = [...tabs.keys()].pop();
      if (next) select(next);
      else restartButton.disabled = true;
    }
    syncAsk();
    syncEmpty();
  };

  const showChatTab = async () => {
    if (!chat) {
      chat = new ChatPane(host);
      chat.onFail = fail;
      chat.onHandoff = (session) => void openClaude(undefined, session);
      stage.appendChild(chat.root);
    }
    if (!chatTab) {
      const tab = el(`<button type="button" class="fw-tdock-tab is-chat" role="tab" aria-selected="false">${agentIcon("agentChat", 13)}<span class="fw-tdock-tab-title">Chat</span><span class="fw-tdock-tab-x" role="button" aria-label="Close the Chat tab">${agentIcon("close", 11)}</span></button>`);
      tab.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".fw-tdock-tab-x")) closeChat();
        else select("chat");
      });
      tabsEl.prepend(tab);
      chatTab = tab;
    }
    syncEmpty();
    select("chat");
    await chat.load();
  };

  async function closeTab(id: string): Promise<void> {
    const t = tabs.get(id);
    if (!t) return;
    t.socket?.close();
    t.term.dispose();
    t.host.remove();
    t.tab.remove();
    tabs.delete(id);
    await engineCall("/api/terminal/close", { id }).catch(() => undefined);
    if (active === id) {
      active = null;
      const next = [...tabs.keys()].pop() ?? (chatTab ? "chat" : undefined);
      if (next) select(next);
      else restartButton.disabled = true;
    }
    syncEmpty();
  }

  const restart = async () => {
    const t = active ? tabs.get(active) : null;
    if (!t) return;
    try {
      await engineCall("/api/terminal/restart", { id: t.id });
      sendSize(t);
      t.term.focus();
    } catch (err) {
      fail(err);
    }
  };

  const setShown = (on: boolean) => {
    shown = on;
    setHidden(root, !on);
    button.setAttribute("aria-pressed", String(on));
  };

  const ensure = async () => {
    await sync();
    if (!tabs.size && !chatTab) await openShell();
    else if (!active) select([...tabs.keys()][0] ?? "chat");
    else fitActive();
    focus();
  };

  const show = async () => {
    setShown(true);
    await ensure();
  };
  const hide = () => setShown(false);
  const toggle = () => (shown ? hide() : void show());
  const showClaude = async (prompt?: string) => {
    setShown(true);
    await sync();
    await openClaude(prompt);
  };
  const showChat = async (text?: string) => {
    setShown(true);
    await sync();
    await showChatTab();
    if (text && chat) await chat.send(text);
  };
  const showNew = async () => {
    setShown(true);
    await sync();
    await openShell();
  };

  const send = async () => {
    const text = ask.value.trim();
    if (!text) return;
    const extra = describe();
    if (active === "chat" && chat?.isBusy()) return;
    ask.value = "";
    if (active === "chat" && chat) await chat.send(text, extra, extra);
    else await openClaude(extra ? `${text} (${extra})` : text);
  };

  root.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-tdock]")?.dataset.tdock;
    if (act === "new") void openShell();
    else if (act === "chat") void showChat();
    else if (act === "claude") void openClaude();
    else if (act === "restart") void restart();
    else if (act === "hide") hide();
  });
  q(root, ".fw-tdock-ask").addEventListener("submit", (e) => {
    e.preventDefault();
    void send();
  });
  stage.addEventListener("keydown", (e) => {
    if (!combo(e)) e.stopPropagation();
  });
  new ResizeObserver(fitActive).observe(stage);

  const setHeight = (px: number) => {
    const limit = (root.parentElement?.clientHeight ?? 0) * 0.75;
    const clamped = Math.round(Math.max(140, limit ? Math.min(px, limit) : px));
    root.style.setProperty("--fw-tdock-h", `${clamped}px`);
    return clamped;
  };
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY));
    if (saved > 0) setHeight(saved);
  } catch {
    /* storage unavailable: the default height */
  }
  const rsz = q(root, ".fw-tdock-rsz");
  rsz.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    rsz.setPointerCapture(e.pointerId);
    setClass(rsz, "is-dragging", true);
    const startY = e.clientY;
    const startH = root.getBoundingClientRect().height;
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = setHeight(startH + (startY - ev.clientY));
    };
    const up = () => {
      rsz.removeEventListener("pointermove", move);
      rsz.removeEventListener("pointerup", up);
      setClass(rsz, "is-dragging", false);
      try {
        localStorage.setItem(HEIGHT_KEY, String(last));
      } catch {
        /* not kept */
      }
    };
    rsz.addEventListener("pointermove", move);
    rsz.addEventListener("pointerup", up);
  });

  button.addEventListener("click", toggle);
  window.addEventListener("keydown", (e) => {
    const k = combo(e);
    if (!k) return;
    e.preventDefault();
    if (k === "toggle") toggle();
    else if (k === "claude") void showClaude();
    else void showChat();
  });

  const listen = (name: string, run: (detail: Record<string, unknown>) => void) => {
    window.addEventListener(name, (e) => run(((e as CustomEvent).detail ?? {}) as Record<string, unknown>));
    host.addEventListener(name, (e) => {
      if (!e.bubbles) run(((e as CustomEvent).detail ?? {}) as Record<string, unknown>);
    });
  };
  listen("fw-dock-toggle", toggle);
  listen("fw-dock-new", () => void showNew());
  listen("fw-dock-chat", (d) => void showChat(typeof d.text === "string" && d.text.trim() ? d.text.trim() : undefined));
  listen("fw-dock-claude", (d) => void showClaude(typeof d.prompt === "string" && d.prompt.trim() ? d.prompt.trim() : undefined));
  listen("fw-terminal", (d) => (d.claude ? void showClaude() : void show()));
}
