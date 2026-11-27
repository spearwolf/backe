import { Settings, TriangleAlert, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { m } from '../app/app.messages.ts';
import { issueProblem } from '../app/issue-problem.ts';
import { useLinkClick, useRouter } from '../app/router.ts';
import { type Route, routeHref } from '../app/routes.ts';
import type { TabModel } from '../app/tabs.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { cn } from '../lib/utils.ts';
import { SearchBox } from './SearchBox.tsx';

type Props = {
  backlog: string;
  route: Route;
  tabs: TabModel;
  onClose: (id: string) => void;
};

/** Die eine Fläche, die alle Tabs steuern; ihren Inhalt wählt die Route. */
export const PANEL_ID = 'backe-tabpanel';

const tabId = (key: string) => `backe-tab-${key}`;

/** ID des gewählten Tabs, `undefined` ohne gewählten Tab (Settings). */
export function selectedTabId(route: Route): string | undefined {
  if (route.kind === 'backlog' || route.kind === 'board') return tabId(route.kind);
  if (route.kind === 'issue') return tabId(`issue-${route.id}`);
  return undefined;
}

const FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring';
// Die Leiste scrollt und schneidet ab, was über ihren Rand ragt; der Ring der Tabs liegt innen.
const TAB_FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
// Auswahl über Umrandung und Schriftgewicht, nicht über Farbe (ui.md §2.13).
const TAB = 'flex h-9 shrink-0 items-center -mb-px rounded-t-md border border-b-0 text-sm';
const SELECTED = 'border-foreground/60 bg-background font-semibold';
const IDLE = 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground';

export function TabBar({ backlog, route, tabs, onClose }: Props) {
  const ids = useSignal(tabs.issues);
  const router = useRouter();
  const go = useLinkClick();
  const backlogHref = routeHref({ kind: 'backlog', backlog }) + useSignal(tabs.backlogSearch);
  const boardHref = routeHref({ kind: 'board', backlog });
  const settingsHref = routeHref({ kind: 'settings', backlog, section: undefined });
  // In der Tab-Folge steht der gewählte Tab; ohne ihn (Settings, Issue-Tab noch nicht offen) Backlog.
  let focusable = 'backlog';
  if (route.kind === 'board') focusable = 'board';
  else if (route.kind === 'issue' && ids.includes(route.id)) focusable = `issue-${route.id}`;

  const fixed = (kind: 'backlog' | 'board', href: string, label: string) => (
    <a
      role="tab"
      id={tabId(kind)}
      href={href}
      aria-selected={route.kind === kind}
      aria-controls={PANEL_ID}
      tabIndex={focusable === kind ? 0 : -1}
      onClick={go(href)}
      className={cn(TAB, 'px-4', TAB_FOCUS, route.kind === kind ? SELECTED : IDLE)}
    >
      {label}
    </a>
  );

  // Tastatur nach dem Tabs-Muster von WAI-ARIA mit manueller Aktivierung: Pfeile, Home und End
  // bewegen den Fokus, Enter (nativ am Link) und Leertaste öffnen, Entf schließt einen Issue-Tab.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Alt+← ist »Zurück« des Browsers, Strg/Cmd+Rücktaste gehört dem System; beides bleibt dort.
    // Umschalt lasse ich durch: es verändert die Pfeile und Home/End hier nicht.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const list = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = list.indexOf(e.target as HTMLElement);
    const tab = list[at];
    if (tab === undefined) return;
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowRight':
        focus(at + 1);
        break;
      case 'ArrowLeft':
        focus(at - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(list.length - 1);
        break;
      case ' ':
        // Jeder Tab ist ein Link mit `href`; die Leertaste klickt Links nicht von selbst.
        router.navigate(tab.getAttribute('href') as string);
        break;
      case 'Delete':
      case 'Backspace': {
        const id = tab.dataset.issue;
        if (id === undefined) return;
        // Wie `TabModel.close`: rechts rückt nach, sonst links, sonst Backlog. Der Fokus wandert
        // vor dem Schließen, denn mit dem Tab verschwände er im Nichts.
        const pos = ids.indexOf(id);
        const next = ids[pos + 1] ?? ids[pos - 1];
        (list.find((t) => next !== undefined && t.dataset.issue === next) ?? list[0])?.focus();
        onClose(id);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <nav className="flex items-end gap-2 border-b px-2">
      <div
        role="tablist"
        aria-label={m.views}
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden pt-1"
      >
        {fixed('backlog', backlogHref, m.tabBacklog)}
        {fixed('board', boardHref, m.tabBoard)}
        {ids.map((id) => (
          <IssueTab
            key={id}
            id={id}
            href={routeHref({ kind: 'issue', backlog, id })}
            selected={route.kind === 'issue' && route.id === id}
            focusable={focusable === `issue-${id}`}
            onClose={onClose}
          />
        ))}
      </div>
      <SearchBox backlog={backlog} />
      <a
        href={settingsHref}
        onClick={go(settingsHref)}
        aria-label={m.settings}
        title={m.settings}
        aria-current={route.kind === 'settings' ? 'page' : undefined}
        className={cn(
          'mb-1 flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent',
          FOCUS,
          route.kind === 'settings' && 'border border-foreground/60',
        )}
      >
        <Settings className="size-4" aria-hidden="true" />
      </a>
    </nav>
  );
}

type IssueTabProps = {
  id: string;
  href: string;
  selected: boolean;
  focusable: boolean;
  onClose: (id: string) => void;
};

/** Eigene Komponente, damit nur dieser Tab am Signal seines Issues hängt. */
function IssueTab({ id, href, selected, focusable, onClose }: IssueTabProps) {
  const store = useStore();
  const issue = useSignal(store.issues.get(id));
  const loaded = useSignal(store.loaded);
  const problems = useSignal(store.problems);
  const broken = issueProblem(problems, id) !== undefined;
  const go = useLinkClick();
  return (
    <div role="presentation" className={cn(TAB, 'max-w-72 pr-1', selected ? SELECTED : IDLE)}>
      <a
        role="tab"
        id={tabId(`issue-${id}`)}
        href={href}
        aria-selected={selected}
        aria-controls={PANEL_ID}
        // Roving Tabindex: Nur der gewählte Tab steht in der Tab-Folge.
        tabIndex={focusable ? 0 : -1}
        data-issue={id}
        aria-keyshortcuts="Delete Backspace"
        onClick={go(href)}
        // Mittelklick schließt (ui.md §2.6); `mousedown` verhindert das Autoscrollen.
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          onClose(id);
        }}
        className={cn('flex h-full min-w-0 items-center gap-1.5 rounded-t-md pl-3', TAB_FOCUS)}
      >
        <span className="shrink-0 font-mono text-xs whitespace-nowrap">{id}</span>
        {issue !== undefined && (
          <>
            {' '}
            <span className="truncate">{issue.title}</span>
          </>
        )}
        {loaded && issue === undefined && (
          <>
            {' '}
            {broken ? (
              <span className="inline-flex shrink-0 items-center gap-1 italic">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                {m.broken}
              </span>
            ) : (
              <span className="shrink-0 italic">{m.deleted}</span>
            )}
          </>
        )}
      </a>
      {/* Nur für die Maus: In der Tab-Liste stehen allein Tabs, die Tastatur schließt mit Entf. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        title={m.closeTab(id)}
        onClick={() => onClose(id)}
        className="ml-1 rounded-sm p-0.5 hover:bg-accent"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
