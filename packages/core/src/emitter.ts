type Listener<T> = (value: T) => void;

/** Tiny typed event emitter (no Node `events` dependency, works in React Native). */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners[event]?.delete(fn);
  }

  protected emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const fn of [...(this.listeners[event] ?? [])]) {
      try {
        fn(value);
      } catch (e) {
        console.error(`[open2talk] listener for "${String(event)}" threw`, e);
      }
    }
  }
}
