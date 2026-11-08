/**
 * Toasts: what the app tells the person, at the bottom centre as a hollow liquid-glass outline (the app's hue for the
 * app's own messages, the danger colour for an error), as the approved mocks show them.
 *
 * Every module already says its message on the status notice (`.fw-notice`, a live region that tests and assistive
 * technology read); this mounts the one place those messages are shown: a change to the notice's text raises a toast
 * with it, and `toast()` raises one directly. The notice keeps its text, visually hidden, so nothing that reads it
 * changes. A message that is replaced within a moment by its translation (the interface translates text in place) is
 * the same toast, not a second one. Toasts are decoration over the live region, so they are hidden from it.
 */

import { onLanguage } from "./i18n";

const SHOW_MS = 4200;
const ERROR_MS = 7000;
const MAX = 3;
const FAILURE = /\b(failed|failure|could not|couldn't|cannot|can't|unable|error|not found|refused|denied|invalid|unsupported|offline|unavailable|too large|too long|went wrong)\b/i;

export type ToastKind = "app" | "error";

let layer: HTMLElement | null = null;

const ensure = (): HTMLElement => {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.className = "fw-toasts";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  return layer;
};

/** Show a toast; `kind` defaults to the app's own, and a message that reads as a failure is shown as an error. */
export function toast(text: string, kind?: ToastKind): HTMLElement | null {
  const message = text.trim();
  if (!message) return null;
  const root = ensure();
  const as: ToastKind = kind ?? (FAILURE.test(message) ? "error" : "app");
  for (const old of root.querySelectorAll<HTMLElement>(".fw-toast")) {
    if (old.dataset.text === message) {
      old.remove();
    }
  }
  const el = document.createElement("div");
  el.className = "fw-toast";
  el.dataset.kind = as;
  el.dataset.text = message;
  el.setAttribute("translate", "no");
  root.append(el);
  while (root.children.length > MAX) root.firstElementChild?.remove();
  const done = () => {
    el.dataset.leaving = "";
    window.setTimeout(() => el.remove(), 240);
  };
  const timer = window.setTimeout(done, as === "error" ? ERROR_MS : SHOW_MS);
  el.addEventListener("click", () => {
    window.clearTimeout(timer);
    done();
  });
  return el;
}

/** Route the status notice's messages through toasts. */
export function mountToasts(host: HTMLElement): void {
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  if (!notice) return;
  let last = notice.textContent ?? "";
  let current: HTMLElement | null = null;
  let at = 0;
  let switching = false;
  // choosing a language rewrites the notice in place: that is the same message in other words, not a new one to toast
  onLanguage(() => {
    switching = true;
    queueMicrotask(() => {
      switching = false;
    });
  });
  new MutationObserver(() => {
    const text = notice.textContent ?? "";
    if (text === last) return;
    if (switching) {
      last = text;
      return;
    }
    const now = performance.now();
    const sameMoment = now - at < 120;
    last = text;
    at = now;
    if (!text.trim()) return;
    // the interface's translation of the line just written: the same toast, in the new words
    if (sameMoment && current?.isConnected) {
      current.dataset.text = text;
      return;
    }
    current = toast(text);
  }).observe(notice, { childList: true, characterData: true, subtree: true });
}
