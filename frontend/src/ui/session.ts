import type { Player } from "../audio/player";
import type { Engine, HistoryState } from "../engine";
import { mountImport } from "./import";
import { mountLanes } from "./lanes";
import { mountResampleRepair } from "./resample";
import { bindShortcuts } from "./shortcuts";

export function mountSession(host: HTMLElement, engine: Engine, player: Player): void {
  mountLanes(host, engine);
  mountImport(host, engine, player);
  mountResampleRepair(host, engine);
  const undo = host.querySelector<HTMLButtonElement>('[data-action="undo"]');
  const redo = host.querySelector<HTMLButtonElement>('[data-action="redo"]');
  undo?.addEventListener("click", () => engine.undo());
  redo?.addEventListener("click", () => engine.redo());
  const renderHistory = (h: HistoryState) => {
    if (undo && undo.disabled !== !h.canUndo) undo.disabled = !h.canUndo;
    if (redo && redo.disabled !== !h.canRedo) redo.disabled = !h.canRedo;
  };
  engine.subscribe("history", renderHistory);
  renderHistory(engine.get("history"));
  bindShortcuts(engine);
}
