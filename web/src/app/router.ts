import {
  batch,
  createMemo,
  createSignal,
  type Signal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';
import { createContext, type MouseEvent, useContext } from 'react';
import { parseRoute, type Route } from './routes.ts';

type Loc = { pathname: string; search: string };
type Win = Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>;

/** Eigener Router auf `pushState`/`popstate`; ein neues Paket lohnt für vier Routen nicht. */
export class Router {
  readonly location: Signal<Loc>;
  readonly route: SignalReader<Route>;
  /**
   * Zählt jede Navigation: jedes `navigate`, auch auf den Ort, an dem die Seite schon steht, und
   * jedes `popstate`. `location` wechselt nur, wenn sich Pfad oder Query ändern; wer auch auf einen
   * Klick auf den aktuellen Ort antworten will (Settings zeigt dann den Abschnitt erneut), liest
   * diesen Zähler.
   */
  readonly navigation: Signal<number>;
  readonly #win: Win;
  readonly #onPop = (): void => this.#sync();

  constructor(win: Win = window) {
    this.#win = win;
    this.location = createSignal<Loc>(this.#read(), { attach: this });
    this.navigation = createSignal(0, { attach: this });
    this.route = createMemo(() => parseRoute(this.location.get().pathname), { attach: this });
    win.addEventListener('popstate', this.#onPop);
  }

  /** Ein Link auf den aktuellen Ort ersetzt den Eintrag, wie der Browser es tut, statt ihn zu stapeln. */
  navigate(href: string, opts: { replace?: boolean } = {}): void {
    const target = new URL(href, this.#win.location.href);
    const cur = this.location.value;
    const same = target.pathname === cur.pathname && target.search === cur.search;
    if (opts.replace || same) this.#win.history.replaceState(null, '', href);
    else this.#win.history.pushState(null, '', href);
    this.#sync();
  }

  dispose(): void {
    this.#win.removeEventListener('popstate', this.#onPop);
    SignalGroup.delete(this);
  }

  #read(): Loc {
    const { pathname, search } = this.#win.location;
    return { pathname, search };
  }

  // Das Signal vergleicht per Identität; ohne Änderung bleibt das alte Objekt, nichts feuert. Der
  // Zähler steigt in jedem Fall, im selben Batch wie `location`.
  #sync(): void {
    const next = this.#read();
    const cur = this.location.value;
    batch(() => {
      if (next.pathname !== cur.pathname || next.search !== cur.search) this.location.set(next);
      this.navigation.set(this.navigation.value + 1);
    });
  }
}

export const RouterContext = createContext<Router | null>(null);

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (router === null) throw new Error('useRouter needs a <RouterContext.Provider>');
  return router;
}

/**
 * Klick-Handler für einen Link, der im Router bleibt. Mittelklick und Modifier behalten das
 * Browser-Verhalten (neuer Tab, neues Fenster).
 */
export function useLinkClick(): (href: string) => (e: MouseEvent) => void {
  const router = useRouter();
  return (href) => (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.navigate(href);
  };
}
