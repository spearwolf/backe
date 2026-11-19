import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { createIssue } from './issues.ts';
import {
  createProject,
  listProjects,
  moveProject,
  removeProject,
  showProject,
} from './projects.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
});

describe('projects', () => {
  test('create takes a lead of me and list counts open issues of subprojects', async () => {
    await createProject(ctx, { path: 'web', title: 'Web', lead: 'me', body: 'Text' });
    await createProject(ctx, { path: 'web/auth', title: 'Auth' });
    await createIssue(ctx, { title: 'a', projects: ['web'] });
    await createIssue(ctx, { title: 'b', projects: ['web/auth'] });
    await createIssue(ctx, { title: 'c', projects: ['web'], state: 'done' });
    expect(await listProjects(ctx)).toEqual([
      { path: 'web', title: 'Web', lead: 'spw', open: 2 },
      { path: 'web/auth', title: 'Auth', open: 1 },
    ]);
  });

  test('project list counts open issues of subprojects', async () => {
    await createProject(ctx, { path: 'web', title: 'Web' });
    await createProject(ctx, { path: 'web/auth', title: 'Auth' });
    await createProject(ctx, { path: 'web/auth/sso', title: 'SSO' });
    await createProject(ctx, { path: 'webapp', title: 'Webapp' });
    await createIssue(ctx, { title: 'a', projects: ['web/auth/sso'] });
    await createIssue(ctx, { title: 'b', projects: ['web/auth', 'web/auth/sso'] });
    await createIssue(ctx, { title: 'c', projects: ['webapp'] });
    expect((await listProjects(ctx)).map((p) => [p.path, p.open])).toEqual([
      ['web', 2],
      ['web/auth', 2],
      ['web/auth/sso', 2],
      ['webapp', 1],
    ]);
  });

  test('project show counts issues of subprojects', async () => {
    await createProject(ctx, { path: 'web', title: 'Web', body: 'Beschreibung' });
    await createProject(ctx, { path: 'web/auth', title: 'Auth' });
    await createProject(ctx, { path: 'webapp', title: 'Webapp' });
    await createIssue(ctx, { title: 'a', projects: ['web'] });
    await createIssue(ctx, { title: 'b', projects: ['web/auth', 'web'] });
    await createIssue(ctx, { title: 'c', projects: ['web/auth'], state: 'done' });
    await createIssue(ctx, { title: 'd', projects: ['webapp'] });
    const shown = await showProject(ctx, 'web');
    expect(shown.counts).toEqual({ backlog: 2, done: 1 });
    expect(shown.subprojects).toEqual(['web/auth']);
    expect(shown.body.trim()).toBe('Beschreibung');
    expect(shown.project.title).toBe('Web');
    expect(await catchErrAsync(() => showProject(ctx, 'nix'))).toMatchObject({
      code: 'not_found',
    });
  });

  test('project mv rewrites issues in one commit', async () => {
    await createProject(ctx, { path: 'web', title: 'Web' });
    const a = (await createIssue(ctx, { title: 'a', projects: ['web'] })).id as string;
    const count = async () =>
      Number((await git(['rev-list', '--count', 'HEAD'], { cwd: b.root })).stdout.trim());
    const before = await count();
    const out = await moveProject(ctx, 'web', 'site');
    expect(out.commit).toBeDefined();
    expect(await count()).toBe(before + 1);
    expect((await loadSnapshot(b.root)).issues.get(a)?.data.projects).toEqual(['site']);
    expect((await listProjects(ctx)).map((p) => p.path)).toEqual(['site']);
    expect((await showProject(ctx, 'site')).counts).toEqual({ backlog: 1 });
  });

  test('project rm with detach or reassign, and exclusive options', async () => {
    await createProject(ctx, { path: 'web', title: 'Web' });
    await createProject(ctx, { path: 'ops', title: 'Ops' });
    await createIssue(ctx, { title: 'a', projects: ['web'] });
    expect(
      await catchErrAsync(() => removeProject(ctx, 'web', { reassign: 'ops', detach: true })),
    ).toMatchObject({ code: 'usage' });
    await removeProject(ctx, 'web', { reassign: 'ops' });
    expect((await showProject(ctx, 'ops')).counts).toEqual({ backlog: 1 });
    await removeProject(ctx, 'ops', { detach: true });
    expect(await listProjects(ctx)).toEqual([]);
  });
});
