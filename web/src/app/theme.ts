import { createSignal, type Signal, SignalGroup } from '@spearwolf/signalize';
import { readText, writeText } from '../lib/storage.ts';

export const THEME_KEY = 'backe-ui-theme';

export type ThemeChoice = 'light' | 'dark' | 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Dieselbe Regel wie `public/theme.js`; der Paritätstest hält beide beieinander. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return prefersDark ? 'dark' : 'light';
}

function parseChoice(raw: string | undefined): ThemeChoice {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/**
 * Theme der Seite als `data-theme` auf `<html>`. `theme.js` setzt es vor dem ersten Malen; diese
 * Klasse übernimmt danach, folgt `matchMedia`, solange `system` gewählt ist, und speichert die Wahl.
 */
export class Theme {
  readonly choice: Signal<ThemeChoice>;
  readonly #root: HTMLElement;
  readonly #media: MediaQueryList | undefined;
  readonly #onChange = (): void => this.#apply();

  constructor(
    win: Pick<Window, 'matchMedia'> = window,
    root: HTMLElement = document.documentElement,
  ) {
    this.#root = root;
    this.choice = createSignal<ThemeChoice>(parseChoice(readText(THEME_KEY)), { attach: this });
    let media: MediaQueryList | undefined;
    try {
      // jsdom und alte Browser kennen `matchMedia` nicht; dann gilt hell wie in `theme.js`.
      media = typeof win.matchMedia === 'function' ? win.matchMedia(DARK_QUERY) : undefined;
    } catch {
      media = undefined;
    }
    this.#media = media;
    media?.addEventListener?.('change', this.#onChange);
    this.#apply();
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    writeText(THEME_KEY, choice);
    this.#apply();
  }

  dispose(): void {
    this.#media?.removeEventListener?.('change', this.#onChange);
    SignalGroup.delete(this);
  }

  #apply(): void {
    this.#root.dataset.theme = resolveTheme(this.choice.value, this.#media?.matches === true);
  }
}
