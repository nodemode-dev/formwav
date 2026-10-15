import type { Engine } from "../engine";
import type { SessionDoc } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * PLAN_v14 W4: work that a crash, a closed window or a lost power cut cannot take. Every 30 s, while the session has
 * changes not saved, the window hands the engine its latest state (/api/autosave); a save clears it. On the next start
 * an autosave with clips in it is offered back through the editing dialog: Recover it, Discard it, or Cancel to be asked
 * again next time.
 */
type Field = { key: string; label: string; value: string; options: [string, string][] };

export function mountAutosave(host: HTMLElement, engine: Engine): void {
  const nameField = host.querySelector<HTMLInputElement>("input.fw-session-name");
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let last: SessionDoc = engine.get("document");
  let saved: SessionDoc = last;
  let busy = false;
  const send = (method: string, body?: unknown) => fetch("/api/autosave", { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

  host.addEventListener("fw-saved", () => {
    saved = engine.get("document");
    last = saved;
    void send("DELETE").catch(() => undefined);
  });
  window.setInterval(() => {
    const doc = engine.get("document");
    if (busy || doc === last || doc === saved || !doc.tracks.length) return;
    busy = true;
    void send("PUT", { name: nameField?.value.trim() || "Untitled session", document: doc })
      .then((res) => {
        if (res.ok) last = doc;
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, 30000);

  const ask = (title: string, note: string, fields: Field[], ok: string) =>
    new Promise<Record<string, unknown> | null>((done) => host.dispatchEvent(new CustomEvent("fw-ask", { detail: { title, note, fields, ok, done } })));
  void (async () => {
    try {
      const res = await fetch("/api/autosave");
      const found = (await res.json()) as { exists: boolean; name?: string; savedAt?: number; tracks?: number; clips?: number };
      if (!found.exists || !found.clips || engine.get("document").tracks.length) return;
      const when = new Date((found.savedAt ?? 0) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const answer = await ask(
        "Recover unsaved work",
        `formwav closed with unsaved changes to "${found.name}" (${found.tracks} track${found.tracks === 1 ? "" : "s"}, ${found.clips} clip${found.clips === 1 ? "" : "s"}), kept at ${when}. Cancel asks again next time.`,
        [{ key: "what", label: "This work", value: "recover", options: [["recover", "Recover it"], ["discard", "Discard it"]] }],
        "Continue",
      );
      if (!answer) return;
      if (answer.what === "discard") {
        await send("DELETE");
        setText(notice, "Discarded the unsaved work");
        return;
      }
      const full = (await (await fetch("/api/autosave?full=1")).json()) as { name?: string; document?: SessionDoc };
      if (!full.document) return;
      engine.loadDocument(full.document);
      last = engine.get("document");
      if (nameField && full.name && nameField.value !== full.name) {
        nameField.value = full.name;
        nameField.dispatchEvent(new Event("input", { bubbles: true }));
      }
      setText(notice, `Recovered ${full.name ?? "the unsaved session"}: save it to keep it`);
    } catch {
      // nothing kept, or the engine not reachable yet: nothing to offer
    }
  })();
}
