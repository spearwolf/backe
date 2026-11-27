/**
 * Issue-Tab im echten Browser: Mermaid lädt seinen Chunk erst, wenn der Block sichtbar wird
 * (ui.md §2.9.3), und ein hochgeladenes Bild erscheint als Vorschau (ui.md §2.9.4).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixture.ts';

/** 1×1-PNG, ein transparentes Pixel. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Öffnet das Issue über seine Zeile im Tab Backlog, ohne neue Navigation des Dokuments. */
async function openIssue(page: Page, id: string): Promise<void> {
  await page.locator(`li[data-id="${id}"]`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/b/acme/issue/${id}$`));
}

test('renders mermaid', async ({ app, home }) => {
  const body = ['```mermaid', 'graph TD', '  A[Start] --> B[Ende]', '```', ''].join('\n');
  const id = (await home.cli(['new', '-t', 'Diagram', '-d', body])).trim();
  await openIssue(app, id);

  const block = app.locator('.markdown-mermaid');
  await expect(block.locator('svg')).toBeVisible();
  await expect(block.getByRole('alert')).toHaveCount(0);
  await expect(block).toContainText('Start');
});

test('uploads an image attachment and shows it', async ({ app, home }) => {
  const id = (await home.cli(['new', '-t', 'With image'])).trim();
  await openIssue(app, id);

  await app
    .getByLabel('Upload files')
    .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL });
  const preview = app.getByRole('img', { name: 'pixel.png' });
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  const listed = await home.cli(['attach', 'list', id, '--json']);
  expect(listed).toContain('pixel.png');
});
