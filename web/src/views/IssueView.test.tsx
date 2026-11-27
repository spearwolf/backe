import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flush, ID, registerReadIssueViewHarness, served, view } from '../test/read-issue-view.tsx';
import { testConfig, testIssue, testPatch, tid } from '../test/state.ts';
import { m } from './issue.messages.ts';

// Das Markdown-Chunk testet die Markdown-Komponente selbst; hier zählt, was die Ansicht übergibt.
// Wie die echte Komponente per `memo` verpackt; `renders` zählt, wie oft ein Text neu gerendert wird.
const markdownRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../markdown/index.tsx', async () => {
  const { memo } = await import('react');
  return {
    Markdown: memo(({ source }: { source: string }) => {
      markdownRenders.count++;
      return <div data-testid="markdown">{source}</div>;
    }),
  };
});

registerReadIssueViewHarness();

test('shows fields from the store', async () => {
  view(
    [
      testIssue(1, {
        title: 'Hauptsache',
        state: 'in_progress',
        assignee: 'ada',
        projects: ['web'],
        sprints: ['s1'],
        repos: ['core@main'],
        props: { prio: 'high', meta: { a: 1 } },
      }),
    ],
    {
      users: [{ handle: 'ada', name: 'Ada Lovelace', kind: 'human', admin: false }],
      config: testConfig({ props: { prio: { type: 'string', description: 'Wie dringend' } } }),
    },
  );
  await flush();
  expect(screen.getByRole('heading', { level: 1, name: 'Hauptsache' })).toBeTruthy();
  const fields = screen.getByText(m.fieldId).closest('dl') as HTMLElement;
  expect(within(fields).getByText(ID)).toBeTruthy();
  expect(within(fields).getByText('in_progress')).toBeTruthy();
  expect(within(fields).getByText('ada').getAttribute('title')).toBe('Ada Lovelace');
  expect(within(fields).getByText('web')).toBeTruthy();
  expect(within(fields).getByText('core')).toBeTruthy();
  expect(within(fields).getByText('main')).toBeTruthy();
  expect(within(fields).getByText('prio')).toBeTruthy();
  expect(within(fields).getByText('Wie dringend')).toBeTruthy();
  expect(within(fields).getByText('{"a":1}')).toBeTruthy();
});

test('shows the reason of the last transition and the body', async () => {
  served.lastReason = {
    file: 'c.md',
    author: 'spw',
    created: '2026-11-18T10:00:00Z',
    kind: 'transition',
    from: 'todo',
    to: 'blocked',
    body: 'wartet auf Freigabe',
  };
  served.body = 'Langer Text';
  view([testIssue(1, { state: 'blocked', blocked_by: [tid(2)] }), testIssue(2)]);
  await flush();
  const texts = screen.getAllByTestId('markdown').map((e) => e.textContent);
  expect(texts).toContain('wartet auf Freigabe');
  expect(texts).toContain('Langer Text');
});

test('hides a last reason that no longer matches the live state', async () => {
  served.lastReason = {
    file: 'c.md',
    author: 'spw',
    created: '2026-11-18T10:00:00Z',
    kind: 'transition',
    from: 'todo',
    to: 'blocked',
    body: 'wartet auf Freigabe',
  };
  const { store } = view([testIssue(1, { state: 'blocked', blocked_by: [tid(2)] }), testIssue(2)]);
  await flush();
  expect(screen.getAllByTestId('markdown').map((e) => e.textContent)).toContain(
    'wartet auf Freigabe',
  );
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { issues: [testIssue(1, { state: 'in_progress' })] } }),
    );
  });
  await flush();
  expect(screen.queryAllByTestId('markdown').map((e) => e.textContent)).not.toContain(
    'wartet auf Freigabe',
  );
});

test('a patch to an unrelated issue does not render the description again', async () => {
  served.body = 'Langer Text';
  const { store } = view([testIssue(1), testIssue(2)]);
  await flush();
  expect(screen.getByText('Langer Text')).toBeTruthy();
  markdownRenders.count = 0;
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2, { title: 'Anderes' })] } }));
  });
  await flush();
  expect(markdownRenders.count).toBe(0);
});

test('shows relations with states', async () => {
  view([
    testIssue(1, { depends_on: [tid(2), 'bk-gone'], parent: tid(3) }),
    testIssue(2, { state: 'done' }),
    testIssue(3),
    testIssue(4, { parent: ID, state: 'done' }),
    testIssue(5, { parent: ID }),
    testIssue(6, { depends_on: [ID] }),
  ]);
  await flush();
  const deps = screen.getByRole('region', { name: 'depends_on' });
  const link = within(deps).getByRole('link', { name: /Issue 2/ });
  expect(within(link).getByText('done')).toBeTruthy();
  expect(within(deps).getByText('bk-gone')).toBeTruthy();
  expect(within(deps).getByText(m.missing)).toBeTruthy();
  expect(screen.getByRole('region', { name: m.dependents })).toBeTruthy();
  expect(screen.getByText(m.progress(1, 2))).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'blocked_by' })).toBeNull();
});

test('the parent path runs from the root to the direct parent', async () => {
  view([testIssue(1, { parent: tid(2) }), testIssue(2, { parent: tid(3) }), testIssue(3)]);
  await flush();
  const path = screen.getByRole('navigation', { name: m.parents });
  expect(
    within(path)
      .getAllByRole('link')
      .map((a) => a.textContent),
  ).toEqual([expect.stringContaining(tid(3)), expect.stringContaining(tid(2))]);
});

test('a related issue opens its tab', async () => {
  const { router } = view([testIssue(1, { depends_on: [tid(2)] }), testIssue(2)]);
  await flush();
  await userEvent.click(screen.getByRole('link', { name: /Issue 2/ }));
  expect(router.location.get().pathname).toBe(`/b/acme/issue/${tid(2)}`);
});

test('timeline lists comments and transitions in order', async () => {
  served.comments = [
    {
      file: 'a.md',
      author: 'ada',
      created: '2026-11-18T10:00:00Z',
      kind: 'transition',
      from: 'todo',
      to: 'in_progress',
      body: 'los geht es',
    },
    { file: 'b.md', author: 'spw', created: '2026-11-18T11:00:00Z', body: 'ein Kommentar' },
  ];
  view([testIssue(1)], {
    users: [{ handle: 'spw', name: 'Wolfger', kind: 'human', admin: true }],
  });
  await flush();
  const items = within(screen.getByRole('list', { name: m.timeline })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain('todo');
  expect(items[0]?.textContent).toContain('in_progress');
  expect(items[0]?.textContent).toContain('los geht es');
  expect(items[1]?.textContent).toContain('ein Kommentar');
  expect(
    within(items[1] as HTMLElement)
      .getByText('spw')
      .getAttribute('title'),
  ).toBe('Wolfger');
  expect(items[1]?.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-18T11:00:00Z');
});
