// @vitest-environment node
/**
 * Filter-Parität (ui.md §5 »Client«): Der Tab Backlog zeigt für jede Filter-URL dieselben Issues
 * in derselben Ordnung wie `issue list --all --format json` auf demselben Backlog. Der Client-Pfad
 * läuft wie im Browser: `/state` in den Store, Selektor aus der URL, `selectIssues` auf dem
 * Snapshot ohne Bodies, Beschreibungstreffer aus der Suche.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedContext } from '@backe/context/resolve.ts';
import { selectIssues } from '@backe/ops/issue-query.ts';
import { type IssueListQuery, listIssues } from '@backe/services/issue-list.ts';
import { issueListResultJson } from '@backe/services/views.ts';
import { executeWrite } from '@backe/services/write.ts';
import { stateJson } from '@backe/ui/state.ts';
import { writeOp } from '../../../test/helpers/context.ts';
import { testBacklog } from '../../../test/helpers/git.ts';
import { Store } from '../data/store.ts';
import { DEFAULT_VIEW, type ListView, parseListFilter, toSelector } from './list-filter.ts';

type Row = { id: string; depth?: number; open_deps?: boolean };

let ctx: ResolvedContext;
let store: Store;
const id: Record<string, string> = {};

beforeAll(async () => {
  const b = await testBacklog();
  ctx = await b.context();
  const cfgPath = join(b.root, '.backe/backlog.jsonc');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
  cfg.props = {
    prio: {
      type: 'enum',
      values: ['high', 'medium', 'low'],
      ordered: true,
      description: 'Priorität',
    },
  };
  await executeWrite(ctx, {
    kind: 'manual',
    subject: 'props',
    changes: [{ path: '.backe/backlog.jsonc', content: JSON.stringify(cfg) }],
  });
  ctx = await b.context();
  for (const path of ['web', 'web/auth', 'api']) {
    await writeOp(ctx, { op: 'project.create', path, title: path });
  }
  for (const slug of ['s1', 's2']) await writeOp(ctx, { op: 'sprint.create', slug, title: slug });

  const create = async (key: string, fields: Record<string, unknown>) => {
    id[key] = await writeOp(ctx, { op: 'issue.create', title: key, ...fields } as never);
  };
  await create('Login', { projects: ['web'], sprints: ['s1'], assignee: 'spw' });
  await create('Token', { projects: ['web/auth'], parent: id.Login, state: 'in_progress' });
  await create('Refresh', { projects: ['web/auth'], parent: id.Token, props: { prio: 'high' } });
  await create('Api', { projects: ['api'], sprints: ['s2'], props: { prio: 'low', points: 3 } });
  await create('Done', { projects: ['api'], state: 'done', parent: id.Api });
  await create('Waits', { depends_on: [id.Api], props: { points: 8 } });
  await create('Ready', { depends_on: [id.Done], props: { prio: 'medium' } });
  await create('Stuck', { state: 'blocked', paused_from: 'todo', blocked_by: [id.Api] });
  await create('Unblock', { state: 'blocked', paused_from: 'todo', blocked_by: [id.Done] });
  await create('Paused', { state: 'on_hold', paused_from: 'backlog', sprints: ['s1', 's2'] });
  await create('Gone', { state: 'cancelled', projects: ['web'] });
  await create('Zebra in body', { body: 'nothing here\n' });
  await create('Hidden', { body: 'ein Zebrastreifen im Text\n', projects: ['api'] });
  await create('Child of api', { parent: id.Api, assignee: 'spw' });

  store = new Store();
  store.load(await stateJson(ctx));
});

afterAll(() => store?.dispose());

async function cli(q: IssueListQuery): Promise<Row[]> {
  const json = issueListResultJson(await listIssues(ctx, { ...q, all: true }));
  return (json.issues as Row[]).map(({ id, depth, open_deps }) => ({ id, depth, open_deps }));
}

async function client(search: string, view: ListView): Promise<Row[]> {
  const snapshot = store.toSnapshot();
  const config = store.config.value;
  if (snapshot === undefined || config === undefined) throw new Error('store not loaded');
  const { selector, errors } = toSelector(parseListFilter(search), view, { me: 'spw', config });
  expect(errors).toEqual([]);
  let bodyHits: Set<string> | undefined;
  if (selector.text !== undefined) {
    const found = await listIssues(ctx, { text: selector.text, states: ['all'], all: true });
    bodyHits = new Set(found.items.map((i) => i.issue.id));
  }
  return selectIssues(snapshot, { ...selector, ...(bodyHits ? { bodyHits } : {}) }).map((r) => ({
    id: r.issue.id,
    depth: r.depth,
    open_deps: r.openDeps ? true : undefined,
  }));
}

const flat: ListView = { tree: false, sort: 'rank' };

const CASES: [name: string, search: string, view: ListView, q: IssueListQuery][] = [
  ['default', '', flat, {}],
  ['default tree', '', DEFAULT_VIEW, { tree: true }],
  ['all states', '?state=all', flat, { states: ['all'] }],
  ['two states', '?state=todo&state=blocked', flat, { states: ['todo', 'blocked'] }],
  ['comma states', '?state=on-hold,in_progress', flat, { states: ['on-hold,in_progress'] }],
  ['project recursive', '?project=web&state=all', flat, { projects: ['web'], states: ['all'] }],
  [
    'project exact',
    '?project=web&exact=1&state=all',
    flat,
    { projects: ['web'], exact: true, states: ['all'] },
  ],
  ['two sprints', '?sprint=s1&sprint=s2', flat, { sprints: ['s1', 's2'] }],
  ['assignee me', '?assignee=me&state=all', flat, { assignee: 'me', states: ['all'] }],
  ['assignee none', '?assignee=none', flat, { assignee: 'none' }],
  ['creator', '?creator=spw', flat, { creator: 'spw' }],
  ['ready', '?mode=ready', flat, { mode: 'ready' }],
  ['blocked', '?mode=blocked', flat, { mode: 'blocked' }],
  ['unblockable', '?mode=unblockable', flat, { mode: 'unblockable' }],
  ['ordered enum range', '?prop=prio>=medium', flat, { props: ['prio>=medium'] }],
  ['numeric range', '?prop=points<=3', flat, { props: ['points<=3'] }],
  ['prop or values', '?prop=prio=high,low', flat, { props: ['prio=high,low'] }],
  ['has prop', '?has-prop=points', flat, { hasProps: ['points'] }],
  [
    'text only in body',
    '?q=zebrastreifen&state=all',
    flat,
    { text: 'zebrastreifen', states: ['all'] },
  ],
  ['text in title', '?q=Zebra', flat, { text: 'Zebra' }],
  [
    'created order, tree, filter',
    '?state=all&project=api',
    { tree: true, sort: 'created' },
    { states: ['all'], projects: ['api'], tree: true, sort: 'created' },
  ],
  [
    'tree with filtered parent',
    '?assignee=spw&state=all',
    DEFAULT_VIEW,
    { assignee: 'spw', states: ['all'], tree: true },
  ],
];

// `tempDir` räumt nach jedem Test ab; beide Seiten jedes Falls entstehen darum vorab.
const results = new Map<string, { expected: Row[]; actual: Row[] }>();
beforeAll(async () => {
  for (const [name, search, view, q] of CASES) {
    results.set(name, { expected: await cli(q), actual: await client(search, view) });
  }
});

test.each(CASES.map(([name]) => name))('%s', (name) => {
  const r = results.get(name);
  expect(r?.expected.length).toBeGreaterThan(0);
  expect(r?.actual).toEqual(r?.expected);
});
