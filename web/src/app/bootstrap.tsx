import { setLocale } from '@backe/i18n/locale.ts';
import type { BacklogsJson } from '@backe/ui/api.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../components/App.tsx';
import { ErrorPage } from '../components/ErrorPage.tsx';
import { ApiError, getJson } from '../data/api-client.ts';
import type { ConnectionDeps } from '../data/connection.ts';
import { Router } from './router.ts';
import { Theme } from './theme.ts';

export type BootDeps = Partial<ConnectionDeps> & { win?: Window };

/**
 * Hängt die App in `root` ein und liefert die Funktion, die sie wieder abbaut (Tests). Erst die
 * Backlog-Liste, denn sie bringt die Sprache des Servers: Vor dem ersten Rendern steht die Locale.
 */
export async function mountApp(root: HTMLElement, deps: BootDeps = {}): Promise<() => void> {
  const { win = window, ...connection } = deps;
  const reactRoot = createRoot(root);
  let list: BacklogsJson;
  try {
    list = await getJson<BacklogsJson>('/api/backlogs', connection.fetch);
  } catch (cause) {
    // `message` und `hint` kommen in der Sprache des Servers; die eigene kennt der Client noch nicht.
    const error = cause instanceof ApiError ? cause : new ApiError(0, 'offline', String(cause));
    reactRoot.render(
      <StrictMode>
        <ErrorPage message={error.message} hint={error.hint} />
      </StrictMode>,
    );
    return () => reactRoot.unmount();
  }

  setLocale(list.lang);
  win.document.documentElement.lang = list.lang;
  const router = new Router(win);
  const theme = new Theme(win, win.document.documentElement);
  reactRoot.render(
    <StrictMode>
      <App backlogs={list.backlogs} router={router} theme={theme} deps={connection} />
    </StrictMode>,
  );
  return () => {
    reactRoot.unmount();
    router.dispose();
    theme.dispose();
  };
}

export async function bootstrap(root: HTMLElement, deps: BootDeps = {}): Promise<void> {
  await mountApp(root, deps);
}
