import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerBacklogViewHarness, rowOf, rows, view } from '../test/backlog-view.tsx';
import { testIssue, testPatch, tid } from '../test/state.ts';
import { m } from './backlog.messages.ts';

// Zählt, wie oft eine Zeile ihren Inhalt rendert: Jede Zeile rendert genau ein `StateIcon`.
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../components/StateIcon.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/StateIcon.tsx')>();
  return {
    ...mod,
    StateIcon: (props: Parameters<typeof mod.StateIcon>[0]) => {
      renders.count++;
      return mod.StateIcon(props);
    },
  };
});

registerBacklogViewHarness();

test('lists open issues as a tree by default', () => {
  view([testIssue(1), testIssue(2, { parent: tid(1) }), testIssue(3, { state: 'done' })]);
  expect(rows().map((r) => r.getAttribute('data-id'))).toEqual([tid(1), tid(2)]);
  expect(rowOf(tid(2)).getAttribute('data-depth')).toBe('1');
});

test('a row shows state, chips, open dependencies and progress', () => {
  view([
    testIssue(1, { assignee: 'alice', projects: ['web'], sprints: ['s1'] }),
    testIssue(2, { parent: tid(1), depends_on: [tid(3)] }),
    testIssue(3),
  ]);
  const parent = within(rowOf(tid(1)));
  expect(parent.getByText('todo')).toBeTruthy();
  expect(parent.getByText('alice')).toBeTruthy();
  expect(parent.getByText('web')).toBeTruthy();
  expect(parent.getByText('s1')).toBeTruthy();
  expect(parent.getByText('0/1')).toBeTruthy();
  expect(within(rowOf(tid(2))).getByLabelText(m.openDeps)).toBeTruthy();
});

test('clicking a row opens the issue tab', async () => {
  const { router } = view([testIssue(1)]);
  await userEvent.click(within(rowOf(tid(1))).getByRole('link'));
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${tid(1)}`);
});

test('flat and created survive a reload', async () => {
  const first = view([testIssue(1), testIssue(2, { parent: tid(1) })]);
  await userEvent.click(screen.getByRole('button', { name: m.viewFlat }));
  await userEvent.click(screen.getByRole('button', { name: m.sortCreated }));
  expect(rowOf(tid(2)).getAttribute('data-depth')).toBe('0');
  first.unmount();
  view([testIssue(1), testIssue(2, { parent: tid(1) })]);
  expect(screen.getByRole('button', { name: m.viewFlat }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('button', { name: m.sortCreated }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

test('an empty result says so', () => {
  view([testIssue(1, { state: 'done' })]);
  expect(screen.getByText(m.noIssues)).toBeTruthy();
});

test('renders only visible rows', () => {
  view(Array.from({ length: 5000 }, (_, i) => testIssue(i + 1)));
  expect(rows().length).toBeGreaterThan(10);
  expect(rows().length).toBeLessThan(60);
  expect(rows()[0]?.getAttribute('aria-setsize')).toBe('5000');
});

test('a live change marks the row', () => {
  const { store } = view([testIssue(1), testIssue(2)]);
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2, { title: 'neu' })] } }));
  });
  expect(rowOf(tid(2)).getAttribute('data-live')).toBe('fresh');
  expect(rowOf(tid(1)).getAttribute('data-live')).toBeNull();
});

test('scroll position stays after a patch', () => {
  const { store } = view(Array.from({ length: 200 }, (_, i) => testIssue(i + 1)));
  const scroller = screen.getByRole('list', { name: m.issues }).parentElement as HTMLElement;
  scroller.scrollTop = 720;
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(999, { rank: 1 })] } }));
  });
  expect(scroller.scrollTop).toBe(720);
});

describe('rendering', () => {
  const fiveRows = () => view([1, 2, 3, 4, 5].map((n) => testIssue(n)));

  test('a patch on one issue renders only its row', () => {
    const { store } = fiveRows();
    renders.count = 0;
    act(() => {
      store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(3, { title: 'neu' })] } }));
    });
    expect(renders.count).toBe(1);
  });

  test('a new issue renders only its own row', () => {
    const { store } = fiveRows();
    renders.count = 0;
    act(() => {
      store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(9, { rank: 1 })] } }));
    });
    expect(renders.count).toBe(1);
  });

  test('the end of a fade renders no row', () => {
    vi.useFakeTimers();
    try {
      const { store } = fiveRows();
      act(() => {
        store.applyPatch(testPatch(2, { remove: { issues: [tid(1)] } }));
      });
      renders.count = 0;
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(rows()).toHaveLength(4);
      expect(renders.count).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

test('a project and a sprint of the same name both show', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    view([testIssue(1, { projects: ['x'], sprints: ['x'] })]);
    expect(within(rowOf(tid(1))).getAllByText('x')).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
  } finally {
    errors.mockRestore();
  }
});
