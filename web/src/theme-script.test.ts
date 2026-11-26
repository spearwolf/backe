import THEME_JS from '../public/theme.js?raw';

const KEY = 'backe-ui-theme';
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Führt `theme.js` aus, wie der Browser ein klassisches Skript ausführt, und liefert das Theme. */
function runThemeScript(): string | undefined {
  delete document.documentElement.dataset.theme;
  new Function(THEME_JS)();
  return document.documentElement.dataset.theme;
}

function systemPrefersDark(dark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
  }));
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

test('theme.js follows the stored choice', () => {
  systemPrefersDark(true);
  localStorage.setItem(KEY, 'light');
  expect(runThemeScript()).toBe('light');
  systemPrefersDark(false);
  localStorage.setItem(KEY, 'dark');
  expect(runThemeScript()).toBe('dark');
});

test('theme.js follows the system without a choice', () => {
  systemPrefersDark(true);
  expect(runThemeScript()).toBe('dark');
  localStorage.setItem(KEY, 'system');
  expect(runThemeScript()).toBe('dark');
  systemPrefersDark(false);
  expect(runThemeScript()).toBe('light');
});

test('theme.js treats garbage as system', () => {
  systemPrefersDark(true);
  for (const garbage of ['', 'Dark', '"dark"', 'blue']) {
    localStorage.setItem(KEY, garbage);
    expect(runThemeScript(), garbage).toBe('dark');
  }
});

test('theme.js survives a throwing localStorage', () => {
  systemPrefersDark(true);
  // So verhält sich ein Browser, der den Speicher der Seite sperrt: schon der Zugriff wirft.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  try {
    expect(runThemeScript()).toBe('dark');
  } finally {
    if (originalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    }
  }
});

test('theme.js survives a missing or throwing matchMedia', () => {
  vi.stubGlobal('matchMedia', undefined);
  expect(runThemeScript()).toBe('light');
  vi.stubGlobal('matchMedia', () => {
    throw new Error('broken');
  });
  expect(runThemeScript()).toBe('light');
});
