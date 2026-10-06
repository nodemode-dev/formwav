import { applyCommand, emptyDocument, followClips, type Command, type Selection, type SessionDoc, type SessionView } from "./document";
import { History, type HistoryState } from "./history";

export type { Clip, Command, FrequencyBand, MediaRef, Marker, Selection, SessionDoc, Track } from "./document";
export type { HistoryState } from "./history";

export type LinkStatus = "pending" | "ready" | "offline";

export interface LinkState {
  status: LinkStatus;
  engineVersion: string | null;
}

export interface TransportState {
  playing: boolean;
  recording: boolean;
  positionSamples: number;
  sampleRate: number;
}

export interface EngineState {
  link: LinkState;
  transport: TransportState;
  document: SessionDoc;
  history: HistoryState;
  selection: Selection | null;
  /** AU-34: the view of the session last opened, for the lanes to apply (zoom and scroll); set only by loadDocument. */
  view: SessionView | null;
}

export type EngineEvent = keyof EngineState;
type Listener<E extends EngineEvent> = (value: EngineState[E]) => void;
type ListenerSets = { [E in EngineEvent]: Set<Listener<E>> };

export const DEFAULT_SESSION_RATE = 48000;
export const HISTORY_LIMIT = 200;

export class Engine {
  private state: EngineState = {
    link: { status: "pending", engineVersion: null },
    transport: { playing: false, recording: false, positionSamples: 0, sampleRate: DEFAULT_SESSION_RATE },
    document: emptyDocument(DEFAULT_SESSION_RATE),
    history: { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 },
    selection: null,
    view: null,
  };

  private listeners: ListenerSets = {
    link: new Set(),
    transport: new Set(),
    document: new Set(),
    history: new Set(),
    selection: new Set(),
    view: new Set(),
  };

  private readonly past = new History<SessionDoc>(HISTORY_LIMIT);

  get<E extends EngineEvent>(event: E): EngineState[E] {
    return this.state[event];
  }

  subscribe<E extends EngineEvent>(event: E, fn: Listener<E>): () => void {
    const set = this.listeners[event] as Set<Listener<E>>;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  setLink(link: LinkState): void {
    this.update("link", link);
  }

  /** Shared editing (ui/share.ts): while a session is shared, dispatch, undo and redo go to the share instead. */
  private shareHooks: { dispatch: (c: Command) => boolean; undo: () => boolean; redo: () => boolean } | null = null;

  setShareHooks(hooks: { dispatch: (c: Command) => boolean; undo: () => boolean; redo: () => boolean } | null): void {
    this.shareHooks = hooks;
  }

  /** While shared, the Edit menu follows the share's own undo (each editor's own edits), not the local history. */
  reportHistory(state: HistoryState): void {
    this.update("history", state);
  }

  /** A shared command at its number: applied with ids seeded by its op id (every editor makes the same ones), kept out of
   *  the local undo history (shared undo is each editor's own, by ui/share.ts). Returns the documents before and after. */
  applyShared(command: Command, opId: string): { before: SessionDoc; after: SessionDoc } {
    const before = this.state.document;
    let n = 0;
    const after = followClips(before, applyCommand(before, command, () => `${opId}-${n++}`));
    if (after !== before) this.commit(after);
    return { before, after };
  }

  dispatch(command: Command): boolean {
    if (this.shareHooks) return this.shareHooks.dispatch(command);
    return this.dispatchLocal(command);
  }

  dispatchLocal(command: Command): boolean {
    const current = this.state.document;
    const next = followClips(current, applyCommand(current, command, () => crypto.randomUUID()));
    if (next === current) return false;
    this.past.record(current);
    this.commit(next);
    return true;
  }

  undo(): boolean {
    if (this.shareHooks) return this.shareHooks.undo();
    const previous = this.past.undo(this.state.document);
    if (previous === null) return false;
    this.commit(previous);
    return true;
  }

  redo(): boolean {
    if (this.shareHooks) return this.shareHooks.redo();
    const next = this.past.redo(this.state.document);
    if (next === null) return false;
    this.commit(next);
    return true;
  }

  setSelection(selection: Selection | null): void {
    this.update("selection", selection);
  }

  setTransport(patch: Partial<TransportState>): void {
    const current = this.state.transport;
    const next = { ...current, ...patch };
    const changed = (Object.keys(patch) as (keyof TransportState)[]).some((k) => next[k] !== current[k]);
    if (changed) this.update("transport", next);
  }

  loadDocument(doc: SessionDoc): void {
    this.past.clear();
    this.update("document", doc);
    this.update("history", this.past.state());
    this.setTransport({ playing: false, recording: false, positionSamples: 0, sampleRate: doc.sampleRate });
    // AU-34: the session's saved view: its time selection (a previous session's would point at tracks no longer
    // there, so none clears it), and the zoom and scroll for the lanes, which follow the view slot
    const sel = doc.view?.selection;
    this.setSelection(sel && sel.end > sel.start ? { start: sel.start, end: sel.end, trackIds: [], band: null } : null);
    this.update("view", doc.view ?? null);
  }

  private commit(doc: SessionDoc): void {
    this.update("document", doc);
    this.update("history", this.past.state());
    if (this.state.transport.sampleRate !== doc.sampleRate) {
      this.update("transport", { ...this.state.transport, sampleRate: doc.sampleRate });
    }
  }

  private update<E extends EngineEvent>(event: E, next: EngineState[E]): void {
    this.state[event] = next;
    for (const fn of this.listeners[event] as Set<Listener<E>>) fn(next);
  }
}

export function createEngine(): Engine {
  return new Engine();
}
