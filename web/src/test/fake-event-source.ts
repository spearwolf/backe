import type { EventSourceLike } from '../data/connection.ts';

type Listener = (e: MessageEvent<string>) => void;

/** Spielt die Teile des Browser-`EventSource` nach, die `Connection` anfasst. */
export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  /** `closed` = der Browser gibt auf (CLOSED), sonst verbindet er selbst neu (CONNECTING). */
  emitError(closed = false): void {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event('error'));
  }

  /** Nicht-Strings werden als JSON serialisiert; Strings gehen unverändert durch (kaputte Daten). */
  emitEvent(type: string, data: unknown | string): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const fn of this.listeners.get(type) ?? []) {
      fn(new MessageEvent(type, { data: payload }));
    }
  }
}

export function fakeEventSources(): {
  create: (url: string) => FakeEventSource;
  last: () => FakeEventSource | undefined;
  all: FakeEventSource[];
} {
  const all: FakeEventSource[] = [];
  return {
    create: (url) => {
      const es = new FakeEventSource(url);
      all.push(es);
      return es;
    },
    last: () => all.at(-1),
    all,
  };
}
