import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { call, region, registerSettingsHarness, view } from '../../test/settings-view.tsx';
import { testPatch } from '../../test/state.ts';
import { m } from '../../views/settings.messages.ts';
import { m as w } from '../write/write.messages.ts';

registerSettingsHarness();

const sprints = [
  { slug: 'w47', title: 'W47', start: '2026-11-16', end: '2026-11-22', body: 'Das **Ziel**' },
  { slug: 'w48', title: 'W48', start: '2026-11-23' },
  { slug: 'backlog', title: 'Irgendwann' },
  { slug: 'w40', title: 'W40', start: '2026-09-28', closed: true },
];

const section = () => region(m.sectionSprints);
const openList = () => within(section()).getByRole('list', { name: m.sprintList });
const item = (slug: string) => within(section()).getByRole('listitem', { name: slug });

test('open sprints come first with dates and goal', async () => {
  view({ over: { sprints } });
  expect(
    within(openList())
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('aria-label')),
  ).toEqual(['w48', 'w47', 'backlog']);
  const w47 = item('w47');
  const link = within(w47).getByRole('link', { name: 'W47' });
  expect(link.getAttribute('href')).toBe('/b/acme/backlog?sprint=w47');
  // Die Daten stehen roh da.
  expect(w47.textContent).toContain('2026-11-16 – 2026-11-22');
  expect((await within(w47).findByText('Ziel')).tagName).toBe('STRONG');
});

test('a single date reads as from or until, without a dangling dash', () => {
  view({
    over: {
      sprints: [
        { slug: 'a', title: 'A', start: '2026-11-23' },
        { slug: 'b', title: 'B', end: '2026-12-14' },
        { slug: 'c', title: 'C' },
      ],
    },
  });
  expect(item('a').textContent).toContain(m.sprintFrom('2026-11-23'));
  expect(item('b').textContent).toContain(m.sprintUntil('2026-12-14'));
  for (const slug of ['a', 'b', 'c']) expect(item(slug).textContent).not.toContain('–');
});

test('an end before the start blocks creating', async () => {
  const user = userEvent.setup();
  view();
  await user.click(within(section()).getByRole('button', { name: m.addSprint }));
  const dialog = screen.getByRole('dialog', { name: m.addSprintTitle });
  await user.type(within(dialog).getByLabelText(m.sprintSlug), 'w50');
  const add = within(dialog).getByRole('button', { name: m.addSprint }) as HTMLButtonElement;
  const end = within(dialog).getByLabelText(m.sprintEnd);
  await user.type(within(dialog).getByLabelText(m.sprintStart), '2026-12-14');
  await user.type(end, '2026-12-01');
  expect(end.getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(m.endBeforeStart)).toBeTruthy();
  expect(add.disabled).toBe(true);
  // Derselbe Tag ist erlaubt.
  await user.clear(end);
  await user.type(end, '2026-12-14');
  expect(end.getAttribute('aria-invalid')).toBe('false');
  expect(add.disabled).toBe(false);
  expect(call).not.toHaveBeenCalled();
});

test('a patch before the answer still moves focus to add, and only once', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { sprints } });
  let finish: (v: unknown) => void = () => {};
  call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(within(item('w47')).getByRole('button', { name: m.closeSprintOf('w47') }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: m.closeSprint }));
  // Der Patch kommt vor der Antwort: Der Sprint ist geschlossen, der Dialog geht mit.
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { sprints: [{ slug: 'w47', title: 'W47', closed: true }] } }),
    );
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => finish({ commit: 'c1' }));
  const add = within(section()).getByRole('button', { name: m.addSprint });
  await waitFor(() => expect(document.activeElement).toBe(add));
  // Ein danach abgebrochener Dialog gibt den Fokus an seinen eigenen Auslöser zurück.
  const close = within(item('w48')).getByRole('button', { name: m.closeSprintOf('w48') });
  await user.click(close);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: w.cancel }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(close));
});

test('closed sprints stay folded until asked', async () => {
  const user = userEvent.setup();
  view({ over: { sprints } });
  const toggle = within(section()).getByRole('button', { name: m.closedSprints(1) });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(within(section()).queryByRole('listitem', { name: 'w40' })).toBeNull();
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const closed = within(section()).getByRole('list', { name: m.closedSprintList });
  expect(within(closed).getByRole('listitem', { name: 'w40' })).toBeTruthy();
  // Geschlossene Sprints schließt niemand noch einmal.
  expect(within(item('w40')).queryByRole('button', { name: m.closeSprintOf('w40') })).toBeNull();
  await user.click(toggle);
  expect(within(section()).queryByRole('listitem', { name: 'w40' })).toBeNull();
});

test('without closed sprints there is no fold, without sprints a note', () => {
  view();
  expect(within(section()).getByText(m.noSprints)).toBeTruthy();
  expect(within(section()).queryByRole('button', { name: /\(\d+\)/ })).toBeNull();
});

test('without write access there are no actions', () => {
  view({ canWrite: false, over: { sprints } });
  const buttons = within(section())
    .queryAllByRole('button')
    .map((b) => b.textContent);
  expect(buttons).toEqual([m.sectionSprints, m.closedSprints(1)]);
});

test('creating a sprint sends dates and goal', async () => {
  const user = userEvent.setup();
  view({ over: { sprints } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addSprint }));
  const dialog = screen.getByRole('dialog', { name: m.addSprintTitle });
  const add = within(dialog).getByRole('button', { name: m.addSprint }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  const slug = within(dialog).getByLabelText(m.sprintSlug);
  await user.type(slug, 'Bad Slug');
  expect(slug.getAttribute('aria-invalid')).toBe('true');
  expect(within(dialog).getByText(m.invalidSprintSlug)).toBeTruthy();
  expect(add.disabled).toBe(true);
  await user.clear(slug);
  await user.type(slug, '2026-w49');
  await user.type(within(dialog).getByLabelText(m.fieldTitle), 'W49');
  const start = within(dialog).getByLabelText(m.sprintStart) as HTMLInputElement;
  expect(start.type).toBe('date');
  await user.type(start, '2026-12-01');
  await user.type(within(dialog).getByLabelText(m.sprintEnd), '2026-12-14');
  await user.type(within(dialog).getByLabelText(m.sprintGoal), 'Ziel');
  await user.click(add);
  expect(call).toHaveBeenCalledWith('sprint_create', {
    slug: '2026-w49',
    title: 'W49',
    start: '2026-12-01',
    end: '2026-12-14',
    body: 'Ziel',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a sprint with only a slug sends only the slug', async () => {
  const user = userEvent.setup();
  view();
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(section()).getByRole('button', { name: m.addSprint }));
  const dialog = screen.getByRole('dialog', { name: m.addSprintTitle });
  await user.type(within(dialog).getByLabelText(m.sprintSlug), 'auth');
  // Enter sendet im Browser über den Absende-Knopf im Fuß (`form=`); jsdom kennt diesen
  // Standardknopf nicht, darum geht das Formular hier direkt ab.
  fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
  expect(call).toHaveBeenCalledWith('sprint_create', { slug: 'auth' });
});

test('closing a sprint can carry over to another open sprint', async () => {
  const user = userEvent.setup();
  view({ over: { sprints } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(item('w47')).getByRole('button', { name: m.closeSprintOf('w47') }));
  const dialog = screen.getByRole('dialog', { name: m.closeSprintTitle('w47') });
  const carry = within(dialog).getByLabelText(m.carryOver) as HTMLSelectElement;
  // Nur die anderen offenen Sprints, dazu »keiner« als Vorgabe.
  expect([...carry.options].map((o) => o.value)).toEqual(['', 'w48', 'backlog']);
  expect(carry.options[0]?.textContent).toBe(m.carryOverNone);
  expect(carry.value).toBe('');
  await user.selectOptions(carry, 'w48');
  await user.click(within(dialog).getByRole('button', { name: m.closeSprint }));
  expect(call).toHaveBeenCalledWith('sprint_close', { slug: 'w47', carry_over: 'w48' });
  expect(screen.queryByRole('dialog')).toBeNull();
  // Der Knopf verschwindet mit dem offenen Sprint; der Fokus geht an »Hinzufügen«.
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(section()).getByRole('button', { name: m.addSprint }),
    ),
  );
});

test('closing without carry over sends only the slug', async () => {
  const user = userEvent.setup();
  view({ over: { sprints } });
  call.mockResolvedValue({ commit: 'c1' });
  await user.click(within(item('w48')).getByRole('button', { name: m.closeSprintOf('w48') }));
  const dialog = screen.getByRole('dialog', { name: m.closeSprintTitle('w48') });
  await user.click(within(dialog).getByRole('button', { name: m.closeSprint }));
  expect(call).toHaveBeenCalledWith('sprint_close', { slug: 'w48' });
});

test('lists follow patches and the close dialog of a closed sprint closes', async () => {
  const user = userEvent.setup();
  const { store } = view({ over: { sprints } });
  await user.click(within(item('w47')).getByRole('button', { name: m.closeSprintOf('w47') }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { sprints: [{ slug: 'w47', title: 'W47', closed: true }] } }),
    );
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(openList()).queryByRole('listitem', { name: 'w47' })).toBeNull();
  expect(within(section()).getByRole('button', { name: m.closedSprints(2) })).toBeTruthy();
});
