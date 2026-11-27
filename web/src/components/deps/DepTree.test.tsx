import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { depTree } from '../../app/dep-graph.ts';
import { Router, RouterContext } from '../../app/router.ts';
import { Store } from '../../data/store.ts';
import { testIssue, testState, tid } from '../../test/state.ts';
import { m } from '../../views/deps.messages.ts';
import { DepTree } from './DepTree.tsx';

type Issue = ReturnType<typeof testIssue>;

let router: Router;

beforeEach(() => {
  window.history.replaceState(null, '', '/b/acme/issue/bk-t0003');
  router = new Router(window);
});

afterEach(() => {
  cleanup();
  router.dispose();
});

function treeOf(issues: Issue[], id: string, opts: { toggled?: string[]; limit?: number } = {}) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  store.dispose();
  if (s === undefined) throw new Error('no snapshot');
  return depTree(s, id, {
    parents: false,
    toggled: new Set(opts.toggled ?? []),
    limit: opts.limit,
  });
}

function show(tree: ReturnType<typeof treeOf>, onToggle: (key: string) => void = () => {}) {
  return render(
    <RouterContext.Provider value={router}>
      <DepTree tree={tree} backlog="acme" onToggle={onToggle} />
    </RouterContext.Provider>,
  );
}

// u2 → u1 → c → d1; u2 ist erledigt.
const [U2, U1, C, D1] = [1, 2, 3, 4].map(tid) as [string, string, string, string];
const chain = (): Issue[] => [
  testIssue(1, { state: 'done' }),
  testIssue(2, { depends_on: [U2] }),
  testIssue(3, { depends_on: [U1] }),
  testIssue(4, { depends_on: [C] }),
];

test('prerequisites and dependents as nested lists', () => {
  show(treeOf(chain(), C));
  const up = screen.getByRole('list', { name: m.prerequisites });
  expect(within(up).getByRole('link', { name: new RegExp(U1) })).toBeTruthy();
  const nested = within(up).getAllByRole('list');
  expect(within(nested[0] as HTMLElement).getByRole('link', { name: new RegExp(U2) })).toBeTruthy();
  const down = screen.getByRole('list', { name: m.dependents });
  expect(within(down).getByRole('link', { name: new RegExp(D1) })).toBeTruthy();
});

test('empty groups are left out', () => {
  show(treeOf(chain(), U2));
  expect(screen.queryByRole('list', { name: m.prerequisites })).toBeNull();
  expect(screen.getByRole('list', { name: m.dependents })).toBeTruthy();
});

test('a toggle reports the path key', async () => {
  const onToggle = vi.fn();
  const tree = treeOf(chain(), C);
  show(tree, onToggle);
  const button = screen.getByRole('button', { name: m.hideTree(U1) });
  expect(button.getAttribute('aria-expanded')).toBe('true');
  await userEvent.click(button);
  expect(onToggle).toHaveBeenCalledWith(tree.up[0]?.key);
  expect(onToggle).toHaveBeenCalledWith(`up:${U1}~depends_on`);
});

test('a collapsed row offers to show its tree', () => {
  show(treeOf(chain(), C, { toggled: [`up:${U1}~depends_on`] }));
  const button = screen.getByRole('button', { name: m.showTree(U1) });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('link', { name: new RegExp(U2) })).toBeNull();
});

test('cycle and missing rows have no toggle and no link', () => {
  const issues = [testIssue(1, { depends_on: [U1] }), testIssue(2, { depends_on: [U2, tid(9)] })];
  show(treeOf(issues, U2));
  const up = screen.getByRole('list', { name: m.prerequisites });
  const missing = within(up).getByText(m.missing).closest('li') as HTMLElement;
  expect(within(missing).queryByRole('link')).toBeNull();
  expect(within(missing).queryByRole('button')).toBeNull();
  expect(within(missing).getByText(tid(9))).toBeTruthy();
  const cycle = within(up).getByText(m.cycle).closest('li') as HTMLElement;
  expect(within(cycle).queryByRole('button')).toBeNull();
  expect(within(cycle).queryByRole('link')).toBeNull();
});

test('rows show the raw edge kind', () => {
  show(treeOf([testIssue(1), testIssue(2, { blocked_by: [U2] })], U1));
  expect(screen.getByText('blocked_by')).toBeTruthy();
});

test('rows link to their issue tab', async () => {
  show(treeOf(chain(), C));
  await userEvent.click(screen.getByRole('link', { name: new RegExp(U1) }));
  expect(window.location.pathname).toBe(`/b/acme/issue/${U1}`);
});

test('settled rows mute the title instead of fading the row', () => {
  show(treeOf(chain(), C));
  const settled = screen.getByRole('link', { name: new RegExp(U2) });
  expect(settled.querySelector('.truncate')?.className).toContain('text-muted-foreground');
  expect(settled.closest('li')?.className).not.toContain('opacity');
  const open = screen.getByRole('link', { name: new RegExp(U1) });
  expect(open.querySelector('.truncate')?.className).not.toContain('text-muted-foreground');
});

test('the rest beyond the limit is one row', () => {
  show(treeOf(chain(), C, { limit: 1 }));
  expect(screen.getAllByText(m.more(2)).length).toBe(1);
});
