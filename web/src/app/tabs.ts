import { createSignal, type Signal, SignalGroup } from '@spearwolf/signalize';
import { readJson, writeJson } from '../lib/storage.ts';

const isIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((e) => typeof e === 'string');

/** Die offenen Issue-Tabs eines Backlogs, im `localStorage` über Neuladen hinweg erhalten. */
export class TabModel {
  readonly issues: Signal<readonly string[]>;
  /** Query des Tabs Backlog (seine Filter), damit der Rücksprung aus einem Issue sie behält. */
  readonly backlogSearch: Signal<string>;
  readonly #key: string;

  constructor(backlog: string) {
    this.#key = `backe-ui:${backlog}:tabs`;
    this.issues = createSignal<readonly string[]>(readJson(this.#key, [], isIds), {
      attach: this,
    });
    this.backlogSearch = createSignal('', { attach: this });
  }

  open(id: string): void {
    const cur = this.issues.value;
    if (cur.includes(id)) return;
    this.#set([...cur, id]);
  }

  /** Liefert den Nachbarn, der nachrückt: rechts, sonst links. */
  close(id: string): string | undefined {
    const cur = this.issues.value;
    const at = cur.indexOf(id);
    if (at < 0) return undefined;
    const next = cur.filter((t) => t !== id);
    this.#set(next);
    return next[at] ?? next[at - 1];
  }

  dispose(): void {
    SignalGroup.delete(this);
  }

  #set(next: readonly string[]): void {
    this.issues.set(next);
    writeJson(this.#key, next);
  }
}
