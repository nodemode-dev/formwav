/**
 * PLAN_v13 S13: the Keyboard shortcuts window (View > Keyboard shortcuts, or ?): every command that has a key, by its
 * menu, from the command registry (so a new menu item with a key appears by itself), the keys the lanes and the
 * transport take with no menu, and the Commands Focus keys. Built once at its first opening; the filter hides rows,
 * nothing is rebuilt.
 */
import { commands } from "./commands";

const LANE_KEYS: [string, string][] = [
  ["Space", "Play and stop"],
  ["S", "Split the selected clips at the playhead, or the range at its edges"],
  ["Delete", "Remove the selected clips, or clear the range"],
  ["Tab, Shift Tab", "The playhead to the next or previous clip edge"],
  ["1 to 5", "Recall a zoom preset (Shift stores one)"],
  ["=, -, 0", "Zoom in, zoom out, zoom to fit"],
  ["Escape", "Clear the selection"],
];

const FOCUS_KEYS: [string, string][] = [
  ["A", "Trim start to playhead"],
  ["S", "Trim end to playhead"],
  ["D", "Fade in to playhead"],
  ["G", "Fade out from playhead"],
  ["F", "Create fades"],
  ["B", "Separate at the playhead"],
  ["P, ;", "Move the range up or down a track"],
  ["L, '", "The playhead to the previous or next clip edge"],
];

export function mountShortcutsPanel(host: HTMLElement): void {
  const dialog = document.createElement("dialog");
  dialog.className = "fw-export-dialog fw-shortcuts-dialog";
  dialog.setAttribute("aria-label", "Keyboard shortcuts");
  document.getElementById("overlay-root")?.append(dialog);
  let built = false;
  const build = () => {
    const sections: [string, [string, string][]][] = [];
    const groups = new Map<string, [string, string][]>();
    for (const c of commands.all()) {
      if (!c.keys) continue;
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group)?.push([c.keys, c.label]);
    }
    for (const [group, rows] of groups) sections.push([group, rows]);
    sections.push(["In the lanes", LANE_KEYS], ["Commands Focus (View > Commands Focus)", FOCUS_KEYS]);
    dialog.innerHTML = `<h2 class="fw-dialog-title">Keyboard shortcuts</h2><input class="fw-shortcuts-filter" type="text" placeholder="Find a command or a key" aria-label="Find a shortcut" spellcheck="false" autocomplete="off"><div class="fw-shortcuts-body"></div><p class="fw-shortcuts-empty" hidden>No shortcut matches</p><div class="fw-dialog-actions"><button type="button" class="fw-ibtn" data-close>Close</button></div>`;
    const body = dialog.querySelector(".fw-shortcuts-body") as HTMLElement;
    for (const [title, rows] of sections) {
      const section = document.createElement("section");
      section.className = "fw-shortcuts-section";
      section.append(Object.assign(document.createElement("h3"), { textContent: title }));
      const list = document.createElement("dl");
      for (const [keys, label] of rows) {
        const row = document.createElement("div");
        row.className = "fw-shortcuts-row";
        row.dataset.find = `${keys} ${label}`.toLowerCase();
        row.append(Object.assign(document.createElement("dt"), { textContent: label }), Object.assign(document.createElement("dd"), { innerHTML: `<kbd translate="no"></kbd>` }));
        (row.querySelector("kbd") as HTMLElement).textContent = keys;
        list.append(row);
      }
      section.append(list);
      body.append(section);
    }
    const filter = dialog.querySelector<HTMLInputElement>(".fw-shortcuts-filter") as HTMLInputElement;
    const empty = dialog.querySelector<HTMLElement>(".fw-shortcuts-empty") as HTMLElement;
    filter.addEventListener("input", () => {
      const words = filter.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      let any = false;
      for (const section of body.children as HTMLCollectionOf<HTMLElement>) {
        let shown = 0;
        for (const row of section.querySelectorAll<HTMLElement>(".fw-shortcuts-row")) {
          const hit = words.every((w) => row.dataset.find?.includes(w));
          if (row.hidden === hit) row.hidden = !hit;
          if (hit) shown++;
        }
        if (section.hidden === shown > 0) section.hidden = shown === 0;
        any ||= shown > 0;
      }
      if (empty.hidden === !any) empty.hidden = any;
    });
    dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
    built = true;
  };
  host.addEventListener("fw-shortcuts", () => {
    if (!built) build();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLInputElement>(".fw-shortcuts-filter")?.focus();
  });
}
