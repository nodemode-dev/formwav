import type { Engine } from "../engine";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * PLAN_v14 W2: one registry of what formwav can do, as formvis keeps it in its window. Every command has an id, a
 * label, a group, words for an agent and its parameters; the menus' items are gathered into it when the interface is
 * up, the agent's session tools register themselves, and the palette (Cmd or Ctrl K), the engine's /api/commands and
 * the MCP tools list_commands, describe_command, run_command and run_commands are all made from it.
 */
export type Json = Record<string, unknown>;
export interface CommandParam {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  required?: boolean;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  description?: string;
}
export interface Command {
  id: string;
  label: string;
  group: string;
  description?: string;
  keys?: string;
  params?: Record<string, CommandParam>;
  mutates?: boolean;
  risky?: boolean;
  enabled?: () => boolean;
  run: (params: Json) => unknown;
}
export interface RunResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  undoName?: string;
}

const RISKY = /export|delete|remove|clear|new session|open|close|quit|revert|commit|consolidate|overwrite|replace/i;
const slug = (s: string) => s.toLowerCase().replace(/\.{3}|…/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class Commands {
  private map = new Map<string, Command>();
  private listeners = new Set<() => void>();
  engine: Engine | null = null;

  add(c: Command): void {
    if (this.map.has(c.id)) throw new Error(`duplicate command: ${c.id}`);
    this.map.set(c.id, c);
    this.listeners.forEach((fn) => fn());
  }
  get(id: string): Command | undefined {
    return this.map.get(id);
  }
  all(): Command[] {
    return [...this.map.values()];
  }
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }
  describe(c: Command) {
    return { id: c.id, label: c.label, group: c.group, description: c.description ?? c.label, keys: c.keys, params: c.params ?? {}, mutates: c.mutates ?? true, risky: c.risky ?? false, enabled: c.enabled ? c.enabled() : true };
  }
  /** Checks the parameters against the command's own (unknown names and wrong types refused, numbers given as text
   *  taken), runs it, and names the History step it made. */
  async call(id: string, params: Json = {}): Promise<RunResult> {
    const c = this.map.get(id);
    if (!c) return { ok: false, error: `There is no command ${id}; list_commands gives the ids.` };
    if (c.enabled && !c.enabled()) return { ok: false, error: `${c.label} is not available now.` };
    const spec = c.params ?? {};
    const clean: Json = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      const p = spec[k];
      if (!p) return { ok: false, error: `${id} does not take ${k}; it takes ${Object.keys(spec).join(", ") || "nothing"}.` };
      let value = v;
      if ((p.type === "number" || p.type === "integer") && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) value = Number(v);
      if (p.type === "boolean" && (v === "true" || v === "false")) value = v === "true";
      const ok = p.type === "array" ? Array.isArray(value) : p.type === "object" ? typeof value === "object" && value !== null && !Array.isArray(value) : p.type === "integer" ? Number.isInteger(value) : typeof value === p.type;
      if (!ok) return { ok: false, error: `${k} must be ${p.type === "integer" ? "a whole number" : `a ${p.type}`}; give it as ${k}=${p.type === "string" ? "text" : "1"}.` };
      if (p.enum && !p.enum.includes(value as string | number)) return { ok: false, error: `${k} must be one of ${p.enum.join(", ")}.` };
      if (typeof value === "number" && ((p.minimum !== undefined && value < p.minimum) || (p.maximum !== undefined && value > p.maximum))) return { ok: false, error: `${k} must be from ${p.minimum ?? "-inf"} to ${p.maximum ?? "inf"}.` };
      clean[k] = value;
    }
    const missing = Object.entries(spec).filter(([k, p]) => p.required && clean[k] === undefined).map(([k]) => k);
    if (missing.length) return { ok: false, error: `${id} needs ${missing.join(", ")}.` };
    const before = this.engine?.historyEntries().done.length ?? 0;
    try {
      const result = await c.run(clean);
      const done = this.engine?.historyEntries().done ?? [];
      return { ok: true, result: result ?? null, ...(done.length > before ? { undoName: done[done.length - 1].label } : {}) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  /** Commands in order as one History group: stops at the first that fails and takes back what the batch did. */
  async batch(list: { id: string; params?: Json }[]): Promise<{ ok: boolean; results: RunResult[] }> {
    const depth = this.engine?.get("history").undoDepth ?? 0;
    const results: RunResult[] = [];
    for (const step of list) {
      const r = await this.call(step.id, step.params ?? {});
      results.push(r);
      if (!r.ok) {
        const now = this.engine?.get("history").undoDepth ?? depth;
        for (let k = depth; k < now; k++) this.engine?.undo();
        return { ok: false, results };
      }
    }
    return { ok: true, results };
  }
  /** The menu bar's items as commands, by the menu's name and the item's words (Edit > Duplicate is edit.duplicate),
   *  run by clicking the item as a person would; read once the interface is up. */
  gather(host: HTMLElement): void {
    for (const pop of host.querySelectorAll<HTMLElement>(".fw-topbar .fw-menu-pop[aria-label]")) {
      const menu = pop.getAttribute("aria-label") ?? "";
      for (const item of pop.querySelectorAll<HTMLElement>('[role^="menuitem"]')) {
        const words = [...item.childNodes].filter((n) => n.nodeName !== "KBD").map((n) => n.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
        if (!words) continue;
        const id = `${slug(menu)}.${slug(words)}`;
        if (!id.split(".")[1] || this.map.has(id)) continue;
        const keys = item.querySelector("kbd")?.textContent?.trim();
        this.add({
          id,
          label: words.replace(/\.{3}|…$/, ""),
          group: menu,
          description: item.title || `${menu} > ${words}`,
          ...(keys ? { keys } : {}),
          mutates: !/^(view|settings)$/i.test(menu),
          risky: RISKY.test(words),
          enabled: () => !(item as HTMLButtonElement).disabled,
          run: () => {
            item.click();
            return { ran: `${menu} > ${words}` };
          },
        });
      }
    }
  }
}

export const commands = new Commands();

/** The palette: Cmd or Ctrl K, a search over every command by its words and menu, twelve rows made once and patched
 *  in place, Enter runs the highlighted one. */
export function mountPalette(host: HTMLElement, engine: Engine): void {
  commands.engine = engine;
  const box = document.createElement("div");
  box.className = "fw-palette";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Commands");
  box.innerHTML = `<input class="fw-palette-input" type="text" placeholder="Type a command" aria-label="Search commands" spellcheck="false" autocomplete="off"><ol class="fw-palette-list" role="listbox" aria-label="Commands"></ol><p class="fw-palette-empty" hidden>No command matches</p>`;
  document.body.append(box);
  const input = box.querySelector<HTMLInputElement>("input") as HTMLInputElement;
  const list = box.querySelector<HTMLOListElement>("ol") as HTMLOListElement;
  const empty = box.querySelector<HTMLElement>(".fw-palette-empty");
  const ROWS = 12;
  const rows = Array.from({ length: ROWS }, () => {
    const li = document.createElement("li");
    li.className = "fw-palette-row";
    li.setAttribute("role", "option");
    li.innerHTML = `<span class="fw-palette-label"></span><span class="fw-palette-group"></span><kbd class="fw-palette-keys"></kbd>`;
    list.append(li);
    return li;
  });
  let shown: Command[] = [];
  let at = 0;
  const score = (text: string, q: string) => {
    const t = text.toLowerCase();
    if (!q) return 1;
    const i = t.indexOf(q);
    if (i >= 0) return 100 - i;
    let pos = 0;
    for (const ch of q) {
      pos = t.indexOf(ch, pos);
      if (pos < 0) return 0;
      pos++;
    }
    return 10;
  };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    shown = commands
      .all()
      .filter((c) => (!c.enabled || c.enabled()) && !Object.values(c.params ?? {}).some((p) => p.required))
      .map((c) => ({ c, s: Math.max(score(c.label, q), score(`${c.group} ${c.label}`, q) - 5) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label))
      .slice(0, ROWS)
      .map((x) => x.c);
    at = Math.min(at, Math.max(0, shown.length - 1));
    rows.forEach((li, k) => {
      const c = shown[k];
      if (li.hidden !== !c) li.hidden = !c;
      if (!c) return;
      setText(li.querySelector(".fw-palette-label"), c.label);
      setText(li.querySelector(".fw-palette-group"), c.group);
      setText(li.querySelector(".fw-palette-keys"), c.keys ?? "");
      const on = String(k === at);
      if (li.getAttribute("aria-selected") !== on) li.setAttribute("aria-selected", on);
    });
    if (empty && empty.hidden !== shown.length > 0) empty.hidden = shown.length > 0;
  };
  const close = () => {
    if (box.hidden) return;
    box.hidden = true;
  };
  const open = () => {
    input.value = "";
    at = 0;
    paint();
    box.hidden = false;
    input.focus();
  };
  const runAt = (k: number) => {
    const c = shown[k];
    if (!c) return;
    close();
    void commands.call(c.id).then((r) => {
      if (!r.ok && r.error) setText(host.querySelector(".fw-notice"), r.error);
    });
  };
  input.addEventListener("input", () => {
    at = 0;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(at);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>(".fw-palette-row");
    if (!li) return;
    e.preventDefault();
    runAt(rows.indexOf(li as HTMLLIElement));
  });
  input.addEventListener("blur", () => window.setTimeout(close, 0));
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (box.hidden) open();
      else close();
    }
  });
}
