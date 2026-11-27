/**
 * Theme ohne Aufblitzen (ui.md §2.13): `theme.js` setzt `data-theme` vor dem ersten Malen, der
 * Client übernimmt ohne Wechsel. Ein Init-Skript protokolliert in jedem Dokument den Wert von
 * `data-theme` an `<html>`, sobald ein Stylesheet oder `<body>` dazukommt (ab dann kann die Seite
 * malen), und jeden Wechsel danach. Ein Aufblitzen stünde dort als `null` oder `light` vor `dark`.
 */
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixture.ts';

declare global {
  interface Window {
    themeLog?: (string | null)[];
  }
}

/** Läuft vor jedem Skript der Seite; mit `stored` steht die Wahl vorher im Speicher. */
function recordTheme(stored: string | null): void {
  if (stored !== null) localStorage.setItem('backe-ui-theme', stored);
  const log: (string | null)[] = [];
  window.themeLog = log;
  // Nur Änderungen: Setzt der Client denselben Wert noch einmal, blitzt nichts auf.
  const note = () => {
    const value = document.documentElement?.getAttribute('data-theme') ?? null;
    if (log.length === 0 || log.at(-1) !== value) log.push(value);
  };
  const paints = (node: Node) =>
    node instanceof HTMLBodyElement ||
    (node instanceof HTMLLinkElement && node.rel === 'stylesheet');
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target === document.documentElement) note();
      if (r.type === 'childList' && [...r.addedNodes].some(paints)) note();
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

/** `page` mit dem Protokoll, bevor die Fixture `app` zum ersten Mal navigiert. */
const test = base.extend<{ stored: string | null }>({
  stored: [null, { option: true }],
  page: async ({ page, stored }, use) => {
    await page.addInitScript(recordTheme, stored);
    await use(page);
  },
});

test.use({ colorScheme: 'light' });

const themeLog = (page: Page) => page.evaluate(() => window.themeLog);

test.describe('stored dark theme', () => {
  test.use({ stored: 'dark' });

  test('dark theme without a flash', async ({ app }) => {
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await themeLog(app)).toEqual(['dark']);
  });
});

test('switching the theme survives a reload without a flash', async ({ app }) => {
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'light');
  await app.getByRole('button', { name: 'Theme' }).click();
  await app.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');

  await app.reload();
  await expect(app.getByRole('button', { name: 'acme', exact: true })).toBeVisible();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await themeLog(app)).toEqual(['dark']);
});
