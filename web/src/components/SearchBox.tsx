import { createSignal } from '@spearwolf/signalize';
import { Search } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from '../app/router.ts';
import { type SearchGroup, type SearchHit, type SearchIndex, searchStore } from '../app/search.ts';
import { createSearchIndex } from '../app/search-index.ts';
import { asApiError } from '../data/api-client.ts';
import { searchIds } from '../data/search.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useOwned } from '../lib/use-owned.ts';
import { cn } from '../lib/utils.ts';
import { m } from '../views/search.messages.ts';
import { bodyGroupOf, GROUP_LABEL, HitRow, hitKey, hrefOf, ROW } from './search/hits.tsx';
import { isMac, isSearchKey } from './search/keys.ts';

type BodyState =
  | { status: 'idle' }
  | { status: 'loading' }
  /** Nur die IDs des Servers; Titel und State löst jede Darstellung frisch aus dem Store auf. */
  | { status: 'done'; ids: string[] }
  | { status: 'error'; message: string };

/** Eine wählbare Zeile: ein Treffer oder die Aufforderung, in den Beschreibungen zu suchen. */
type Choice = { key: string; hit: SearchHit } | { key: 'bodies' };

/** Leerer Index, solange das Feld ruht; ein Signal, das sich nie ändert. */
const NO_INDEX = createSignal<SearchIndex>({
  issues: [],
  projects: [],
  sprints: [],
  repos: [],
  users: [],
});

/**
 * Das Suchfeld der Tab-Leiste (ui.md §2.11) als WAI-ARIA-Combobox mit Listbox: Treffer aus dem
 * Clientzustand sofort, die Suche in den Beschreibungen auf ausdrückliche Wahl über den Server.
 * Das Feld braucht kein Schreibrecht und kein `WriteContext`.
 */
export function SearchBox({ backlog }: { backlog: string }) {
  const store = useStore();
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [body, setBody] = useState<BodyState>({ status: 'idle' });
  // Jede neue Eingabe und jede neue Beschreibungssuche zählt hoch; eine ältere Antwort fällt weg.
  const serial = useRef(0);

  const config = useSignal(store.config);
  const prefix = config?.id_prefix;
  const shown = open && query.trim() !== '';
  // Der Index (und jede Neuberechnung bei Patches) lebt nur, solange das Feld in Gebrauch ist.
  const create = useCallback(() => createSearchIndex(store), [store]);
  const owned = useOwned(open || query !== '' ? 'active' : undefined, create);
  const index = useSignal(owned?.index ?? NO_INDEX);

  const groups = useMemo(() => searchStore(index, query, prefix), [index, query, prefix]);
  const bodyGroup = useMemo(
    () => (body.status === 'done' ? bodyGroupOf(body.ids, index) : undefined),
    [body, index],
  );

  const choices = useMemo((): Choice[] => {
    const out: Choice[] = [];
    for (const g of groups) for (const hit of g.hits) out.push({ key: hitKey(hit), hit });
    if (body.status === 'done') {
      for (const hit of bodyGroup?.hits ?? []) out.push({ key: `body:${hitKey(hit)}`, hit });
    } else if (body.status !== 'loading') out.push({ key: 'bodies' });
    return out;
  }, [groups, body.status, bodyGroup]);

  const activeIndex = Math.min(active, Math.max(0, choices.length - 1));
  const activeChoice = choices[activeIndex];
  const optionId = (key: string) => `${id}-opt-${key}`;
  const listed = shown && choices.length > 0;

  // aria-activedescendant bewegt keinen Bildlauf: Die aktive Zeile muss selbst ins Sichtfeld.
  const activeKey = shown ? activeChoice?.key : undefined;
  useEffect(() => {
    if (activeKey === undefined) return;
    document.getElementById(`${id}-opt-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, activeKey]);

  const searchBodies = () => {
    const mine = ++serial.current;
    setBody({ status: 'loading' });
    setActive(0);
    searchIds(backlog, query.trim()).then(
      (ids) => {
        if (serial.current === mine) setBody({ status: 'done', ids });
      },
      (cause: unknown) => {
        if (serial.current === mine)
          setBody({ status: 'error', message: asApiError(cause).message });
      },
    );
  };

  const reset = () => {
    serial.current++;
    setQuery('');
    setBody({ status: 'idle' });
  };

  const choose = (choice: Choice | undefined) => {
    if (choice === undefined) return;
    if (!('hit' in choice)) {
      searchBodies();
      return;
    }
    router.navigate(hrefOf(choice.hit, backlog));
    reset();
    setOpen(false);
    input.current?.focus();
  };

  // ⌘K / Strg+K von überall (ui.md §2.6): Feld fokussieren und den Text markieren.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isSearchKey(e)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const count = choices.length;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (query.trim() === '') return;
        e.preventDefault();
        if (!shown) setOpen(true);
        else if (count > 0)
          setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
        return;
      }
      case 'Enter':
        if (!shown) return;
        e.preventDefault();
        choose(activeChoice);
        return;
      case 'Escape':
        if (shown) setOpen(false);
        else if (query !== '') reset();
        else return;
        e.preventDefault();
        return;
    }
  };

  let n = 0;
  const option = (choice: Choice, children: ReactNode) => {
    const at = n++;
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: Die Tastatur läuft über das Feld (aria-activedescendant).
      <div
        key={choice.key}
        id={optionId(choice.key)}
        role="option"
        aria-selected={at === activeIndex}
        tabIndex={-1}
        onClick={() => choose(choice)}
        onMouseMove={() => setActive(at)}
        className={cn(ROW, 'cursor-pointer', at === activeIndex && 'bg-accent')}
      >
        {children}
      </div>
    );
  };
  const groupOf = (key: string, label: string, g: SearchGroup, prefixKey: string) => {
    const headId = `${id}-grp-${key}`;
    return (
      // biome-ignore lint/a11y/useSemanticElements: In einer Listbox gehört role="group" hin, kein fieldset.
      <div key={key} role="group" aria-labelledby={headId}>
        <div id={headId} className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
          {label}
        </div>
        {g.hits.map((hit) =>
          option({ key: `${prefixKey}${hitKey(hit)}`, hit }, <HitRow hit={hit} />),
        )}
        {g.more > 0 && (
          <div role="presentation" className={cn(ROW, 'text-muted-foreground')}>
            {m.more(g.more)}
          </div>
        )}
      </div>
    );
  };

  let status = '';
  if (body.status === 'loading') status = m.searching;
  else if (body.status === 'error') status = `${m.bodyFailed}: ${body.message}`;
  else if (body.status === 'done' && bodyGroup === undefined) status = m.noBodyHits;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Der Blur-Handler sammelt nur den Fokusverlust der Kinder ein.
    <div
      ref={root}
      className="relative mb-1 shrink-0"
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={m.label}
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-activedescendant={listed && activeChoice ? optionId(activeChoice.key) : undefined}
          aria-autocomplete="list"
          aria-keyshortcuts="Meta+K Control+K"
          autoComplete="off"
          spellCheck={false}
          placeholder={`${m.placeholder} ${m.shortcut(isMac())}`}
          value={query}
          onChange={(e) => {
            serial.current++;
            setQuery(e.target.value);
            setBody({ status: 'idle' });
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-8 w-40 rounded-md border border-input bg-transparent pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring sm:w-56"
        />
      </div>
      {/* Immer eingehängt, damit die Statuszeile als Live-Region ihre Änderungen ansagt. Ist die
          Liste zu, ist der Rahmen nur unsichtbar (`sr-only`), nicht `hidden`: Ein Ergebnis der
          Beschreibungssuche, das nach Escape eintrifft, wird so noch angesagt. Ein Druck auf
          Überschrift, Restzeile oder Bildlaufleiste darf den Fokus nicht aus dem Feld holen. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Nur der Fokus des Feldes wird gehalten. */}
      <div
        onMouseDown={(e) => e.preventDefault()}
        className={
          shown
            ? 'absolute right-0 z-50 mt-1 max-h-[70vh] w-[28rem] max-w-[calc(100vw-1rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
            : 'sr-only'
        }
      >
        {listed && (
          <div
            id={listId}
            role="listbox"
            aria-label={m.label}
            aria-busy={body.status === 'loading'}
          >
            {groups.map((g) => groupOf(g.kind, GROUP_LABEL[g.kind](), g, ''))}
            {bodyGroup !== undefined && groupOf('bodies', m.groupBodies, bodyGroup, 'body:')}
            {body.status !== 'loading' &&
              body.status !== 'done' &&
              option({ key: 'bodies' }, <span className="truncate">{m.searchBodies}</span>)}
          </div>
        )}
        <div role="status" className={cn(status !== '' && cn(ROW, 'text-muted-foreground'))}>
          {status}
        </div>
      </div>
    </div>
  );
}
