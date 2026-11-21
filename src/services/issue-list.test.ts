import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { type IssueListQuery, listIssues } from './issue-list.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;
/** P (Paket) mit den Kindern C1, C2 in web; X in ops; Y hängt an X; D ist erledigt; K ist blockiert. */
let id: Record<'P' | 'C1' | 'C2' | 'X' | 'Y' | 'D' | 'K', string>;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  const r = await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      { op: 'project.create', path: 'web', title: 'Web' },
      { op: 'project.create', path: 'web/auth', title: 'Auth' },
      { op: 'project.create', path: 'webapp', title: 'Webapp' },
      { op: 'project.create', path: 'ops', title: 'Ops' },
      { op: 'sprint.create', slug: '2026-w47', title: 'W47' },
      { op: 'repo.add', url: 'git@example.com:acme/webapp.git', name: 'webapp' },
      { op: 'repo.add', url: 'git@example.com:acme/tools.git', name: 'tools' },
      {
        op: 'issue.create',
        ref: '$P',
        title: 'Paket',
        state: 'todo',
        rank: 1,
        projects: ['web'],
        sprints: ['2026-w47'],
        repos: ['webapp'],
        created: '2026-11-19T10:00:03Z',
        body: 'Das Paket mit NEEDLE im Body\n',
      },
      {
        op: 'issue.create',
        ref: '$C1',
        title: 'Kind eins',
        state: 'todo',
        rank: 2,
        parent: '$P',
        projects: ['web/auth'],
        assignee: 'spw',
        repos: ['tools'],
        created: '2026-11-19T10:00:01Z',
        props: { sev: 3 },
      },
      {
        op: 'issue.create',
        ref: '$C2',
        title: 'Kind zwei mit Needle im Titel',
        state: 'backlog',
        rank: 3,
        parent: '$P',
        projects: ['webapp'],
        created: '2026-11-19T10:00:02Z',
        props: { sev: 1 },
      },
      {
        op: 'issue.create',
        ref: '$X',
        // Feste IDs gegen die Anlegereihenfolge: X und Y teilen den Zeitstempel, die ID entscheidet.
        id: 'bk-xxxx1',
        title: 'Ops-Ding',
        state: 'todo',
        rank: 4,
        projects: ['ops'],
        created: '2026-11-19T10:00:04Z',
      },
      {
        op: 'issue.create',
        ref: '$Y',
        id: 'bk-xxxx0',
        title: 'Folge',
        state: 'todo',
        rank: 5,
        depends_on: ['$X'],
        projects: ['ops'],
        props: { color: 'red' },
        created: '2026-11-19T10:00:04Z',
      },
      {
        op: 'issue.create',
        ref: '$D',
        title: 'Fertig',
        state: 'done',
        rank: 6,
        projects: ['web'],
        created: '2026-11-19T10:00:06Z',
      },
      {
        op: 'issue.create',
        ref: '$K',
        title: 'Blockiert',
        state: 'blocked',
        paused_from: 'todo',
        blocked_by: ['$D'],
        rank: 7,
        projects: ['ops'],
        created: '2026-11-19T10:00:05Z',
      },
    ],
  });
  const ref = (k: string): string => r.refs[`$${k}`] as string;
  id = {
    P: ref('P'),
    C1: ref('C1'),
    C2: ref('C2'),
    X: ref('X'),
    Y: ref('Y'),
    D: ref('D'),
    K: ref('K'),
  };
});

async function ids(q: IssueListQuery = {}, c: ResolvedContext = ctx): Promise<string[]> {
  return (await listIssues(c, q)).items.map((i) => i.issue.id);
}
const names = (...keys: (keyof typeof id)[]): string[] => keys.map((k) => id[k]);

test('the default hides settled issues', async () => {
  expect(await ids()).toEqual(names('P', 'C1', 'C2', 'X', 'Y', 'K'));
  expect(await ids({ states: ['all'] })).toEqual(names('P', 'C1', 'C2', 'X', 'Y', 'D', 'K'));
  expect(await ids({ states: ['done'] })).toEqual(names('D'));
  expect(await ids({ states: ['todo,backlog'] })).toEqual(names('P', 'C1', 'C2', 'X', 'Y'));
  expect((await catchErrAsync(() => listIssues(ctx, { states: ['nope'] }))).code).toBe(
    'validation',
  );
});

test('values within a flag are or, flags are and', async () => {
  expect(await ids({ projects: ['ops', 'web/auth'] })).toEqual(names('C1', 'X', 'Y', 'K'));
  expect(await ids({ projects: ['ops', 'web/auth'], states: ['todo'] })).toEqual(
    names('C1', 'X', 'Y'),
  );
  expect(await ids({ projects: ['web'], sprints: ['2026-w47'] })).toEqual(names('P', 'C1'));
  expect(await ids({ repos: ['nirgends'] })).toEqual([]);
  expect(await ids({ repos: ['webapp'] })).toEqual(names('P', 'C2'));
  expect(await ids({ repos: ['tools'] })).toEqual(names('C1'));
  expect(await ids({ repos: ['webapp', 'tools'] })).toEqual(names('P', 'C1', 'C2'));
});

test('--project is recursive, --exact is not', async () => {
  expect(await ids({ projects: ['web'] })).toEqual(names('P', 'C1'));
  expect(await ids({ projects: ['web'], exact: true })).toEqual(names('P'));
});

test('context filters apply and land in the header; -A drops them', async () => {
  const withContext: ResolvedContext = {
    ...ctx,
    project: { value: 'ops', source: { kind: 'env' } },
  };
  const r = await listIssues(withContext, {});
  expect(r.items.map((i) => i.issue.id)).toEqual(names('X', 'Y', 'K'));
  expect(r.header).toEqual({ backlog: 'acme', project: 'ops' });
  const all = await listIssues(withContext, { all: true });
  expect(all.items).toHaveLength(6);
  expect(all.header).toEqual({});
  expect(await ids({ projects: ['web/auth'] }, withContext)).toEqual(names('C1'));
});

test('assignee me and none', async () => {
  expect(await ids({ assignee: 'me' })).toEqual(names('C1'));
  expect(await ids({ assignee: 'spw' })).toEqual(names('C1'));
  expect(await ids({ assignee: 'none' })).toEqual(names('P', 'C2', 'X', 'Y', 'K'));
  expect(await ids({ creator: 'me' })).toHaveLength(6);
  expect(await ids({ creator: 'ana' })).toEqual([]);
  expect((await catchErrAsync(() => listIssues(ctx, { assignee: 'Kein Handle' }))).code).toBe(
    'validation',
  );
});

test('ready, blocked and unblockable', async () => {
  // P hat offene Sub-Issues, Y wartet auf X.
  expect(await ids({ mode: 'ready' })).toEqual(names('C1', 'C2', 'X'));
  expect(await ids({ mode: 'blocked' })).toEqual(names('K'));
  expect(await ids({ mode: 'unblockable' })).toEqual(names('K'));
});

test('an open blocker keeps a blocked issue from being unblockable', async () => {
  await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'issue.edit', id: id.K, add: { blocked_by: [id.X] } },
  });
  expect(await ids({ mode: 'blocked' })).toEqual(names('K'));
  expect(await ids({ mode: 'unblockable' })).toEqual([]);
});

test('--prop and --has-prop filter, an invalid range filter is an error', async () => {
  expect(await ids({ props: ['sev>=2'] })).toEqual(names('C1'));
  expect(await ids({ props: ['sev<=2'] })).toEqual(names('C2'));
  expect(await ids({ props: ['color=red,blue'] })).toEqual(names('Y'));
  expect(await ids({ props: ['sev>=1', 'sev<=2'] })).toEqual(names('C2'));
  expect(await ids({ hasProps: ['sev'] })).toEqual(names('C1', 'C2'));
  expect(await ids({ hasProps: ['sev', 'color'] })).toEqual([]);
  const err = await catchErrAsync(() => listIssues(ctx, { props: ['color>=red'] }));
  expect(err.code).toBe('validation');
  expect(err.message).toContain('color');
});

test('text search covers title and body, case-insensitive', async () => {
  expect(await ids({ text: 'needle' })).toEqual(names('P', 'C2'));
  expect(await ids({ text: 'KIND EINS' })).toEqual(names('C1'));
  expect(await ids({ text: 'gibt-es-nicht' })).toEqual([]);
});

test('parent lists direct children, top-level the roots, both together are a usage error', async () => {
  expect(await ids({ parent: id.P.slice(3, 6) })).toEqual(names('C1', 'C2'));
  expect(await ids({ topLevel: true })).toEqual(names('P', 'X', 'Y', 'K'));
  const err = await catchErrAsync(() => listIssues(ctx, { parent: id.P, topLevel: true }));
  expect(err.code).toBe('usage');
});

test('sort created orders by created, then id', async () => {
  // Alle Zeitstempel fest: C1 < C2 < P < X = Y < K < D; Y steht vor X, weil seine ID kleiner ist.
  expect(await ids({ sort: 'created', states: ['all'] })).toEqual(
    names('C1', 'C2', 'P', 'Y', 'X', 'K', 'D'),
  );
});

test('tree orders children under parents with depth', async () => {
  const r = await listIssues(ctx, { tree: true, states: ['todo', 'backlog'] });
  expect(r.items.map((i) => [i.issue.id, i.depth])).toEqual([
    [id.P, 0],
    [id.C1, 1],
    [id.C2, 1],
    [id.X, 0],
    [id.Y, 0],
  ]);
});

test('tree treats children whose parent is outside the result as roots', async () => {
  const r = await listIssues(ctx, { tree: true, states: ['backlog'] });
  expect(r.items.map((i) => [i.issue.id, i.depth])).toEqual([[id.C2, 0]]);
});

test('without tree there is no depth', async () => {
  const r = await listIssues(ctx, {});
  expect(r.items.every((i) => i.depth === undefined)).toBe(true);
});

test('limit truncates after sorting', async () => {
  const r = await listIssues(ctx, { limit: 2 });
  expect(r.items.map((i) => i.issue.id)).toEqual(names('P', 'C1'));
  expect(r.truncated).toBe(true);
  const exact = await listIssues(ctx, { limit: 6 });
  expect(exact.truncated).toBe(false);
  expect(exact.items).toHaveLength(6);
  const tree = await listIssues(ctx, { limit: 3, tree: true });
  expect(tree.items.map((i) => i.issue.id)).toEqual(names('P', 'C1', 'C2'));
  expect(tree.truncated).toBe(true);
  for (const limit of [0, -1, 1.5]) {
    expect((await catchErrAsync(() => listIssues(ctx, { limit }))).code).toBe('validation');
  }
});

test('openDeps marks unsettled dependencies', async () => {
  const r = await listIssues(ctx, { states: ['all'] });
  const open = Object.fromEntries(r.items.map((i) => [i.issue.id, i.openDeps]));
  expect(open[id.Y]).toBe(true);
  expect(open[id.X]).toBe(false);
  expect(open[id.D]).toBe(false);
});

test('problems carry only issue problems', async () => {
  const r = await listIssues(ctx, {});
  expect(r.problems).toEqual([]);
});
