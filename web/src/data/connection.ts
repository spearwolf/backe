import type { HelloJson, PatchJson, StateJson } from '@backe/ui/api.ts';
import { Eventize } from '@spearwolf/eventize';
import { type Fetch, getJson } from './api-client.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'offline';

export type ConnectionEvents = {
  hello: [HelloJson];
  patch: [PatchJson];
  sync: [Record<string, unknown>];
  reset: [];
  status: [ConnectionStatus];
  /** Der Stream kam nicht zustande (Fehler vor dem ersten `open`) oder ist endgültig zu. */
  failed: [];
};

export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void;
  close(): void;
};

export type ConnectionDeps = { eventSource: (url: string) => EventSourceLike; fetch: Fetch };

const CLOSED = 2; // EventSource.CLOSED; jsdom hat die Konstante nicht

/**
 * Verbindung zu einem Backlog von `backe ui`: Event-Stream plus `GET /state`. Wiederverbinden
 * und `Last-Event-ID` erledigt der Browser; steht der Stream danach auf CLOSED (401/404/503),
 * gibt die Verbindung auf. Den Grund verrät ein `EventSource` nie, darum meldet `failed` nur,
 * dass es ihn gibt: Wer ihn wissen will, fragt `state()`.
 */
export class Connection extends Eventize<ConnectionEvents> {
  readonly backlog: string;
  #status: ConnectionStatus = 'connecting';
  #source: EventSourceLike | undefined;
  readonly #deps: Partial<ConnectionDeps>;

  constructor(backlog: string, deps: Partial<ConnectionDeps> = {}) {
    super();
    this.backlog = backlog;
    this.#deps = deps;
    this.retain('status');
    this.emit('status', this.#status);
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  open(): void {
    if (this.#source) return;
    const create = this.#deps.eventSource ?? ((url: string) => new EventSource(url));
    const es = create(`/api/b/${encodeURIComponent(this.backlog)}/events`);
    this.#source = es;
    // Nach close() oder endgültigem Abbruch ist `#source` ein anderer; alte Callbacks bleiben stumm.
    let gaveUp = false;
    let opened = false;
    const live = () => this.#source === es && !gaveUp;

    es.onopen = () => {
      if (!live()) return;
      opened = true;
      this.#setStatus('open');
    };
    es.onerror = () => {
      if (!live()) return;
      const closed = es.readyState === CLOSED;
      if (closed) {
        gaveUp = true;
        es.onopen = null;
        es.onerror = null;
        es.close();
      }
      this.#setStatus('offline');
      if (closed || !opened) this.emit('failed');
    };

    for (const type of ['hello', 'patch', 'sync', 'reset'] as const) {
      es.addEventListener(type, (e) => {
        if (!live()) return;
        this.#forward(type, e.data);
      });
    }
  }

  close(): void {
    const es = this.#source;
    if (!es) return;
    this.#source = undefined;
    es.close();
  }

  state(): Promise<StateJson> {
    return getJson<StateJson>(`/api/b/${encodeURIComponent(this.backlog)}/state`, this.#deps.fetch);
  }

  #setStatus(next: ConnectionStatus): void {
    if (next === this.#status) return;
    this.#status = next;
    this.emit('status', next);
  }

  #forward(type: 'hello' | 'patch' | 'sync' | 'reset', raw: string): void {
    if (type === 'reset') {
      this.emit('reset');
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Was wir nicht lesen können, behandeln wir als verpasste Änderung: neu laden.
      this.emit('reset');
      return;
    }
    if (type === 'hello') this.emit('hello', data as HelloJson);
    else if (type === 'patch') this.emit('patch', data as PatchJson);
    else this.emit('sync', data as Record<string, unknown>);
  }
}
