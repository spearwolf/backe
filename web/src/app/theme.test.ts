import THEME_JS from '../../public/theme.js?raw';
import { resolveTheme, THEME_KEY, Theme, type ThemeChoice } from './theme.ts';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** `matchMedia` mit steuerbarem `matches`; `change` ruft die angemeldeten Listener. */
function fakeMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  };
  return {
    win: { matchMedia: () => mql as unknown as MediaQueryList },
    change(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
    listeners,
  };
}

function runThemeScript(): string | undefined {
  delete document.documentElement.dataset.theme;
  new Function(THEME_JS)();
  return document.documentElement.dataset.theme;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

test('resolveTheme matches theme.js', () => {
  for (const choice of ['light', 'dark', 'system'] as ThemeChoice[]) {
    for (const prefersDark of [false, true]) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: prefersDark && query === '(prefers-color-scheme: dark)',
      }));
      localStorage.setItem(THEME_KEY, choice);
      expect(resolveTheme(choice, prefersDark), `${choice}/${prefersDark}`).toBe(runThemeScript());
    }
  }
});

test('set writes the choice and the attribute', () => {
  const media = fakeMedia(false);
  const root = document.createElement('html');
  const theme = new Theme(media.win, root);
  expect(theme.choice.value).toBe('system');
  expect(root.dataset.theme).toBe('light');

  theme.set('dark');
  expect(theme.choice.value).toBe('dark');
  expect(root.dataset.theme).toBe('dark');
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');

  theme.set('system');
  expect(localStorage.getItem(THEME_KEY)).toBe('system');
  expect(root.dataset.theme).toBe('light');
  theme.dispose();
});

test('the stored choice is read on start, garbage means system', () => {
  const media = fakeMedia(true);
  localStorage.setItem(THEME_KEY, 'light');
  const root = document.createElement('html');
  const theme = new Theme(media.win, root);
  expect(theme.choice.value).toBe('light');
  expect(root.dataset.theme).toBe('light');
  theme.dispose();

  localStorage.setItem(THEME_KEY, 'blue');
  const other = new Theme(media.win, root);
  expect(other.choice.value).toBe('system');
  expect(root.dataset.theme).toBe('dark');
  other.dispose();
});

test('system follows a media change', () => {
  const media = fakeMedia(false);
  const root = document.createElement('html');
  const theme = new Theme(media.win, root);
  media.change(true);
  expect(root.dataset.theme).toBe('dark');

  // Eine feste Wahl überstimmt das System.
  theme.set('light');
  media.change(false);
  media.change(true);
  expect(root.dataset.theme).toBe('light');

  theme.dispose();
  expect(media.listeners.size).toBe(0);
});

test('a throwing storage still switches the theme', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  try {
    const root = document.createElement('html');
    const theme = new Theme(fakeMedia(true).win, root);
    expect(root.dataset.theme).toBe('dark');
    theme.set('light');
    expect(theme.choice.value).toBe('light');
    expect(root.dataset.theme).toBe('light');
    theme.dispose();
  } finally {
    if (originalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    }
  }
});

test('a missing or throwing matchMedia means light', () => {
  const root = document.createElement('html');
  const none = new Theme({} as Pick<Window, 'matchMedia'>, root);
  expect(root.dataset.theme).toBe('light');
  none.dispose();
  const broken = new Theme(
    {
      matchMedia: () => {
        throw new Error('broken');
      },
    },
    root,
  );
  expect(root.dataset.theme).toBe('light');
  broken.dispose();
});
