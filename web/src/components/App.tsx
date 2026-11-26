import type { BacklogEntryJson } from '@backe/ui/api.ts';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { m } from '../app/app.messages.ts';
import { type Router, RouterContext } from '../app/router.ts';
import { canonicalPath, type Route, routeHref } from '../app/routes.ts';
import { TabModel } from '../app/tabs.ts';
import type { Theme } from '../app/theme.ts';
import type { ConnectionDeps } from '../data/connection.ts';
import { openSession } from '../data/session.ts';
import { StoreContext } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { BacklogView } from '../views/BacklogView.tsx';
import { BoardView } from '../views/BoardView.tsx';
import { IssueView } from '../views/IssueView.tsx';
import { SettingsView } from '../views/SettingsView.tsx';
import { Header } from './Header.tsx';
import { TabBar } from './TabBar.tsx';

type Props = {
  backlogs: readonly BacklogEntryJson[];
  router: Router;
  theme: Theme;
  deps: Partial<ConnectionDeps>;
};

/**
 * Ein Objekt mit `dispose` je Schlüssel: entsteht, wenn der Schlüssel kommt, und geht, wenn er
 * wechselt oder die Komponente abbaut. Bis das neue steht, liefert der Hook `undefined`, nie das
 * alte eines anderen Schlüssels.
 */
function useOwned<T extends { dispose(): void }>(
  key: string | undefined,
  create: (key: string) => T,
): T | undefined {
  const [owned, setOwned] = useState<{ key: string; value: T }>();
  useEffect(() => {
    if (key === undefined) return;
    const value = create(key);
    setOwned({ key, value });
    return () => {
      value.dispose();
      setOwned((cur) => (cur?.value === value ? undefined : cur));
    };
  }, [key, create]);
  return owned !== undefined && owned.key === key ? owned.value : undefined;
}

const createTabs = (backlog: string) => new TabModel(backlog);

function backlogOf(route: Route): string | undefined {
  return route.kind === 'home' || route.kind === 'not-found' ? undefined : route.backlog;
}

function View({ route }: { route: Route }) {
  switch (route.kind) {
    case 'board':
      return <BoardView />;
    case 'issue':
      return <IssueView id={route.id} />;
    case 'settings':
      return <SettingsView />;
    default:
      return <BacklogView />;
  }
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
    if (canonical !== undefined) router.navigate(canonical, { replace: true });
  }, [route, location, start, router]);

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

  let body: ReactNode = null;
  if (current !== undefined) {
    body = session !== undefined && tabs !== undefined && (
      <StoreContext.Provider value={session.store}>
        <TabBar backlog={current.name} route={route} tabs={tabs} onClose={closeTab} />
        <main className="min-h-0 flex-1 overflow-auto">
          <View route={route} />
        </main>
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
