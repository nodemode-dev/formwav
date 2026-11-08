import { setNativeMenu, textEdit, textFieldFocused, wantsNativeMenus } from "./desktop";
import { commands } from "./commands";

/**
 * formwav's menus in the macOS menu bar, as the desktop app on a Mac shows them (the owner's decision for the form
 * family, built the way formvis's native-menu.ts does): an application menu first (About, Preferences, Hide, Quit, which
 * the shell builds), then File, Edit, View, Track, Clip, Event, Transport, Extensions, Settings and Help. The page's menu
 * pops are the one list: the system menu is described from them, item by item, so the two never differ in labels,
 * order, separators, shortcuts, tick marks or what is enabled. The shell receives labels, ids and shortcuts and builds
 * the menu itself (set_menu); a click comes back as the id of the item, which is its place in its pop, and clicks that
 * item as a person would. On macOS the menu bar owns the shortcuts, so no pop is shown in the window; elsewhere, and in a
 * browser, nothing here runs and the in-window menus stay.
 */
interface Entry {
  kind: "item" | "sep" | "sub";
  id?: string;
  label?: string;
  accel?: string;
  enabled?: boolean;
  checked?: boolean;
  items?: Entry[];
}

const GLYPHS: Record<string, string> = { "⌘": "CmdOrCtrl", "⇧": "Shift", "⌥": "Alt", "⌃": "Ctrl" };
const NAMED: Record<string, string> = { Space: "Space", Enter: "Enter", Tab: "Tab", Delete: "Delete", Backspace: "Backspace", Esc: "Escape" };
// the keys the system's Edit menu owns, so the menu bar does not take them from a text field
const EDIT_KEYS = new Set(["CmdOrCtrl+A", "CmdOrCtrl+C", "CmdOrCtrl+V", "CmdOrCtrl+X"]);
const MENUS = ["File", "Edit", "View", "Track", "Clip", "Event", "Transport", "Extensions", "Settings", "Help"];

/** A shortcut as the pops write it (⇧⌘E, ⌥⇧H, ⌘,) as a Tauri accelerator (CmdOrCtrl+Shift+E); null for a bare key or what has no name. */
export function accelerator(text: string | null | undefined): string | null {
  const chars = [...(text ?? "").trim()];
  const mods: string[] = [];
  while (chars.length && GLYPHS[chars[0]]) mods.push(GLYPHS[chars.shift() as string]);
  const key = chars.join("");
  if (!mods.length || !(mods.includes("CmdOrCtrl") || mods.includes("Ctrl") || mods.includes("Alt"))) return null;
  const name = NAMED[key] ?? (/^[A-Za-z0-9]$/.test(key) ? key.toUpperCase() : /^[,.\[\]=\-]$/.test(key) ? key : null);
  if (!name) return null;
  const order = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"];
  return [...order.filter((m) => mods.includes(m)), name].join("+");
}

const labelOf = (item: HTMLElement): string =>
  [...item.childNodes]
    .filter((n) => n.nodeName !== "KBD" && !(n instanceof HTMLElement && (n.classList.contains("fw-check") || n.classList.contains("icon") || n.nodeName === "svg")))
    .map((n) => n.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const shown = (el: HTMLElement, pop: HTMLElement): boolean => {
  for (let node: HTMLElement | null = el; node && node !== pop; node = node.parentElement) if (node.hidden) return false;
  return true;
};

export function mountNativeMenu(host: HTMLElement): void {
  if (!wantsNativeMenus()) return;
  const pops = (): HTMLElement[] => MENUS.map((name) => host.querySelector<HTMLElement>(`.fw-topbar .fw-menu-pop[aria-label="${name}"]`)).filter((p): p is HTMLElement => !!p);
  const itemsOf = (pop: HTMLElement): HTMLElement[] => [...pop.querySelectorAll<HTMLElement>('[role^="menuitem"], .fw-menu-sep')].filter((el) => shown(el, pop));
  const describe = (): Entry[] => {
    const taken = new Set<string>(EDIT_KEYS);
    return pops().map((pop, menu) => {
      const name = pop.getAttribute("aria-label") ?? "";
      const out: Entry[] = [];
      itemsOf(pop).forEach((el, at) => {
        if (el.classList.contains("fw-menu-sep")) {
          if (out.length && out[out.length - 1].kind !== "sep") out.push({ kind: "sep" });
          return;
        }
        const label = labelOf(el);
        if (!label || el.dataset.cmd === "settings") return;
        let accel = accelerator(el.querySelector("kbd")?.textContent);
        if (accel && taken.has(accel)) accel = null;
        if (accel) taken.add(accel);
        const entry: Entry = { kind: "item", id: `n:${menu}:${at}`, label, enabled: !(el as HTMLButtonElement).disabled };
        if (accel) entry.accel = accel;
        if (el.hasAttribute("aria-checked")) entry.checked = el.getAttribute("aria-checked") === "true";
        out.push(entry);
      });
      while (out.length && out[out.length - 1].kind === "sep") out.pop();
      if (name === "Edit") {
        out.push(
          { kind: "sep" },
          { kind: "item", id: "cut", label: "Cut", accel: "CmdOrCtrl+X" },
          { kind: "item", id: "copy", label: "Copy", accel: "CmdOrCtrl+C" },
          { kind: "item", id: "paste", label: "Paste", accel: "CmdOrCtrl+V" },
          { kind: "item", id: "select-all", label: "Select All", accel: "CmdOrCtrl+A" },
        );
      }
      return { kind: "sub", label: name, items: out };
    });
  };

  let sent = "";
  let timer = 0;
  const send = (): void => {
    timer = 0;
    const menus = describe();
    const text = JSON.stringify(menus);
    if (text === sent) return;
    sent = text;
    setNativeMenu(menus);
  };
  const later = (): void => {
    if (!timer) timer = window.setTimeout(send, 250);
  };
  const watch = new MutationObserver(later);
  for (const pop of pops()) watch.observe(pop, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ["disabled", "aria-checked", "hidden", "title"] });
  commands.onChange(later);
  send();

  host.addEventListener("fw-desktop-menu", (event) => {
    const id = String((event as CustomEvent<string>).detail);
    if (id === "preferences") {
      void commands.call("settings");
      event.preventDefault();
      return;
    }
    const at = /^n:(\d+):(\d+)$/.exec(id);
    if (!at) return;
    const pop = pops()[Number(at[1])];
    const el = pop ? itemsOf(pop)[Number(at[2])] : undefined;
    event.preventDefault();
    if (!el) return;
    const label = labelOf(el);
    if (textFieldFocused() && pop.getAttribute("aria-label") === "Edit" && (label === "Undo" || label === "Redo")) {
      textEdit(label.toLowerCase());
      return;
    }
    el.click();
  });
}
