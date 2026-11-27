/**
 * Eine große Zelle im echten Browser (ui.md §2.8 »Große Zellen«): Ab 100 Karten rendert sie nur die
 * sichtbaren. Ein Tastenzug ans Ende holt die Karte ins Bild, und der Fokus folgt ihr; Umsortieren
 * per Drag arbeitet auf den gerenderten Karten wie in einer kleinen Zelle.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test, type UiHome } from './fixture.ts';

const COUNT = 150;

const cell = (page: Page, column: string) =>
  page.locator(`ul[data-lane=""][data-column="${column}"]`);

const cardIds = (target: Locator) =>
  target
    .locator(':scope > li[data-card]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

const listed = async (home: UiHome, state: string): Promise<string[]> =>
  (
    JSON.parse(await home.cli(['ls', '--state', state, '--json', '--fields', 'id'])) as {
      issues: { id: string }[];
    }
  ).issues.map((i) => i.id);

/** `COUNT` Issues in `todo` und eines in `in_progress`, in einem Commit; dann der Tab Board. */
async function openBigBoard(page: Page, home: UiHome): Promise<void> {
  // Mit Rang in Anlegereihenfolge, der Mover dahinter: Nach Alt+← steht er am Ende von `todo`,
  // weit unter den gerenderten Karten. Ohne Rang sortierten die Karten nach `created`, und das ist
  // in einem Batch für alle dieselbe Sekunde.
  const ops: object[] = [];
  for (let i = 1; i <= COUNT; i++) {
    ops.push({ op: 'issue.create', ref: `$c${i}`, title: `Card ${i}`, state: 'todo' });
    ops.push({ op: 'issue.rank', id: `$c${i}`, from: null, value: i * 1000 });
  }
  ops.push({ op: 'issue.create', ref: '$m', title: 'Mover', state: 'in_progress' });
  ops.push({ op: 'issue.rank', id: '$m', from: null, value: (COUNT + 1) * 1000 });
  const file = join(home.dir, 'ops.jsonl');
  await writeFile(file, `${ops.map((op) => JSON.stringify(op)).join('\n')}\n`);
  await home.cli(['batch', '-f', file]);
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(cell(page, 'in_progress').locator('li[data-card]')).toHaveCount(1);
}

test('a big cell renders only what is in sight and says how long it is', async ({ app, home }) => {
  await openBigBoard(app, home);
  const todo = cell(app, 'todo');
  await expect(todo.locator(':scope > li[data-card]').first()).toBeVisible();
  const shown = await cardIds(todo);
  expect(shown.length).toBeGreaterThan(3);
  expect(shown.length).toBeLessThan(COUNT);
  await expect(todo.locator(':scope > li[data-card]').first()).toHaveAttribute(
    'aria-setsize',
    String(COUNT),
  );
});

test('focus follows a card moved to the far end of a big cell', async ({ app, home }) => {
  await openBigBoard(app, home);
  const mover = cell(app, 'in_progress').locator('li[data-card]');
  const id = (await mover.getAttribute('data-card')) as string;
  await mover.getByRole('link').focus();
  await app.keyboard.press('Alt+ArrowLeft');

  // Nach Rang steht sie am Ende von `todo`, weit unter den gerenderten Karten.
  const moved = cell(app, 'todo').locator(`li[data-card="${id}"]`);
  await expect(moved.getByRole('link')).toBeFocused();
  await expect(moved).toBeInViewport();
  await expect.poll(async () => (await listed(home, 'todo')).at(-1)).toBe(id);
  // Die Zelle hat dafür bis ans Ende gescrollt: Ihre erste Karte steht nicht mehr im DOM.
  const first = (await listed(home, 'todo'))[0] as string;
  await expect(cell(app, 'todo').locator(`li[data-card="${first}"]`)).toHaveCount(0);
});

test('reorders within a big cell by drag and drop', async ({ app, home }) => {
  await openBigBoard(app, home);
  const todo = cell(app, 'todo');
  const [first, , third] = (await cardIds(todo)) as string[];
  const from = await todo.locator(`li[data-card="${third}"]`).boundingBox();
  const to = await todo.locator(`li[data-card="${first}"]`).boundingBox();
  if (from === null || to === null) throw new Error('card has no box');
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await app.mouse.move(x, y);
  await app.mouse.down();
  for (let i = 1; i <= 3; i++) await app.mouse.move(x + i * 4, y + i * 4);
  await app.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 10 });
  await expect(todo.locator(`li[data-card="${first}"][data-drop="before"]`)).toBeVisible();
  await app.mouse.up();

  await expect.poll(async () => (await cardIds(todo)).slice(0, 2)).toEqual([third, first]);
  await expect.poll(async () => (await listed(home, 'todo')).slice(0, 2)).toEqual([third, first]);
});
