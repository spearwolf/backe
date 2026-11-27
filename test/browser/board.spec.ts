/**
 * Ziehen und Tastenzüge im Tab Board (ui.md §2.8, §2.13). Ohne Sprints gibt es nur die Bahn
 * »ohne Sprint« (`data-lane=""`); gewählt wird über `data-lane`/`data-column` der Zellen und
 * `data-card` der Karten.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, type UiHome } from './fixture.ts';

const cell = (page: Page, column: string) =>
  page.locator(`ul[data-lane=""][data-column="${column}"]`);

const cardIds = (target: Locator) =>
  target.locator('li[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

/** Drei Issues in `todo`, dann der Tab Board; zurück kommen die IDs in der Reihenfolge der Zelle. */
async function openBoard(page: Page, home: UiHome): Promise<string[]> {
  for (const title of ['First', 'Second', 'Third']) {
    await home.cli(['new', '-t', title, '--state', 'todo']);
  }
  await page.getByRole('tab', { name: 'Board' }).click();
  const todo = cell(page, 'todo');
  await expect(todo.locator('li[data-card]')).toHaveCount(3);
  return (await cardIds(todo)) as string[];
}

const stateOf = async (home: UiHome, id: string) =>
  (JSON.parse(await home.cli(['show', id, '--json', '--fields', 'state'])) as { state: string })
    .state;

const centre = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y };
};

/**
 * Zieht `from` per Maus: Der PointerSensor von dnd-kit startet erst nach 5 px, darum zuerst ein
 * paar kleine Schritte, dann in Schritten zum Ziel. Losgelassen wird erst, wenn `armed` die
 * Markierung des Ziels zeigt.
 */
async function drag(page: Page, from: Locator, to: { x: number; y: number }, armed: Locator) {
  const start = await centre(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) await page.mouse.move(start.x + i * 4, start.y + i * 4);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(armed).toBeVisible();
  await page.mouse.up();
}

test('moves a card by drag and drop', async ({ app, home }) => {
  const [id] = await openBoard(app, home);
  const target = cell(app, 'in_progress');
  const card = app.locator(`li[data-card="${id}"]`);
  await drag(
    app,
    card,
    await centre(target),
    app.locator('ul[data-column="in_progress"][data-over]'),
  );

  await expect(target.locator(`li[data-card="${id}"]`)).toBeVisible();
  await expect.poll(() => stateOf(home, id as string)).toBe('in_progress');
});

test('moves a card by keyboard', async ({ app, home }) => {
  const [id] = await openBoard(app, home);
  await app.locator(`li[data-card="${id}"]`).getByRole('link').focus();
  await app.keyboard.press('Alt+ArrowRight');

  await expect(cell(app, 'in_progress').locator(`li[data-card="${id}"]`)).toBeVisible();
  await expect.poll(() => stateOf(home, id as string)).toBe('in_progress');
});

test('reorders within a cell by drag and drop', async ({ app, home }) => {
  const [first, second, third] = await openBoard(app, home);
  const firstCard = app.locator(`li[data-card="${first}"]`);
  const box = await centre(firstCard);
  // Knapp unter der Oberkante der ersten Karte: Die dritte landet davor.
  await drag(
    app,
    app.locator(`li[data-card="${third}"]`),
    { x: box.x, y: box.top + 4 },
    app.locator(`li[data-card="${first}"][data-drop="before"]`),
  );

  const order = [third, first, second];
  await expect.poll(() => cardIds(cell(app, 'todo'))).toEqual(order);
  await expect
    .poll(async () => {
      const listed = JSON.parse(
        await home.cli(['ls', '--state', 'todo', '--json', '--fields', 'id']),
      ) as { issues: { id: string }[] };
      return listed.issues.map((i) => i.id);
    })
    .toEqual(order);
});
