import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { resolveContext } from '../context/resolve.ts';
import { createIssue } from './issues.ts';
import { createProject } from './projects.ts';
import { closeSprint, createSprint, listSprints, showSprint } from './sprints.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
});

describe('sprints', () => {
  test('create without title defaults to the slug, an explicit title stays', async () => {
    await createSprint(ctx, { slug: '2026-w48' });
    await createSprint(ctx, { slug: 'x', title: 'X-Sprint' });
    const rows = await listSprints(ctx);
    expect(rows.map((r) => [r.slug, r.title]).sort()).toEqual([
      ['2026-w48', '2026-w48'],
      ['x', 'X-Sprint'],
    ]);
  });

  test('sprints list open ones first', async () => {
    await createSprint(ctx, { slug: 'b', title: 'B', start: '2026-02-01' });
    await createSprint(ctx, { slug: 'a', title: 'A', start: '2026-03-01' });
    await createSprint(ctx, { slug: 'z', title: 'Z' });
    await createSprint(ctx, { slug: 'c', title: 'C', start: '2026-01-01', end: '2026-01-31' });
    await createSprint(ctx, { slug: 'y', title: 'Y' });
    await createIssue(ctx, { title: 'x', sprints: ['a'] });
    await createIssue(ctx, { title: 'done', sprints: ['a'], state: 'done' });
    await closeSprint(ctx, 'c', {});
    const rows = await listSprints(ctx);
    expect(rows.map((r) => r.slug)).toEqual(['b', 'a', 'y', 'z', 'c']);
    expect(rows.find((r) => r.slug === 'a')).toMatchObject({ open: 1, closed: false });
    expect(rows.find((r) => r.slug === 'c')).toMatchObject({
      closed: true,
      start: '2026-01-01',
      end: '2026-01-31',
    });
  });

  test('sprint show groups by state in model order and filters by context project', async () => {
    await createProject(ctx, { path: 'web', title: 'Web' });
    await createProject(ctx, { path: 'ops', title: 'Ops' });
    await createSprint(ctx, { slug: 's1', title: 'S1', body: 'Ziel' });
    const base = { op: 'issue.create' as const, sprints: ['s1'] };
    await executeWrite(ctx, {
      kind: 'batch',
      ops: [
        { ...base, title: 'fertig', projects: ['web'], state: 'done', rank: 1 },
        { ...base, title: 'neu', projects: ['web'], state: 'todo', rank: 2 },
        { ...base, title: 'ops', projects: ['ops'], state: 'todo', rank: 3 },
        { op: 'issue.create', title: 'fremd', projects: ['web'], state: 'todo', rank: 4 },
      ],
    });
    const all = await showSprint(ctx, 's1');
    expect(all.groups.map((g) => g.state)).toEqual(['todo', 'done']);
    expect(all.groups[0]?.items.map((i) => i.issue.title)).toEqual(['neu', 'ops']);
    expect(all.body.trim()).toBe('Ziel');
    expect(all.header).toEqual({});

    const web = await showSprint(await b.context({ project: 'web' }), 's1');
    expect(web.groups.flatMap((g) => g.items.map((i) => i.issue.title))).toEqual(['neu', 'fertig']);
    expect(web.header).toEqual({});
    const unfiltered = await showSprint(await b.context({ project: 'web' }), 's1', { all: true });
    // Ein per Flag gesetztes Projekt bleibt auch mit all bestehen (wie bei issue list).
    expect(unfiltered.groups.flatMap((g) => g.items)).toHaveLength(2);
    const byCreated = await showSprint(ctx, 's1', { sort: 'created', projects: ['web'] });
    expect(byCreated.groups.flatMap((g) => g.items.map((i) => i.issue.title))).toEqual([
      'neu',
      'fertig',
    ]);
    expect(await catchErrAsync(() => showSprint(ctx, 'nix'))).toMatchObject({
      code: 'not_found',
    });
  });

  test('the header names a project that comes from the context, not from a flag', async () => {
    await createProject(ctx, { path: 'web', title: 'Web' });
    await createSprint(ctx, { slug: 's1', title: 'S1' });
    await createIssue(ctx, { title: 'a', sprints: ['s1'], projects: ['web'] });
    await createIssue(ctx, { title: 'b', sprints: ['s1'] });
    const fromEnv = await resolveContext({
      cwd: b.root,
      env: { ...b.env, BACKE_PROJECT: 'web' },
      flags: { as: b.handle },
    });
    const shown = await showSprint(fromEnv, 's1');
    expect(shown.header).toEqual({ backlog: 'acme', project: 'web' });
    expect(shown.groups.flatMap((g) => g.items.map((i) => i.issue.title))).toEqual(['a']);
    expect((await showSprint(fromEnv, 's1', { all: true })).header).toEqual({});
  });

  test('sprint close --carry-over adds open issues to the successor', async () => {
    await createSprint(ctx, { slug: 's1', title: 'S1' });
    await createSprint(ctx, { slug: 's2', title: 'S2' });
    await createIssue(ctx, { title: 'offen', sprints: ['s1'] });
    await createIssue(ctx, { title: 'fertig', sprints: ['s1'], state: 'done' });
    await closeSprint(ctx, 's1', { carryOver: 's2' });
    const s2 = await showSprint(ctx, 's2');
    expect(s2.groups.flatMap((g) => g.items.map((i) => i.issue.title))).toEqual(['offen']);
    expect((await listSprints(ctx)).find((r) => r.slug === 's1')?.closed).toBe(true);
  });
});
