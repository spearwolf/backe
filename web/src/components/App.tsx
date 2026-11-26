import type { BacklogEntryJson } from '@backe/ui/api.ts';
import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import { m } from '../app/app.messages.ts';
import { type Router, RouterContext } from '../app/router.ts';
import { canonicalPath, type Route, routeHref } from '../app/routes.ts';
import { TabModel } from '../app/tabs.ts';
import type { Theme } from '../app/theme.ts';
import type { ConnectionDeps } from '../data/connection.ts';
import { openSession, type Session } from '../data/session.ts';
import { StoreContext } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { type WriteAccess, WriteContext } from '../data/write-context.tsx';
import { useOwned } from '../lib/use-owned.ts';
import { BacklogView } from '../views/BacklogView.tsx';
import { BoardView } from '../views/BoardView.tsx';
import { IssueView } from '../views/IssueView.tsx';
import { SettingsView } from '../views/SettingsView.tsx';
import { ErrorAlert } from './ErrorPage.tsx';
import { Header } from './Header.tsx';
import { PANEL_ID, selectedTabId, TabBar } from './TabBar.tsx';
import { WriteFailures } from './write/WriteFailures.tsx';

type Props = {
  backlogs: readonly BacklogEntryJson[];
  router: Router;
  theme: Theme;
  deps: Partial<ConnectionDeps>;
};

const createTabs = (backlog: string) => new TabModel(backlog);

function backlogOf(route: Route): string | undefined {
  return route.kind === 'home' || route.kind === 'not-found' ? undefined : route.backlog;
}

function View({
  route,
  me,
  onClose,
}: {
  route: Route;
  me: string | null;
  onClose: (id: string) => void;
}) {
  switch (route.kind) {
    case 'board':
      return <BoardView />;
    case 'issue':
      return <IssueView backlog={route.backlog} id={route.id} onClose={onClose} />;
    case 'settings':
      return <SettingsView />;
    case 'backlog':
      return <BacklogView backlog={route.backlog} me={me} />;
    default:
      return null;
  }
}

/**
 * Die Fläche unter den Tabs. Scheitert das Laden, steht dort der Fehler statt der Ansicht: Ohne
 * Arbeitskopie kommt nie ein Zustand, »Lädt …« bliebe für immer stehen.
 */
function Panel(props: {
  session: Session;
  route: Route;
  me: string | null;
  onClose: (id: string) => void;
}) {
  const { session, route, me, onClose } = props;
  const error = useSignal(session.error);
  const labelledBy = selectedTabId(route);
  // Eine eigene Fläche statt `role` am `<main>`: `main` darf seine Rolle nicht tauschen.
  return (
    <div
      id={PANEL_ID}
      // Volle Höhe von `<main>`: Der Tab Backlog scrollt seine Liste selbst, sonst sähe der
      // Virtualizer die ganze Liste als sichtbar.
      className="h-full"
      {...(labelledBy === undefined ? {} : { role: 'tabpanel', 'aria-labelledby': labelledBy })}
    >
      {error === undefined ? (
        <View route={route} me={me} onClose={onClose} />
      ) : (
        <div className="max-w-xl p-4">
          <ErrorAlert
            title={m.loadFailed}
            // Ohne Antwort gibt es keinen Text des Servers, nur den des Browsers.
            message={error.status === 0 ? m.unreachable : error.message}
            hint={error.hint}
          />
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <section className="p-4">
      <h1 className="text-lg font-semibold">{children}</h1>
    </section>
  );
}

/** Die Hülle (ui.md §2.6): Routing, je Backlog-Route genau eine Sitzung, Kopfzeile, Tabs. */
export function App({ backlogs, router, theme, deps }: Props) {
  const route = useSignal(router.route);
  const location = useSignal(router.location);
  const start = backlogs.find((b) => b.current);
  const name = backlogOf(route);
  const current = backlogs.find((b) => b.name === name);

  const createSession = useCallback((backlog: string) => openSession(backlog, deps), [deps]);
  const session = useOwned(current?.name, createSession);
  const tabs = useOwned(current?.name, createTabs);

  useEffect(() => {
    if (route.kind === 'home' && start !== undefined) {
      router.navigate(routeHref({ kind: 'backlog', backlog: start.name }), { replace: true });
      return;
    }
    const canonical = canonicalPath(location.pathname);
    // Die Query bleibt: `/b/<b>?state=all` ist ein geteilter Filter.
    if (canonical !== undefined) router.navigate(canonical + location.search, { replace: true });
  }, [route, location, start, router]);

  const backlogSearch = route.kind === 'backlog' ? location.search : undefined;
  useEffect(() => {
    if (backlogSearch !== undefined) tabs?.backlogSearch.set(backlogSearch);
  }, [backlogSearch, tabs]);

  const issueId = route.kind === 'issue' ? route.id : undefined;
  useEffect(() => {
    if (issueId !== undefined) tabs?.open(issueId);
  }, [issueId, tabs]);

  const closeTab = (id: string): void => {
    if (tabs === undefined || current === undefined) return;
    const next = tabs.close(id);
    if (route.kind !== 'issue' || route.id !== id) return;
    const backlog = current.name;
    router.navigate(
      next === undefined
        ? routeHref({ kind: 'backlog', backlog })
        : routeHref({ kind: 'issue', backlog, id: next }),
    );
  };

  const backlogName = current?.name;
  const canWrite = current?.can_write;
  const user = current?.user;
  const writes = session?.writes;
  const access = useMemo<WriteAccess | undefined>(
    () =>
      backlogName === undefined ||
      canWrite === undefined ||
      user === undefined ||
      writes === undefined
        ? undefined
        : { backlog: backlogName, canWrite, me: user, writes },
    [backlogName, canWrite, user, writes],
  );

  let body: ReactNode = null;
  if (current !== undefined) {
    body = session !== undefined && tabs !== undefined && access !== undefined && (
      <StoreContext.Provider value={session.store}>
        <WriteContext.Provider value={access}>
          <WriteFailures writes={session.writes} />
          <TabBar backlog={current.name} route={route} tabs={tabs} onClose={closeTab} />
          <main className="min-h-0 flex-1 overflow-auto">
            <Panel session={session} route={route} me={current.user} onClose={closeTab} />
          </main>
        </WriteContext.Provider>
      </StoreContext.Provider>
    );
  } else if (route.kind === 'not-found') {
    body = <Notice>{m.notFound}</Notice>;
  } else if (name !== undefined) {
    body = <Notice>{m.unknownBacklog(name)}</Notice>;
  } else if (start === undefined) {
    body = <Notice>{m.chooseBacklog}</Notice>;
  }

  return (
    <RouterContext.Provider value={router}>
      <div className="flex h-svh flex-col">
        <Header backlogs={backlogs} current={current} session={session} theme={theme} />
        {body}
      </div>
    </RouterContext.Provider>
  );
}
