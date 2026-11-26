import { act, createEvent, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DRAG_TYPE } from '../components/row-drag.ts';
import {
  call,
  linkOf,
  registerBacklogViewHarness,
  rowIds,
  rowOf,
  rows,
  searches,
  view,
} from '../test/backlog-view.tsx';
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

describe('reordering', () => {
  const three = () => view([1, 2, 3].map((n) => testIssue(n)));

  /** jsdom kennt weder `DataTransfer` noch `DragEvent`: ein Ersatz mit `types`, `setData`, `getData`. */
  function dataTransfer() {
    const data = new Map<string, string>();
    return {
      get types() {
        return [...data.keys()];
      },
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      dropEffect: 'none',
      effectAllowed: 'all',
    };
  }
  type Drag = 'dragStart' | 'dragOver' | 'drop' | 'dragEnd';
  function drag(type: Drag, el: HTMLElement, dt: object, clientY = 0) {
    const event = createEvent[type](el, { dataTransfer: dt });
    Object.defineProperty(event, 'clientY', { value: clientY });
    fireEvent(el, event);
  }

  test('dragging a row reranks it optimistically', () => {
    three();
    const dt = dataTransfer();
    drag('dragStart', rowOf(tid(3)), dt);
    expect(dt.getData(DRAG_TYPE)).toBe(tid(3));
    drag('dragOver', rowOf(tid(3)), dt, 5);
    expect(rowOf(tid(3)).getAttribute('data-drop')).toBeNull();
    drag('dragOver', rowOf(tid(1)), dt, 30);
    expect(rowOf(tid(1)).getAttribute('data-drop')).toBe('after');
    drag('dragOver', rowOf(tid(1)), dt, 5);
    expect(rowOf(tid(1)).getAttribute('data-drop')).toBe('before');
    drag('drop', rowOf(tid(1)), dt, 5);
    expect(rowIds()).toEqual([tid(3), tid(1), tid(2)]);
    expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), before: tid(1) });
    drag('dragEnd', rowOf(tid(3)), dt);
    expect(rowOf(tid(1)).getAttribute('data-drop')).toBeNull();
  });

  test('a drop on itself or without the issue type does nothing', () => {
    three();
    const dt = dataTransfer();
    drag('dragStart', rowOf(tid(2)), dt);
    drag('drop', rowOf(tid(2)), dt, 5);
    const foreign = dataTransfer();
    foreign.setData('text/plain', 'x');
    drag('dragOver', rowOf(tid(1)), foreign, 5);
    expect(rowOf(tid(1)).getAttribute('data-drop')).toBeNull();
    drag('drop', rowOf(tid(1)), foreign, 5);
    expect(call).not.toHaveBeenCalled();
  });

  test('alt+arrow reranks with the keyboard', async () => {
    // Ohne Antwort bleibt die Überlagerung stehen.
    call.mockImplementation(() => new Promise(() => {}));
    three();
    linkOf(tid(2)).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(rowIds()).toEqual([tid(2), tid(1), tid(3)]);
    expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
    expect(document.activeElement).toBe(linkOf(tid(2)));
    call.mockClear();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(call).not.toHaveBeenCalled();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);
    expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), after: tid(1) });
    expect(document.activeElement).toBe(linkOf(tid(2)));
    expect(linkOf(tid(2)).getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
  });

  test('no drag when sorted by created', async () => {
    three();
    expect(rowOf(tid(1)).getAttribute('draggable')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: m.sortCreated }));
    expect(rowOf(tid(1)).hasAttribute('draggable')).toBe(false);
    expect(linkOf(tid(1)).hasAttribute('aria-keyshortcuts')).toBe(false);
    linkOf(tid(2)).focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(call).not.toHaveBeenCalled();
  });

  test('no drag without write access', () => {
    view([testIssue(1)], { canWrite: false });
    expect(rowOf(tid(1)).hasAttribute('draggable')).toBe(false);
  });
});
