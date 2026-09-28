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
}

export type EngineEvent = keyof EngineState;
type Listener<E extends EngineEvent> = (value: EngineState[E]) => void;
type ListenerSets = { [E in EngineEvent]: Set<Listener<E>> };

export const DEFAULT_SESSION_RATE = 48000;

export class Engine {
  private state: EngineState = {
    link: { status: "pending", engineVersion: null },
    transport: { playing: false, recording: false, positionSamples: 0, sampleRate: DEFAULT_SESSION_RATE },
  };

  private listeners: ListenerSets = { link: new Set(), transport: new Set() };

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

  private update<E extends EngineEvent>(event: E, next: EngineState[E]): void {
    this.state[event] = next;
    for (const fn of this.listeners[event] as Set<Listener<E>>) fn(next);
  }
}

export function createEngine(): Engine {
  return new Engine();
}
