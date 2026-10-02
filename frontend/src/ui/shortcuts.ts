import type { Engine } from "../engine";

export function bindShortcuts(engine: Engine): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    // only text entry owns these keys (its own undo); a focused slider, knob, checkbox or button has none, and skipping
    // them left Ctrl+Z dead after every slider drag until focus moved
    const textEntry = target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName) || (target instanceof HTMLInputElement && !/^(range|checkbox|radio|button|color|file)$/.test(target.type)));
    if (textEntry) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      engine.undo();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      engine.redo();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
