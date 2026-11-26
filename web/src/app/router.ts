import {
  createMemo,
  createSignal,
  type Signal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';
import { createContext, useContext } from 'react';
import { parseRoute, type Route } from './routes.ts';

type Loc = { pathname: string; search: string };
type Win = Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>;

/** Eigener Router auf `pushState`/`popstate`; ein neues Paket lohnt für vier Routen nicht. */
export class Router {
  readonly location: Signal<Loc>;
  readonly route: SignalReader<Route>;
  readonly #win: Win;
  readonly #onPop = (): void => this.#sync();

  constructor(win: Win = window) {
    this.#win = win;
    this.location = createSignal<Loc>(this.#read(), { attach: this });
    this.route = createMemo(() => parseRoute(this.location.get().pathname), { attach: this });
    win.addEventListener('popstate', this.#onPop);
  }

  navigate(href: string, opts: { replace?: boolean } = {}): void {
    if (opts.replace) this.#win.history.replaceState(null, '', href);
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

  // Das Signal vergleicht per Identität; ohne Änderung bleibt das alte Objekt, nichts feuert.
  #sync(): void {
    const next = this.#read();
    const cur = this.location.value;
    if (next.pathname !== cur.pathname || next.search !== cur.search) this.location.set(next);
  }
}

export const RouterContext = createContext<Router | null>(null);

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (router === null) throw new Error('useRouter needs a <RouterContext.Provider>');
  return router;
}
