/**
 * The title bar's File menu (Save, Open, Import). The items are the same buttons the projects and import modules bind
 * by data-action, moved into the menu, so their handlers are untouched; this module only opens and closes it: a click
 * on File toggles it, arrow keys move between items, Escape or a click outside closes it, and choosing an item closes
 * it after the item's own handler has run (so a dialog positioned from the item still sees it in place).
 */
export function mountFileMenu(host: HTMLElement): void {
  const root = host.querySelector<HTMLElement>(".fw-menu");
  const button = root?.querySelector<HTMLButtonElement>(".fw-menu-btn");
  const pop = root?.querySelector<HTMLElement>(".fw-menu-pop");
  if (!root || !button || !pop) return;
  const items = () => [...pop.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const setOpen = (open: boolean, focusFirst = false) => {
    if (pop.hidden === !open) return;
    pop.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open && focusFirst) items()[0]?.focus();
  };
  button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true, true);
    }
  });
  pop.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest('[role="menuitem"]')) window.setTimeout(() => setOpen(false), 0);
  });
  pop.addEventListener("keydown", (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(at + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === "Escape") {
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !root.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) setOpen(false);
  });
}
