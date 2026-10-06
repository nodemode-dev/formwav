import type { Engine } from "../engine";
import { computeRestore, type Command, type RestorePatch } from "../engine/document";
import { setText } from "../vendor/nodemode/dom-stable";

/**
 * Shared editing (routers/share.py; the comparison's Cloud projects and collaboration row). The desktop shares the
 * session it has open (File > Share this session, once Settings > Devices on this network is on and devices are paired);
 * a paired device that opens formwav joins it. Every edit goes to the engine, which numbers it; every editor, the sender
 * too, applies the commands in that order, so all hold the same session. Undo and redo are each editor's own: each of
 * their edits keeps what it changed (computeRestore), and undoing sends that back as an edit of its own, so another's
 * later edit elsewhere survives it (two editors on one track: the later one wins).
 */
type Person = { id: string; name: string; desktop: boolean; online: boolean };
type Op = { seq: number; opId: string; by: string; name: string; command: Command };

const call = async <T>(url: string, method = "GET", body?: unknown): Promise<T> => {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : `the engine answered ${res.status}`);
  return out as T;
};

export function mountShare(host: HTMLElement, engine: Engine): void {
  const notice = host.querySelector<HTMLElement>(".fw-notice");
  let sharing = false;
  let seq = 0;
  let timer = 0;
  let desktop = true;
  const kinds = new Map<string, "edit" | "undo" | "redo">();
  const undos: RestorePatch[] = [];
  const redos: RestorePatch[] = [];

  const chip = document.createElement("span");
  chip.className = "fw-share-chip";
  chip.dataset.off = "";
  chip.textContent = "Shared";
  host.querySelector(".fw-status")?.append(chip);
  const drawPeople = (people: Person[]) => {
    const here = people.filter((p) => p.online);
    setText(chip, `Shared · ${here.length} editing`);
    chip.title = here.map((p) => (p.desktop ? `${p.name} (this computer's host)` : p.name)).join(", ");
  };
  const history = () => engine.reportHistory({ canUndo: undos.length > 0, canRedo: redos.length > 0, undoDepth: undos.length, redoDepth: redos.length });

  const apply = (ops: Op[]) => {
    for (const op of ops) {
      if (op.seq <= seq) continue;
      const { before, after } = engine.applyShared(op.command, op.opId);
      seq = op.seq;
      const kind = kinds.get(op.opId);
      if (!kind) continue;
      kinds.delete(op.opId);
      if (after === before) continue;
      const back = computeRestore(before, after);
      if (kind === "undo") redos.push(back);
      else {
        undos.push(back);
        if (kind === "edit") redos.length = 0;
      }
    }
    history();
  };
  const poll = async () => {
    try {
      const d = await call<{ active: boolean; ops: Op[]; seq: number; people: Person[] }>(`/api/share/ops?after=${seq}`);
      if (!d.active) return leave(desktop ? "Sharing stopped" : "The desktop stopped sharing this session");
      apply(d.ops);
      drawPeople(d.people);
    } catch {
      /* the engine is away a moment; the next poll catches up */
    }
  };
  const send = (command: Command, kind: "edit" | "undo" | "redo") => {
    const opId = crypto.randomUUID();
    kinds.set(opId, kind);
    void call("/api/share/ops", "POST", { opId, command }).then(poll, (err) => {
      kinds.delete(opId);
      setText(notice, `That change did not reach the shared session: ${err instanceof Error ? err.message : String(err)}`);
    });
    return true;
  };
  const enter = () => {
    sharing = true;
    undos.length = 0;
    redos.length = 0;
    engine.setShareHooks({
      dispatch: (c) => send(c, "edit"),
      undo: () => {
        const p = undos.pop();
        if (!p) return false;
        history();
        return send({ type: "restore", patch: p }, "undo");
      },
      redo: () => {
        const p = redos.pop();
        if (!p) return false;
        history();
        return send({ type: "restore", patch: p }, "redo");
      },
    });
    history();
    delete chip.dataset.off;
    window.clearInterval(timer);
    timer = window.setInterval(() => void poll(), 350);
    void poll();
    item.querySelector("span")!.textContent = desktop ? "Stop sharing" : "Leave the shared session";
  };
  const leave = (why: string) => {
    sharing = false;
    engine.setShareHooks(null);
    window.clearInterval(timer);
    chip.dataset.off = "";
    engine.reportHistory({ canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 });
    item.querySelector("span")!.textContent = "Share this session";
    setText(notice, why);
  };
  const join = async () => {
    const d = await call<{ document: Parameters<Engine["loadDocument"]>[0]; ops: Op[]; seq: number }>("/api/share/join");
    engine.loadDocument(d.document);
    seq = 0;
    apply(d.ops);
    enter();
    setText(notice, "Joined the shared session: edits from everyone here appear as they are made");
  };

  // File > Share this session
  const item = document.createElement("button");
  item.className = "fw-ibtn";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.dataset.action = "share";
  item.title = "Edit this session together with paired devices on this network";
  item.innerHTML = "<span>Share this session</span>";
  host.querySelector('[data-action="cloud"]')?.after(item);
  item.addEventListener("click", async () => {
    try {
      if (sharing) {
        if (desktop) await call("/api/share/stop", "POST", {});
        return leave(desktop ? "Sharing stopped; the session is yours alone again" : "You left the shared session");
      }
      if (!desktop) return void (await join());
      const remote = await call<{ enabled: boolean; devices: unknown[] }>("/api/remote");
      if (!remote.enabled) return setText(notice, "Turn on Settings > Devices on this network and pair the devices that will edit, then share");
      await call("/api/share/start", "POST", { document: engine.get("document") });
      seq = 0;
      enter();
      setText(notice, `Sharing: ${remote.devices.length} paired device${remote.devices.length === 1 ? "" : "s"} can open formwav on this network and edit with you`);
    } catch (err) {
      setText(notice, `Could not share: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // A paired device joins the desktop's shared session when it opens formwav, or as soon as it is shared
  void call<{ active: boolean; me: { desktop: boolean } }>("/api/share").then((st) => {
    desktop = st.me.desktop;
    if (desktop) return;
    item.querySelector("span")!.textContent = "Join the shared session";
    if (st.active) return void join().catch(() => undefined);
    const wait = window.setInterval(() => {
      void call<{ active: boolean }>("/api/share").then((s) => {
        if (s.active && !sharing) {
          window.clearInterval(wait);
          void join().catch(() => undefined);
        }
      });
    }, 2000);
  }, () => undefined);
}
