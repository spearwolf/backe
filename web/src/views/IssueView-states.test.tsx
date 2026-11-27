import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m as app } from '../app/app.messages.ts';
import { flush, ID, registerReadIssueViewHarness, served, view } from '../test/read-issue-view.tsx';
import { testIssue, testPatch } from '../test/state.ts';
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

test('reloads on a touch', async () => {
  const { store } = view([testIssue(1)]);
  await flush();
  expect(screen.queryByText('neu dazu')).toBeNull();
  served.comments = [
    { file: 'c.md', author: 'spw', created: '2026-11-18T12:00:00Z', body: 'neu dazu' },
  ];
  act(() => {
    store.applyPatch(testPatch(2, { touched: [ID] }));
  });
  await flush();
  expect(screen.getByText('neu dazu')).toBeTruthy();
});

test('shows the loading state while the fields are already there', () => {
  view([testIssue(1, { title: 'Schon da' })]);
  expect(screen.getByRole('heading', { level: 1, name: 'Schon da' })).toBeTruthy();
  expect(screen.getByText(app.loading)).toBeTruthy();
});

test('a deleted issue keeps its tab', async () => {
  const { store, onClose } = view([testIssue(1, { title: 'Weg damit' })]);
  await flush();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [ID] } }));
  });
  await flush();
  expect(screen.getByText(m.deletedNotice)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: 'Weg damit' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: m.closeTab }));
  expect(onClose).toHaveBeenCalledWith(ID);
});

test('a broken issue shows its problem', async () => {
  const { store } = view([], {
    problems: [{ path: 'issues/x.md', message: 'kaputt im Frontmatter', kind: 'issue', key: ID }],
  });
  await flush();
  expect(screen.getByRole('alert').textContent).toContain('kaputt im Frontmatter');
  expect(screen.queryByText(app.deleted)).toBeNull();
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { issues: [testIssue(1, { title: 'Repariert' })] }, problems: [] }),
    );
  });
  await flush();
  expect(screen.getByRole('heading', { level: 1, name: 'Repariert' })).toBeTruthy();
});

test('a failed copy is announced in the live region', async () => {
  const writeText = vi.fn(async () => {
    throw new Error('denied');
  });
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  view([testIssue(1)]);
  await flush();
  await userEvent.click(screen.getByRole('button', { name: m.copyId }));
  await flush();
  expect(screen.getByRole('status').textContent).toBe(m.copyFailed);
});

test('copy puts the id on the clipboard', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  view([testIssue(1)]);
  await flush();
  await userEvent.click(screen.getByRole('button', { name: m.copyId }));
  expect(writeText).toHaveBeenCalledWith(ID);
  expect(screen.getByRole('status').textContent).toBe(m.copied);
});
