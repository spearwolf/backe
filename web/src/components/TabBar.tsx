import { Settings, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import { m } from '../app/app.messages.ts';
import { useRouter } from '../app/router.ts';
import { type Route, routeHref } from '../app/routes.ts';
import type { TabModel } from '../app/tabs.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { cn } from '../lib/utils.ts';

type Props = {
  backlog: string;
  route: Route;
  tabs: TabModel;
  onClose: (id: string) => void;
};

const FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
// Auswahl über Umrandung und Schriftgewicht, nicht über Farbe (ui.md §2.13).
const TAB = 'flex h-9 shrink-0 items-center -mb-px rounded-t-md border border-b-0 text-sm';
const SELECTED = 'border-foreground/60 bg-background font-semibold';
const IDLE = 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground';

/** Ein Link, der im Router bleibt; Modifier und andere Tasten behalten das Browser-Verhalten. */
function useNavigate(): (href: string) => (e: MouseEvent) => void {
  const router = useRouter();
  return (href) => (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.navigate(href);
  };
}

export function TabBar({ backlog, route, tabs, onClose }: Props) {
  const ids = useSignal(tabs.issues);
  const go = useNavigate();
  const backlogHref = routeHref({ kind: 'backlog', backlog });
  const boardHref = routeHref({ kind: 'board', backlog });
  const settingsHref = routeHref({ kind: 'settings', backlog, section: undefined });
  const fixed = (href: string, label: string, selected: boolean) => (
    <a
      role="tab"
      aria-selected={selected}
      href={href}
      onClick={go(href)}
      className={cn(TAB, 'px-4', FOCUS, selected ? SELECTED : IDLE)}
    >
      {label}
    </a>
  );

  return (
    <nav className="flex items-end gap-2 border-b px-2">
      <div
        role="tablist"
        aria-label={m.views}
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden pt-1"
      >
        {fixed(backlogHref, m.tabBacklog, route.kind === 'backlog')}
        {fixed(boardHref, m.tabBoard, route.kind === 'board')}
        {ids.map((id) => (
          <IssueTab
            key={id}
            id={id}
            href={routeHref({ kind: 'issue', backlog, id })}
            selected={route.kind === 'issue' && route.id === id}
            onClose={onClose}
          />
        ))}
      </div>
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

type IssueTabProps = { id: string; href: string; selected: boolean; onClose: (id: string) => void };

/** Eigene Komponente, damit nur dieser Tab am Signal seines Issues hängt. */
function IssueTab({ id, href, selected, onClose }: IssueTabProps) {
  const store = useStore();
  const issue = useSignal(store.issues.get(id));
  const loaded = useSignal(store.loaded);
  const go = useNavigate();
  return (
    <div role="presentation" className={cn(TAB, 'max-w-72 pr-1', selected ? SELECTED : IDLE)}>
      <a
        role="tab"
        aria-selected={selected}
        href={href}
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
        className={cn('flex h-full min-w-0 items-center gap-1.5 rounded-t-md pl-3', FOCUS)}
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
            <span className="shrink-0 italic">{m.deleted}</span>
          </>
        )}
      </a>
      <button
        type="button"
        aria-label={m.closeTab(id)}
        title={m.closeTab(id)}
        onClick={() => onClose(id)}
        className={cn('ml-1 rounded-sm p-0.5 hover:bg-accent', FOCUS)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
