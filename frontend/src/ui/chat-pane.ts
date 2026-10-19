import { setClass, setText } from "../vendor/nodemode/dom-stable";
import { agentIcon } from "./icons-agent";
import { MarkdownStream } from "./markdown";

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  return root.querySelector(sel) as T;
}

export function setHidden(node: HTMLElement, on: boolean): void {
  if (node.hidden !== on) node.hidden = on;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function engineCall<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
  return out as T;
}

interface Part {
  kind: "text" | "tool";
  text?: string;
  id?: string;
  name?: string;
  input?: string;
  status?: string;
}
interface Meta {
  seconds?: number;
  turns?: number | null;
  costUsd?: number | null;
  inputTokens?: number;
  outputTokens?: number;
}
interface Message {
  role: "user" | "assistant";
  text?: string;
  note?: string;
  parts?: Part[];
  error?: string;
  meta?: Meta;
}
interface Usage {
  input: number;
  output: number;
  costUsd: number;
  context: number;
  window: number;
  model: string;
}
interface State {
  busy: boolean;
  session: string | null;
  messages: Message[];
  usage?: Usage;
}
interface ChatEvent {
  type: string;
  [key: string]: unknown;
}
interface Session {
  id: string;
  title: string;
  modified: number;
  current: boolean;
}

const NO_USAGE: Usage = { input: 0, output: 0, costUsd: 0, context: 0, window: 0, model: "" };

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

export class ChatPane {
  readonly root: HTMLElement;
  onFail: (err: unknown) => void = () => undefined;
  onHandoff: (session: string) => void = () => undefined;
  private readonly host: HTMLElement;
  private readonly log: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly status: HTMLElement;
  private readonly stop: HTMLElement;
  private reply: HTMLElement | null = null;
  private md: MarkdownStream | null = null;
  private usage: Usage = NO_USAGE;
  private readonly chips = new Map<string, HTMLElement>();
  private busy = false;
  private loaded = false;
  private greeted = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.root = el(`<div class="fw-chat" hidden>
<div class="fw-chat-bar"><span class="fw-chat-status"></span><span class="fw-chat-usage" translate="no"></span><span class="fw-tdock-spacer"></span>
<button type="button" class="fw-ibtn fw-tdock-text fw-chat-stop" hidden>Stop</button>
<button type="button" class="fw-ibtn fw-tdock-text fw-chat-adopt" title="Bring a conversation you had in a Claude Code tab into this chat">From Claude Code...</button>
<button type="button" class="fw-ibtn fw-tdock-text fw-chat-handoff" title="Continue this conversation in a Claude Code tab">Open in Claude Code</button>
<button type="button" class="fw-ibtn fw-tdock-text fw-chat-new">New Chat</button></div>
<div class="fw-chat-log" role="log" aria-live="polite"><p class="fw-chat-empty">Ask Claude in the line below to work on this session: tidy a recording, level the voices, set the loudness. Every change shows in the window, and every change can be undone.</p></div>
</div>`);
    this.log = q(this.root, ".fw-chat-log");
    this.empty = q(this.root, ".fw-chat-empty");
    this.meter = q(this.root, ".fw-chat-usage");
    this.status = q(this.root, ".fw-chat-status");
    this.stop = q(this.root, ".fw-chat-stop");
    this.meter.title = "Memory: how much of Claude's working memory this conversation fills. Reply: the size of this answer so far. Chat: the size of the whole conversation, and what it has cost. Sizes are counted in tokens, small pieces of words.";
    this.stop.addEventListener("click", () => void engineCall("/api/claude/cancel", {}).catch((e) => this.onFail(e)));
    q(this.root, ".fw-chat-new").addEventListener("click", () => void engineCall("/api/claude/reset", {}).catch((e) => this.onFail(e)));
    q(this.root, ".fw-chat-handoff").addEventListener("click", () => void this.handoff());
    q(this.root, ".fw-chat-adopt").addEventListener("click", () => void this.adopt());
    const source = new EventSource("/api/claude/events");
    source.onmessage = (m) => {
      try {
        this.event(JSON.parse(m.data) as ChatEvent);
      } catch {
        /* a malformed line is skipped */
      }
    };
  }

  private event(e: ChatEvent): void {
    if (e.type === "hello") {
      if (this.greeted && this.loaded) this.refresh();
      this.greeted = true;
    } else if (e.type === "start") {
      this.user(String(e.text ?? ""), String(e.note ?? ""));
      this.begin();
    } else if (e.type === "delta") this.delta(String(e.text ?? ""));
    else if (e.type === "tool") this.tool({ kind: "tool", id: String(e.id ?? ""), name: String(e.name ?? ""), input: String(e.input ?? ""), status: "running" });
    else if (e.type === "toolDone") {
      const c = this.chips.get(String(e.id ?? ""));
      if (c) this.mark(c, String(e.status ?? "done"));
    } else if (e.type === "usage") this.showUsage({ ...this.usage, context: Number(e.context ?? 0), window: Number(e.window ?? 0) || this.usage.window, model: String(e.model ?? this.usage.model) }, Number(e.output ?? 0));
    else if (e.type === "done") {
      this.close(String(e.error ?? ""), (e.meta ?? {}) as Meta);
      if (e.usage) this.showUsage(e.usage as Usage, -1);
    } else if (e.type === "reset") {
      this.clear();
      this.setBusy(false);
      this.showUsage(NO_USAGE, -1);
    } else if (e.type === "adopted") this.refresh();
  }

  private clear(): void {
    this.log.replaceChildren(this.empty);
    setHidden(this.empty, false);
    this.reply = null;
    this.md = null;
    this.chips.clear();
  }

  private refresh(): void {
    this.loaded = false;
    this.clear();
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const s = await engineCall<State>("/api/claude/state");
      for (const m of s.messages) {
        if (m.role === "user") {
          this.user(m.text ?? "", m.note ?? "");
          continue;
        }
        this.begin();
        for (const p of m.parts ?? []) {
          if (p.kind === "text") this.delta(p.text ?? "");
          else this.tool(p);
        }
        this.close(m.error ?? "", m.meta ?? {});
      }
      if (s.usage) this.showUsage(s.usage, -1);
      if (s.busy) {
        this.begin();
        this.setBusy(true);
      }
    } catch (err) {
      this.loaded = false;
      this.onFail(err);
    }
  }

  async send(text: string, context = "", note = ""): Promise<void> {
    try {
      await engineCall("/api/claude/chat", { text, context, note });
    } catch (err) {
      this.onFail(err);
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    setHidden(this.stop, !on);
    setText(this.status, on ? "Claude is working..." : "");
  }

  private scroll(): void {
    const l = this.log;
    if (l.scrollHeight - l.scrollTop - l.clientHeight < 80) l.scrollTop = l.scrollHeight;
  }

  private user(text: string, note = ""): void {
    setHidden(this.empty, true);
    const n = el('<div class="fw-chat-msg is-user" translate="no"><span class="fw-chat-said"></span></div>');
    setText(q(n, ".fw-chat-said"), text);
    if (note) {
      const m = el('<span class="fw-chat-note"></span>');
      setText(m, note);
      n.appendChild(m);
    }
    this.log.appendChild(n);
    this.scroll();
  }

  private begin(): void {
    setHidden(this.empty, true);
    this.endText();
    this.reply = el('<div class="fw-chat-msg is-claude"></div>');
    this.log.appendChild(this.reply);
    this.setBusy(true);
    this.scroll();
  }

  private delta(text: string): void {
    if (!this.reply) this.begin();
    if (!this.md) {
      this.md = new MarkdownStream("fw-chat-text fw-md");
      this.md.root.setAttribute("translate", "no");
      this.reply?.appendChild(this.md.root);
    }
    this.md.push(text);
    this.scroll();
  }

  private endText(): void {
    this.md?.end();
    this.md = null;
  }

  private showUsage(u: Usage, reply: number): void {
    this.usage = u;
    if (!u.context && !u.input && reply < 0) {
      setText(this.meter, "");
      return;
    }
    const parts: string[] = [];
    if (u.context) parts.push(`Memory ${tokens(u.context)}${u.window ? ` of ${tokens(u.window)}` : ""}`);
    if (reply >= 0) parts.push(`Reply ${tokens(reply)} tokens`);
    if (u.input || u.output) parts.push(`Chat ${tokens(u.input + u.output)} tokens${u.costUsd ? ` · $${u.costUsd.toFixed(u.costUsd < 1 ? 3 : 2)}` : ""}`);
    setText(this.meter, parts.join(" · "));
    setClass(this.meter, "is-high", !!u.window && u.context / u.window > 0.8);
  }

  private async handoff(): Promise<void> {
    try {
      const s = await engineCall<State>("/api/claude/state");
      if (!s.session) {
        this.onFail(new Error("Start a conversation here first; then it can continue in Claude Code"));
        return;
      }
      if (s.busy) {
        this.onFail(new Error("Wait for Claude to finish, or press Stop, before moving the conversation"));
        return;
      }
      this.onHandoff(s.session);
    } catch (err) {
      this.onFail(err);
    }
  }

  private async adopt(): Promise<void> {
    try {
      const r = await engineCall<{ sessions: Session[] }>("/api/claude/sessions");
      if (!r.sessions.length) {
        this.onFail(new Error("No Claude Code conversation here yet: open one with the robot button first"));
        return;
      }
      const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const options = r.sessions.map((s): [string, string] => [s.id, escapeHtml(`${when(s.modified)} · ${s.title || "untitled"}${s.current ? " (this chat)" : ""}`)]);
      const picked = await new Promise<Record<string, unknown> | null>((done) =>
        this.host.dispatchEvent(
          new CustomEvent("fw-ask", {
            detail: {
              title: "Continue from Claude Code",
              note: "Brings a conversation from a Claude Code tab into this chat: its messages show here and your next message continues it.",
              fields: [{ key: "session", label: "Conversation", value: options[0][0], options }],
              ok: "Continue Here",
              done,
            },
          }),
        ),
      );
      const id = String(picked?.session ?? "");
      if (picked && id && options.some(([v]) => v === id)) await engineCall("/api/claude/adopt", { session: id });
    } catch (err) {
      this.onFail(err);
    }
  }

  private tool(p: Part): void {
    if (!this.reply) this.begin();
    this.endText();
    const chip = el(`<div class="fw-chat-tool" translate="no"><span class="fw-chat-tool-mark">${agentIcon("terminal", 11)}</span><span class="fw-chat-tool-name"></span><span class="fw-chat-tool-input"></span></div>`);
    setText(q(chip, ".fw-chat-tool-name"), p.name ?? "");
    setText(q(chip, ".fw-chat-tool-input"), p.input ?? "");
    chip.title = p.input ?? "";
    this.mark(chip, p.status ?? "running");
    if (p.id) this.chips.set(p.id, chip);
    this.reply?.appendChild(chip);
    this.scroll();
  }

  private mark(chip: HTMLElement, s: string): void {
    for (const k of ["running", "done", "error"]) setClass(chip, `is-${k}`, s === k);
  }

  private close(error: string, meta: Meta): void {
    if (!this.reply) this.begin();
    this.endText();
    for (const c of this.reply?.querySelectorAll<HTMLElement>(".fw-chat-tool.is-running") ?? []) this.mark(c, "done");
    if (error) {
      const n = el('<div class="fw-chat-error"></div>');
      setText(n, error);
      this.reply?.appendChild(n);
    }
    if (meta.seconds !== undefined) {
      const n = el('<div class="fw-chat-meta"></div>');
      const used = meta.inputTokens || meta.outputTokens ? ` · ${tokens((meta.inputTokens ?? 0) + (meta.outputTokens ?? 0))} tokens` : "";
      setText(n, `${meta.seconds} s${meta.turns ? ` · ${meta.turns} steps` : ""}${used}${meta.costUsd ? ` · $${meta.costUsd.toFixed(3)}` : ""}`);
      this.reply?.appendChild(n);
    }
    this.reply = null;
    this.setBusy(false);
    this.scroll();
  }
}
