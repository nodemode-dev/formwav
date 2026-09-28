export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 200) {}

  record(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  state(): HistoryState {
    return { canUndo: this.past.length > 0, canRedo: this.future.length > 0, undoDepth: this.past.length, redoDepth: this.future.length };
  }
}
