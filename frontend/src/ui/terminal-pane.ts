import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * The embedded terminal (owner decision, Sprint D): a real shell on the machine running the engine, in a dock between
 * the lanes and the transport. The dock and its xterm are created once, on first open, and only hidden after that, so
 * the shell keeps running while the dock is closed; Restart opens a new shell. Ctrl+` or the title-bar button toggles
 * it. Colours and the mono face are read from the suite's tokens when the terminal is made.
 */
export function mountTerminal(host: HTMLElement): void {
  const exportButton = host.querySelector<HTMLButtonElement>('[data-action="export"]');
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fw-ibtn";
  button.dataset.action = "terminal";
  button.title = "A real shell on this machine (Ctrl+`)";
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Terminal";
  exportButton?.before(button);

  const dock = document.createElement("section");
  dock.className = "fw-term";
  dock.hidden = true;
  dock.setAttribute("aria-label", "Terminal");
  dock.innerHTML = `<div class="fw-term-head"><span class="fw-term-title">Terminal</span><span class="fw-term-state" aria-live="polite"></span><button type="button" class="fw-ibtn" data-term="claude" title="Claude Code with your own login, given formwav's tools for the open session">Claude Code</button><button type="button" class="fw-ibtn" data-term="restart">Restart</button><button type="button" class="fw-ibtn" data-term="hide">Hide</button></div><div class="fw-term-body"></div>`;
  const transport = host.querySelector<HTMLElement>(".fw-dock-anchor");
  if (transport) transport.before(dock);
  else host.append(dock);
  const body = dock.querySelector<HTMLElement>(".fw-term-body") as HTMLElement;
  const state = dock.querySelector<HTMLElement>(".fw-term-state");

  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let socket: WebSocket | null = null;

  const sendSize = () => {
    if (socket?.readyState === WebSocket.OPEN && term) socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };
  let claude = false;
  const connect = () => {
    socket?.close();
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal${claude ? "?run=claude" : ""}`);
    ws.binaryType = "arraybuffer";
    socket = ws;
    setText(state, claude ? "Starting Claude Code..." : "Starting a shell...");
    ws.onopen = () => {
      setText(state, "");
      sendSize();
    };
    ws.onmessage = (e) => term?.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = (e) => {
      if (socket === ws) setText(state, e.code === 1006 || e.code === 4403 ? "The engine would not open a shell" : claude ? "Claude Code ended; Restart opens a shell, Claude Code a new session" : "The shell ended; Restart opens a new one");
    };
  };
  const open = () => {
    dock.hidden = false;
    button.setAttribute("aria-pressed", "true");
    if (!term) {
      const css = getComputedStyle(document.documentElement);
      const tok = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      term = new Terminal({
        fontFamily: tok("--font-mono", "monospace"),
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        theme: { background: tok("--surface-0", "#111111"), foreground: tok("--text-primary", "#f7f7f7"), cursor: tok("--accent-color", "#f97316"), selectionBackground: tok("--accent-color-dim", "#f9731633") },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(body);
      term.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      });
      new ResizeObserver(() => {
        if (dock.hidden) return;
        fit?.fit();
        sendSize();
      }).observe(body);
      if (import.meta.env.DEV) Object.assign(window, { __formwavTerminal: () => term });
      connect();
    }
    fit?.fit();
    term.focus();
  };
  const hide = () => {
    dock.hidden = true;
    button.setAttribute("aria-pressed", "false");
  };
  button.addEventListener("click", () => (dock.hidden ? open() : hide()));
  dock.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-term]")?.dataset.term;
    if (act === "hide") hide();
    else if ((act === "restart" || act === "claude") && term) {
      claude = act === "claude";
      term.reset();
      connect();
      term.focus();
    }
  });
  host.addEventListener("fw-terminal", (e) => {
    const wantClaude = Boolean((e as CustomEvent<{ claude?: boolean }>).detail?.claude);
    const fresh = !term;
    if (fresh) claude = wantClaude;
    open();
    if (!fresh && wantClaude !== claude && term) {
      claude = wantClaude;
      term.reset();
      connect();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "`") {
      e.preventDefault();
      if (dock.hidden) open();
      else hide();
    }
  });
}
