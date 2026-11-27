/**
 * Prüfstand für den Tab Settings: die echte `SettingsView` mit Router, Store, `Writes` (dessen
 * `call` ein Mock ist), Theme und Einstellungen der Oberfläche. Wie in `App` folgt die Ansicht der
 * Route und baut sich bei einem Sprachwechsel neu auf (`key={lang}`).
 */
import { type Locale, setLocale } from '@backe/i18n/locale.ts';
import type { StateJson } from '@backe/ui/api.ts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Fragment, useState } from 'react';
import { vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import type { ShownNavigation } from '../app/settings-model.ts';
import { Theme } from '../app/theme.ts';
import { UiContext } from '../app/ui-context.tsx';
import { UiPrefs } from '../app/ui-prefs.ts';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { WriteContext } from '../data/write-context.tsx';
import { Writes } from '../data/writes.ts';
import SettingsView from '../views/SettingsView.tsx';
import { preload } from './chunks.ts';
import { testState } from './state.ts';

export const call = vi.fn<(name: string, args: unknown) => Promise<unknown>>();
/** `scrollIntoView` kennt jsdom nicht; die Tests prüfen, wer wann gezeigt wurde. */
export const scrolled = vi.fn<(this: Element, opts?: ScrollIntoViewOptions) => void>();

const disposers: Array<() => void> = [];

export function registerSettingsHarness(): void {
  // Beschreibungen rendern über den Markdown-Chunk.
  preload(() => import('../markdown/Markdown.tsx'));
  beforeEach(() => {
    call.mockReset();
    scrolled.mockReset();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    cleanup();
    for (const dispose of disposers.splice(0)) dispose();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    setLocale('de');
  });
}

/** Wie `App`: folgt der Route und mountet bei einem Sprachwechsel neu. */
function Host({ prefs, router, backlog }: { prefs: UiPrefs; router: Router; backlog: string }) {
  const lang = useSignal(prefs.lang);
  const route = useSignal(router.route);
  const section = route.kind === 'settings' ? route.section : undefined;
  const [shown] = useState<ShownNavigation>(() => ({ last: undefined }));
  return (
    <Fragment key={lang}>
      <SettingsView backlog={backlog} section={section} shown={shown} />
    </Fragment>
  );
}

export function view(
  opts: {
    backlog?: string;
    section?: string;
    canWrite?: boolean;
    me?: string | null;
    serverLang?: Locale;
    over?: Partial<StateJson>;
  } = {},
) {
  const backlog = opts.backlog ?? 'acme';
  window.history.replaceState(
    null,
    '',
    routeHref({ kind: 'settings', backlog, section: opts.section }),
  );
  const router = new Router(window);
  const store = new Store();
  store.load(testState([], opts.over));
  const writes = new Writes(store, {
    call: call as never,
    upload: (async () => ({ commit: null })) as never,
    refresh: async () => {},
  });
  const theme = new Theme(window);
  const prefs = new UiPrefs(opts.serverLang ?? 'de');
  disposers.push(
    () => prefs.dispose(),
    () => theme.dispose(),
    () => writes.dispose(),
    () => store.dispose(),
    () => router.dispose(),
  );
  const access = {
    backlog,
    canWrite: opts.canWrite ?? true,
    me: opts.me === undefined ? 'spw' : opts.me,
    writes,
  };

  const result = render(
    <UiContext.Provider value={{ theme, prefs }}>
      <RouterContext.Provider value={router}>
        <StoreContext.Provider value={store}>
          <WriteContext.Provider value={access}>
            <Host prefs={prefs} router={router} backlog={backlog} />
          </WriteContext.Provider>
        </StoreContext.Provider>
      </RouterContext.Provider>
    </UiContext.Provider>,
  );
  const go = (section: string | undefined) =>
    act(() => router.navigate(routeHref({ kind: 'settings', backlog, section })));
  return { router, store, writes, theme, prefs, go, ...result };
}

export const region = (name: string) => screen.getByRole('region', { name });

/** Der Wert zu einem Begriff einer Beschreibungsliste (`<dt>` → folgendes `<dd>`). */
export function described(within: HTMLElement, term: string): string | undefined {
  const dt = [...within.querySelectorAll('dt')].find((d) => d.textContent === term);
  return dt?.nextElementSibling?.textContent ?? undefined;
}

/**
 * Schickt das Formular eines Settings-Dialogs ab, wie Enter in einem seiner Felder. Im Browser ist
 * der über `form=` zugeordnete Absende-Knopf im Fuß der Standardknopf; jsdom kennt diesen
 * Standardknopf nicht, darum geht das Formular hier direkt ab.
 */
export function submitForm(dialog: HTMLElement): void {
  fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
}
