import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerBacklogViewHarness, rows, searches, view } from '../test/backlog-view.tsx';
import { testIssue, testPatch, tid } from '../test/state.ts';
import { m } from './backlog.messages.ts';

registerBacklogViewHarness();

test('state filter writes the url', async () => {
  const { router } = view([testIssue(1), testIssue(2, { state: 'review' })]);
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterState) }));
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'review' }));
  expect(router.location.value.search).toBe('?state=review');
  await userEvent.keyboard('{Escape}');
  expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([tid(2)]);
});

test('text filter writes q to the url and searches descriptions', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { router } = view([testIssue(1, { title: 'Zebra' }), testIssue(2)]);
    await userEvent.type(screen.getByRole('searchbox'), 'zeb');
    expect(router.location.value.search).toBe('?q=zeb');
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([tid(1)]);
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(searches).toContain('/api/b/acme/search?q=zeb');
  } finally {
    vi.useRealTimers();
  }
});

test('url filter shows field errors', () => {
  view([testIssue(1)], { search: '?mode=fast&assignee=me', me: null });
  expect(screen.getByText(m.unknownMode('fast'))).toBeTruthy();
  expect(screen.getByText(m.meNeedsIdentity)).toBeTruthy();
  expect(rows()).toHaveLength(1);
});

test('property expressions become chips in the url', async () => {
  const { router } = view([testIssue(1, { props: { points: 3 } }), testIssue(2)]);
  await userEvent.type(screen.getByRole('textbox', { name: m.filterProps }), 'points<=5{Enter}');
  expect(router.location.value.search).toBe('?prop=points%3C%3D5');
  expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([tid(1)]);
  await userEvent.click(screen.getByRole('button', { name: m.removeValue('points<=5') }));
  expect(router.location.value.search).toBe('');
});

test('reset clears every filter', async () => {
  const { router } = view([testIssue(1)], { search: '?state=all&q=x' });
  await userEvent.click(screen.getByRole('button', { name: m.resetFilters }));
  expect(router.location.value.search).toBe('');
});

test('single choice filters set and clear their value', async () => {
  const { router } = view([testIssue(1, { assignee: 'spw' }), testIssue(2)]);
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterAssignee) }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'none' }));
  expect(router.location.value.search).toBe('?assignee=none');
  expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([tid(2)]);
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterAssignee) }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: m.anyValue }));
  expect(router.location.value.search).toBe('');
});

test('project filter offers the tree and exact', async () => {
  const { router, store } = view([
    testIssue(1, { projects: ['web'] }),
    testIssue(2, { projects: ['web/auth'] }),
  ]);
  act(() => {
    store.applyPatch(
      testPatch(2, {
        upsert: {
          projects: [
            { path: 'web', title: 'Web' },
            { path: 'web/auth', title: 'Auth' },
          ] as never,
        },
      }),
    );
  });
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterProject) }));
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'web' }));
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: m.exact }));
  expect(router.location.value.search).toBe('?project=web&exact=1');
  await userEvent.keyboard('{Escape}');
  expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([tid(1)]);
});

test('state menu switches between open and all', async () => {
  const { router } = view([testIssue(1), testIssue(2, { state: 'done' })]);
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterState) }));
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: m.stateAll }));
  expect(router.location.value.search).toBe('?state=all');
  await userEvent.click(screen.getByRole('menuitemcheckbox', { name: m.stateOpen }));
  expect(router.location.value.search).toBe('');
});

test('the project menu keeps children under their parent', async () => {
  const { store } = view([testIssue(1)]);
  act(() => {
    store.applyPatch(
      testPatch(2, {
        upsert: {
          projects: ['api-gw', 'api/auth', 'api'].map((path) => ({ path, title: path })) as never,
        },
      }),
    );
  });
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterProject) }));
  const names = screen
    .getAllByRole('menuitemcheckbox')
    .map((item) => item.textContent)
    .filter((t) => t !== m.exact);
  expect(names).toEqual(['api', 'api/auth', 'api-gw']);
});

test('a url value without an option can still be removed', async () => {
  const { router } = view([testIssue(1)], { search: '?project=gone' });
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterProject) }));
  const gone = screen.getByRole('menuitemcheckbox', { name: 'gone' });
  expect(gone.getAttribute('aria-checked')).toBe('true');
  await userEvent.click(gone);
  expect(router.location.value.search).toBe('');
});

test('a state spelled like the cli shows as its state and toggles once', async () => {
  const { router } = view([testIssue(1)], { search: '?state=in-progress' });
  await userEvent.click(screen.getByRole('button', { name: new RegExp(m.filterState) }));
  const item = screen.getByRole('menuitemcheckbox', { name: 'in_progress' });
  expect(item.getAttribute('aria-checked')).toBe('true');
  expect(screen.queryByRole('menuitemcheckbox', { name: 'in-progress' })).toBeNull();
  await userEvent.click(item);
  expect(router.location.value.search).toBe('');
});

/** Der Text, auf den `aria-describedby` eines Elements zeigt. */
function description(el: HTMLElement): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

test('field errors describe their field', () => {
  view([testIssue(1)], { search: '?mode=fast&prop=x>=abc' });
  const mode = screen.getByRole('button', { name: new RegExp(m.filterMode) });
  expect(description(mode)).toContain(m.unknownMode('fast'));
  expect(mode.hasAttribute('aria-invalid')).toBe(false);
  const props = screen.getByRole('textbox', { name: m.filterProps });
  expect(description(props)).not.toBe('');
  expect(props.getAttribute('aria-invalid')).toBe('true');
});

test('the error region is there before the first error', () => {
  const { container } = view([testIssue(1)]);
  const region = container.querySelector('[aria-live="polite"]');
  expect(region).not.toBeNull();
  expect(region?.textContent).toBe('');
});
