/**
 * Kernabläufe im Tab Backlog gegen das gebaute `backe ui` (ui.md §2.7, §2.12): anlegen, Titel
 * ändern, Live-Aktualisierung durch einen parallelen CLI-Schreibvorgang, Backlog wechseln.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixture.ts';

const rowOf = (page: Page, title: string) => page.locator('li[data-id]').filter({ hasText: title });

async function titleOf(cli: (args: string[]) => Promise<string>, id: string): Promise<string> {
  const shown = JSON.parse(await cli(['show', id, '--json', '--fields', 'title'])) as {
    title: string;
  };
  return shown.title;
}

test('creates an issue with c and shows it', async ({ app, home }) => {
  await app.keyboard.press('c');
  const dialog = app.getByRole('dialog', { name: 'New issue' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Created in the browser');
  // Ohne Öffnen bleibt der Tab Backlog stehen, und die neue Zeile ist zu sehen.
  await dialog.getByRole('checkbox', { name: 'Open after creating' }).uncheck();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  const row = rowOf(app, 'Created in the browser');
  await expect(row).toBeVisible();
  const id = await row.getAttribute('data-id');
  expect(id).toMatch(/^ac-/);
  expect(await titleOf(home.cli, id as string)).toBe('Created in the browser');
});

test('edits the title in the issue tab', async ({ app, home }) => {
  const id = (await home.cli(['new', '-t', 'Old title'])).trim();
  await rowOf(app, 'Old title').getByRole('link').click();
  await expect(app).toHaveURL(new RegExp(`/b/acme/issue/${id}$`));

  await app.getByRole('button', { name: 'Edit title' }).click();
  const input = app.getByRole('textbox', { name: 'Title' });
  await input.fill('New title');
  await input.press('Enter');
  await expect(app.getByRole('heading', { level: 1, name: 'New title' })).toBeVisible();
  await expect.poll(() => titleOf(home.cli, id)).toBe('New title');
});

test('a parallel CLI write appears without reload', async ({ app, home }) => {
  let navigations = 0;
  app.on('framenavigated', (frame) => {
    if (frame === app.mainFrame()) navigations += 1;
  });
  const id = (await home.cli(['new', '-t', 'Parallel'])).trim();
  await expect(app.locator(`li[data-id="${id}"]`)).toContainText('Parallel');
  expect(navigations).toBe(0);
});

test('switches the backlog', async ({ app, home }) => {
  const id = (await home.cli(['new', '-t', 'Beta issue'], home.beta)).trim();
  await app.getByRole('button', { name: 'acme', exact: true }).click();
  await app.getByRole('menuitemradio', { name: /beta/ }).click();
  await expect(app).toHaveURL(/\/b\/beta\/backlog$/);
  await expect(app.locator(`li[data-id="${id}"]`)).toContainText('Beta issue');
});
