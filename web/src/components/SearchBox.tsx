import { isSettled } from '@backe/core/state.ts';
import { Search } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EMPTY_FILTER, type ListFilter, listFilterSearch } from '../app/list-filter.ts';
import { useRouter } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import {
  SEARCH_LIMIT,
  type SearchGroup,
  type SearchHit,
  searchIndexOf,
  searchStore,
} from '../app/search.ts';
import { asApiError } from '../data/api-client.ts';
import { searchIds } from '../data/search.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { cn } from '../lib/utils.ts';
import { m } from '../views/search.messages.ts';
import { StateIcon } from './StateIcon.tsx';

const TYPING_GUARD = '[role="dialog"], [role="alertdialog"], [role="menu"]';

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Genau einer von Meta/Ctrl, ohne Alt und Umschalt; unter einem offenen Dialog oder Menü nie. */
function isSearchKey(e: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey || e.metaKey === e.ctrlKey)
    return false;
  return document.querySelector(TYPING_GUARD) === null;
}

type BodyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; group: SearchGroup | undefined }
  | { status: 'error'; message: string };

/** Eine wählbare Zeile: ein Treffer oder die Aufforderung, in den Beschreibungen zu suchen. */
type Choice = { key: string; hit: SearchHit } | { key: 'bodies' };

const GROUP_LABEL = {
  issue: () => m.groupIssues,
  project: () => m.groupProjects,
  sprint: () => m.groupSprints,
  repo: () => m.groupRepos,
  user: () => m.groupUsers,
} as const;

function hitKey(hit: SearchHit): string {
  switch (hit.kind) {
    case 'issue':
      return `issue:${hit.issue.id}`;
    case 'project':
      return `project:${hit.project.path}`;
    case 'sprint':
      return `sprint:${hit.sprint.slug}`;
    case 'repo':
      return `repo:${hit.repo.name}`;
    case 'user':
      return `user:${hit.user.handle}`;
  }
}

/** Ziel einer Auswahl: Issue-Tab oder Backlog mit dem passenden Filter. */
function hrefOf(hit: SearchHit, backlog: string): string {
  if (hit.kind === 'issue') return routeHref({ kind: 'issue', backlog, id: hit.issue.id });
  const filter: ListFilter = (() => {
    switch (hit.kind) {
      case 'project':
        return { ...EMPTY_FILTER, projects: [hit.project.path] };
      case 'sprint':
        return { ...EMPTY_FILTER, sprints: [hit.sprint.slug] };
      case 'repo':
        return { ...EMPTY_FILTER, repos: [hit.repo.name] };
      case 'user':
        return { ...EMPTY_FILTER, assignee: hit.user.handle };
    }
  })();
  return routeHref({ kind: 'backlog', backlog }) + listFilterSearch(filter);
}

const ROW = 'flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-sm';

function HitRow({ hit }: { hit: SearchHit }) {
  switch (hit.kind) {
    case 'issue':
      return (
        <>
          <StateIcon state={hit.issue.state} className="shrink-0" />
          <span className="shrink-0 font-mono text-xs whitespace-nowrap">{hit.issue.id}</span>
          <span className="truncate">{hit.issue.title}</span>
          {hit.exact && <span className="shrink-0 text-xs text-muted-foreground">{m.exact}</span>}
          {isSettled(hit.issue.state) && (
            <span className="shrink-0 text-xs text-muted-foreground">{m.closed}</span>
          )}
        </>
      );
    case 'project':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.project.path}</span>
          <span className="truncate">{hit.project.title}</span>
        </>
      );
    case 'sprint':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.sprint.slug}</span>
          <span className="truncate">{hit.sprint.title}</span>
        </>
      );
    case 'repo':
      return <span className="truncate font-mono text-xs">{hit.repo.name}</span>;
    case 'user':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.user.handle}</span>
          <span className="truncate">{hit.user.name}</span>
          {hit.user.kind === 'agent' && (
            <span className="shrink-0 text-xs text-muted-foreground">{m.agent}</span>
          )}
        </>
      );
  }
}

/**
 * Das Suchfeld der Tab-Leiste (ui.md §2.11) als WAI-ARIA-Combobox mit Listbox: Treffer aus dem
 * Clientzustand sofort, die Suche in den Beschreibungen auf ausdrückliche Wahl über den Server.
 * Das Feld braucht kein Schreibrecht und kein `WriteContext`.
 */
export function SearchBox({ backlog }: { backlog: string }) {
  const store = useStore();
  const router = useRouter();
  const index = useSignal(searchIndexOf(store));
  const config = useSignal(store.config);
  const prefix = config?.id_prefix;
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

  const groups = useMemo(() => searchStore(index, query, prefix), [index, query, prefix]);

  const choices = useMemo((): Choice[] => {
    const out: Choice[] = [];
    for (const g of groups) for (const hit of g.hits) out.push({ key: hitKey(hit), hit });
    if (body.status === 'done') {
      for (const hit of body.group?.hits ?? []) out.push({ key: `body:${hitKey(hit)}`, hit });
    } else if (body.status !== 'loading') out.push({ key: 'bodies' });
    return out;
  }, [groups, body]);

  const shown = open && query.trim() !== '';
  const activeIndex = Math.min(active, Math.max(0, choices.length - 1));
  const optionId = (key: string) => `${id}-opt-${key}`;

  const bodyGroup = useCallback(
    (ids: string[]): SearchGroup | undefined => {
      const byId = new Map(index.issues.map((e) => [e.item.id, e.item]));
      const hits: SearchHit[] = [];
      for (const issueId of ids) {
        const issue = byId.get(issueId);
        if (issue !== undefined) hits.push({ kind: 'issue', issue, exact: false });
      }
      if (hits.length === 0) return undefined;
      return {
        kind: 'issue',
        hits: hits.slice(0, SEARCH_LIMIT),
        more: Math.max(0, hits.length - SEARCH_LIMIT),
      };
    },
    [index],
  );

  const searchBodies = () => {
    const mine = ++serial.current;
    setBody({ status: 'loading' });
    searchIds(backlog, query).then(
      (ids) => {
        if (serial.current === mine) setBody({ status: 'done', group: bodyGroup(ids) });
      },
      (cause: unknown) => {
        if (serial.current === mine)
          setBody({ status: 'error', message: asApiError(cause).message });
      },
    );
  };

  const choose = (choice: Choice | undefined) => {
    if (choice === undefined) return;
    if (!('hit' in choice)) {
      searchBodies();
      return;
    }
    router.navigate(hrefOf(choice.hit, backlog));
    serial.current++;
    setQuery('');
    setBody({ status: 'idle' });
    setOpen(false);
    input.current?.focus();
  };

  // ⌘K / Strg+K von überall (ui.md §2.6): Feld fokussieren und den Text markieren.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!isSearchKey(e)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const count = choices.length;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (query.trim() === '') return;
        e.preventDefault();
        if (!shown) {
          setOpen(true);
          return;
        }
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + count) % count);
        return;
      }
      case 'Enter':
        if (!shown) return;
        e.preventDefault();
        choose(choices[activeIndex]);
        return;
      case 'Escape':
        if (shown) setOpen(false);
        else if (query !== '') {
          serial.current++;
          setQuery('');
          setBody({ status: 'idle' });
        } else return;
        e.preventDefault();
        return;
    }
  };

  const mac = isMac();
  const activeChoice = choices[activeIndex];

  let rows: ReactNode = null;
  if (shown) {
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
          // Der Fokus bleibt im Feld; ohne das schlösse der Blur die Liste vor dem Klick.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(choice)}
          onMouseMove={() => setActive(at)}
          className={cn(ROW, 'cursor-pointer', at === activeIndex && 'bg-accent')}
        >
          {children}
        </div>
      );
    };
    const groupOf = (
      key: string,
      label: string,
      list: SearchHit[],
      more: number,
      prefixKey: string,
    ) => {
      const headId = `${id}-grp-${key}`;
      return (
        // biome-ignore lint/a11y/useSemanticElements: In einer Listbox gehört role="group" hin, kein fieldset.
        <div key={key} role="group" aria-labelledby={headId}>
          <div id={headId} className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
            {label}
          </div>
          {list.map((hit) =>
            option({ key: `${prefixKey}${hitKey(hit)}`, hit }, <HitRow hit={hit} />),
          )}
          {more > 0 && <div className={cn(ROW, 'text-muted-foreground')}>{m.more(more)}</div>}
        </div>
      );
    };
    const note = (text: ReactNode) => (
      <div className={cn(ROW, 'text-muted-foreground')} role="status">
        {text}
      </div>
    );
    rows = (
      <>
        {groups.map((g) => groupOf(g.kind, GROUP_LABEL[g.kind](), g.hits, g.more, ''))}
        {body.status === 'done' &&
          (body.group === undefined
            ? note(m.noBodyHits)
            : groupOf('bodies', m.groupBodies, body.group.hits, body.group.more, 'body:'))}
        {body.status === 'loading' && note(m.searching)}
        {body.status === 'error' && note(`${m.bodyFailed}: ${body.message}`)}
        {body.status !== 'loading' &&
          body.status !== 'done' &&
          option({ key: 'bodies' }, <span className="truncate">{m.searchBodies}</span>)}
      </>
    );
  }

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
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && activeChoice ? optionId(activeChoice.key) : undefined}
          aria-autocomplete="list"
          aria-keyshortcuts="Meta+K Control+K"
          autoComplete="off"
          spellCheck={false}
          placeholder={`${m.placeholder} ${m.shortcut(mac)}`}
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
      {shown && (
        <div
          id={listId}
          role="listbox"
          aria-label={m.label}
          className="absolute right-0 z-50 mt-1 max-h-[70vh] w-[28rem] max-w-[calc(100vw-1rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {rows}
        </div>
      )}
    </div>
  );
}
