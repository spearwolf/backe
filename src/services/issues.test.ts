import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { bodyHash, type Operation } from '../ops/operation.ts';
import { listComments, loadSnapshot } from '../store/snapshot.ts';
import {
  assignIssue,
  createIssue,
  deleteIssue,
  editIssue,
  linkIssue,
  moveIssue,
  rankIssue,
  reopenIssue,
  resumeIssue,
  unlinkIssue,
} from './issues.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

async function fixtures(ops: Operation[]): Promise<Record<string, string>> {
  return (await executeWrite(ctx, { kind: 'batch', ops })).refs;
}

async function issueOf(id: string) {
  const issue = (await loadSnapshot(b.root)).issues.get(id);
  if (issue === undefined) throw new Error(`Issue ${id} fehlt`);
  return issue;
}

async function setup(flags: { project?: string; sprint?: string } = {}): Promise<void> {
  b = await testBacklog();
  ctx = await b.context();
  await fixtures([
    { op: 'project.create', path: 'web', title: 'Web' },
    { op: 'project.create', path: 'api', title: 'API' },
    { op: 'sprint.create', slug: 's1', title: 'Sprint 1' },
    { op: 'repo.add', url: 'https://example.com/web.git', name: 'webrepo' },
  ]);
  ctx = await b.context(flags);
}

describe('createIssue', () => {
  test('create takes project, sprint and repo from the context', async () => {
    await setup({ project: 'web', sprint: 's1' });
    const withRepo = { ...ctx, repo: { ...ctx.repo, value: 'webrepo' } };
    const out = await createIssue(withRepo, { title: 'Neu' });
    const issue = (await issueOf(out.id as string)).data;
    expect(issue.projects).toEqual(['web']);
    expect(issue.sprints).toEqual(['s1']);
    expect(issue.repos).toEqual(['webrepo']);
  });

  test('create does not prefill a field the input sets', async () => {
    await setup({ project: 'web', sprint: 's1' });
    const out = await createIssue(ctx, { title: 'Neu', projects: ['api'] });
    const issue = (await issueOf(out.id as string)).data;
    expect(issue.projects).toEqual(['api']);
    expect(issue.sprints).toEqual(['s1']);
  });

  test('create with parent inherits from the parent, not from the context', async () => {
    await setup();
    const parent = await createIssue(ctx, { title: 'Eltern', projects: ['api'] });
    ctx = await b.context({ project: 'web', sprint: 's1' });
    const out = await createIssue(ctx, { title: 'Kind', parent: parent.id as string });
    const issue = (await issueOf(out.id as string)).data;
    expect(issue.projects).toEqual(['api']);
    expect(issue.sprints).toBeUndefined();
  });

  test('create resolves short ids for parent and deps', async () => {
    await setup();
    const p = (await createIssue(ctx, { title: 'P' })).id as string;
    const d = (await createIssue(ctx, { title: 'D' })).id as string;
    const out = await createIssue(ctx, {
      title: 'K',
      parent: p.slice(0, 8).toUpperCase(),
      deps: [d.slice(0, 8)],
    });
    const issue = (await issueOf(out.id as string)).data;
    expect(issue.parent).toBe(p);
    expect(issue.depends_on).toEqual([d]);
  });

  test('create parses --prop and --prop :=', async () => {
    await setup();
    const out = await createIssue(ctx, { title: 'P', props: ['estimate_h:=4', 'ref=x'] });
    expect((await issueOf(out.id as string)).data.props).toEqual({ estimate_h: 4, ref: 'x' });
  });

  test('create with a duplicate prop key is a usage error', async () => {
    await setup();
    const err = await catchErrAsync(() => createIssue(ctx, { title: 'P', props: ['a=1', 'a=2'] }));
    expect(err.code).toBe('usage');
    expect(err.message).toContain('»a«');
  });

  test('create takes state, assignee (me) and body', async () => {
    await setup();
    const out = await createIssue(ctx, {
      title: 'T',
      state: 'in-progress',
      assignee: 'me',
      body: 'Text\n',
    });
    const issue = await issueOf(out.id as string);
    expect(issue.data.state).toBe('in_progress');
    expect(issue.data.assignee).toBe('spw');
    expect(issue.body).toBe('Text\n');
  });
});

describe('editIssue', () => {
  test('edit records from values of the locked state', async () => {
    await setup();
    const parent = (await createIssue(ctx, { title: 'P' })).id as string;
    const dep = (await createIssue(ctx, { title: 'D' })).id as string;
    const id = (await createIssue(ctx, { title: 'Alt', props: ['a=1'] })).id as string;
    const out = await editIssue(ctx, id.slice(0, 8), {
      title: 'Neu',
      parent,
      props: ['a=2', 'b:=true'],
      addProjects: ['web'],
      addDeps: [dep],
    });
    expect(out.op).toMatchObject({
      op: 'issue.edit',
      id,
      set: { title: { from: 'Alt', to: 'Neu' }, parent: { from: null, to: parent } },
      add: { projects: ['web'], depends_on: [dep] },
      props: { a: { from: '1', to: '2' }, b: { from: null, to: true } },
    });
    const issue = (await issueOf(id)).data;
    expect(issue.title).toBe('Neu');
    expect(issue.projects).toEqual(['web']);
  });

  test('edit can clear the parent and unset props', async () => {
    await setup();
    const parent = (await createIssue(ctx, { title: 'P' })).id as string;
    const id = (await createIssue(ctx, { title: 'K', parent, props: ['a=1'] })).id as string;
    const out = await editIssue(ctx, id, { parent: null, unsetProps: ['a'], rmDeps: [] });
    expect(out.op).toMatchObject({
      set: { parent: { from: parent, to: null } },
      props: { a: { from: '1', to: null } },
    });
  });

  test('edit drops values equal to the current state', async () => {
    await setup();
    const id = (
      await createIssue(ctx, { title: 'T', projects: ['web'], props: ['a=1'], body: 'x\n' })
    ).id as string;
    const out = await editIssue(ctx, id, {
      title: 'T',
      addProjects: ['web', 'api'],
      rmSprints: ['s1'],
      props: ['a=1'],
      unsetProps: ['zz'],
      body: 'x\n',
    });
    expect(out.op).toMatchObject({ add: { projects: ['api'] } });
    expect(out.op).not.toHaveProperty('set');
    expect(out.op).not.toHaveProperty('props');
    expect(out.op).not.toHaveProperty('body');
    expect(out.op).not.toHaveProperty('remove');
  });

  test('edit with nothing to change is a usage error', async () => {
    await setup();
    const id = (await createIssue(ctx, { title: 'T' })).id as string;
    const err = await catchErrAsync(() => editIssue(ctx, id, { title: 'T' }));
    expect(err.code).toBe('usage');
    expect(err.message).toBe('Nichts zu ändern');
  });

  test('edit sets the body with the hash of the old body', async () => {
    await setup();
    const id = (await createIssue(ctx, { title: 'T', body: 'alt\n' })).id as string;
    const out = await editIssue(ctx, id, { body: 'neu\n' });
    expect(out.op).toMatchObject({ body: { from_hash: bodyHash('alt\n'), to: 'neu\n' } });
    expect((await issueOf(id)).body).toBe('neu\n');
  });

  test('editing a broken issue is a validation error naming the file', async () => {
    await setup();
    const id = (await createIssue(ctx, { title: 'T' })).id as string;
    const { path } = await issueOf(id);
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await writeFile(join(b.root, path), '---\nkaputt: [\n---\n');
    const err = await catchErrAsync(() => editIssue(ctx, id, { title: 'X' }));
    expect(err.code).toBe('validation');
    expect(err.message).toContain(path);
  });

  test('the same key in props and unsetProps is a usage error', async () => {
    await setup();
    const id = (await createIssue(ctx, { title: 'T' })).id as string;
    const err = await catchErrAsync(() =>
      editIssue(ctx, id, { props: ['a=1'], unsetProps: ['a'] }),
    );
    expect(err.code).toBe('usage');
    expect(err.message).toContain('»a«');
  });

  test('editIssue rejects its promise instead of throwing synchronously', async () => {
    await setup();
    const id = (await createIssue(ctx, { title: 'T' })).id as string;
    const pending = editIssue(ctx, id, { props: ['a=1'], unsetProps: ['a'] });
    const err = await pending.then(
      () => undefined,
      (e: unknown) => e as { code: string },
    );
    expect(err?.code).toBe('usage');
  });

  test.each([
    ['projects', { addProjects: ['web'], rmProjects: ['web'] }, 'web'],
    ['sprints', { addSprints: ['s1'], rmSprints: ['s1'] }, 's1'],
  ])('the same %s value in add and rm is a usage error', async (_f, input, value) => {
    await setup();
    const id = (await createIssue(ctx, { title: 'T' })).id as string;
    const err = await catchErrAsync(() => editIssue(ctx, id, input));
    expect(err.code).toBe('usage');
    expect(err.message).toContain(`»${value}«`);
  });

  test('the same dep given as short id and full id in add and rm is a usage error', async () => {
    await setup();
    const dep = (await createIssue(ctx, { title: 'D' })).id as string;
    const id = (await createIssue(ctx, { title: 'T' })).id as string;
    const err = await catchErrAsync(() =>
      editIssue(ctx, id, { addDeps: [dep.slice(0, 8)], rmDeps: [dep] }),
    );
    expect(err.code).toBe('usage');
    expect(err.message).toContain(`»${dep}«`);
  });
});

const newIssue = async (title: string, extra: Partial<Parameters<typeof createIssue>[1]> = {}) =>
  (await createIssue(ctx, { title, ...extra })).id as string;

describe('moveIssue', () => {
  test('move records from and writes the reason as transition comment', async () => {
    await setup();
    const id = await newIssue('T', { state: 'in-progress' });
    const out = await moveIssue(ctx, id.slice(0, 8), { to: 'on-hold', reason: 'Warte auf IdP.' });
    expect(out.op).toMatchObject({ op: 'issue.move', id, from: 'in_progress', to: 'on_hold' });
    expect(out.commit).toBeDefined();
    expect((await issueOf(id)).data.state).toBe('on_hold');
    const comments = await listComments(b.root, id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe('Warte auf IdP.\n');
  });

  test('move to the current state is a no-op without commit', async () => {
    await setup();
    const id = await newIssue('T', { state: 'todo' });
    const out = await moveIssue(ctx, id, { to: 'todo' });
    expect(out.commit).toBeUndefined();
    expect(out.op).toMatchObject({ from: 'todo', to: 'todo' });
  });

  test.each(['', '   \n'])('an empty reason %j is a validation error', async (reason) => {
    await setup();
    const id = await newIssue('T');
    const err = await catchErrAsync(() => moveIssue(ctx, id, { to: 'todo', reason }));
    expect(err.code).toBe('validation');
    expect(err.message).toBe('Begründung ist leer');
  });

  test('an invalid state is a validation error', async () => {
    await setup();
    const id = await newIssue('T');
    const err = await catchErrAsync(() => moveIssue(ctx, id, { to: 'fertig' }));
    expect(err.code).toBe('validation');
  });

  test('move to blocked needs blockers', async () => {
    await setup();
    const id = await newIssue('T');
    const blocker = await newIssue('B');
    const err = await catchErrAsync(() => moveIssue(ctx, id, { to: 'blocked' }));
    expect(err.code).toBe('validation');
    const out = await moveIssue(ctx, id, { to: 'blocked', blockedBy: [blocker.slice(0, 8)] });
    expect(out.op).toMatchObject({ blocked_by: [blocker] });
    expect((await issueOf(id)).data.blocked_by).toEqual([blocker]);
  });

  test('force is passed on and closes a parent with open children', async () => {
    await setup();
    const parent = await newIssue('P', { state: 'review' });
    await newIssue('K', { parent });
    const err = await catchErrAsync(() => moveIssue(ctx, parent, { to: 'done' }));
    expect(err.code).not.toBe('usage');
    const out = await moveIssue(ctx, parent, { to: 'done', force: true });
    expect(out.op).toMatchObject({ force: true });
    expect((await issueOf(parent)).data.state).toBe('done');
  });
});

describe('resumeIssue and reopenIssue', () => {
  test('resume and reopen', async () => {
    await setup();
    const id = await newIssue('T', { state: 'in-progress' });
    await moveIssue(ctx, id, { to: 'on-hold' });
    const resumed = await resumeIssue(ctx, id, { reason: 'weiter' });
    expect(resumed.op).toMatchObject({ op: 'issue.resume', from: 'on_hold' });
    expect((await issueOf(id)).data.state).toBe('in_progress');
    await moveIssue(ctx, id, { to: 'review' });
    await moveIssue(ctx, id, { to: 'done' });
    const reopened = await reopenIssue(ctx, id, { to: 'todo', reason: 'doch nicht' });
    expect(reopened.op).toMatchObject({ op: 'issue.reopen', from: 'done', to: 'todo' });
    expect((await issueOf(id)).data.state).toBe('todo');
    expect(await listComments(b.root, id)).toHaveLength(2);
  });

  test('reopen without target goes to backlog', async () => {
    await setup();
    const id = await newIssue('T', { state: 'cancelled' });
    const out = await reopenIssue(ctx, id);
    expect(out.op).toMatchObject({ from: 'cancelled', to: 'backlog' });
  });

  test('resume of an issue that is not paused is rejected by the ops layer', async () => {
    await setup();
    const id = await newIssue('T', { state: 'todo' });
    const err = await catchErrAsync(() => resumeIssue(ctx, id));
    expect(err.code).toBe('validation');
  });

  test('reopen of an open issue is rejected and an empty reason is a validation error', async () => {
    await setup();
    const id = await newIssue('T', { state: 'todo' });
    expect((await catchErrAsync(() => reopenIssue(ctx, id))).code).toBe('validation');
    const err = await catchErrAsync(() => resumeIssue(ctx, id, { reason: ' ' }));
    expect(err.message).toBe('Begründung ist leer');
  });
});

describe('assignIssue', () => {
  test('assign me, a handle and none', async () => {
    await setup();
    const id = await newIssue('T');
    const me = await assignIssue(ctx, id, 'me');
    expect(me.op).toMatchObject({ set: { assignee: { from: null, to: 'spw' } } });
    expect((await issueOf(id)).data.assignee).toBe('spw');
    const none = await assignIssue(ctx, id, 'none');
    expect(none.op).toMatchObject({ set: { assignee: { from: 'spw', to: null } } });
    const handle = await assignIssue(ctx, id, 'spw');
    expect(handle.op).toMatchObject({ set: { assignee: { from: null, to: 'spw' } } });
    await assignIssue(ctx, id, 'none');
    expect((await issueOf(id)).data.assignee).toBeUndefined();
  });

  test('an invalid handle is a validation error', async () => {
    await setup();
    const id = await newIssue('T');
    const err = await catchErrAsync(() => assignIssue(ctx, id, 'Nicht Gültig'));
    expect(err.code).toBe('validation');
  });
});

describe('rankIssue', () => {
  test('rank before an anchor given as short id', async () => {
    await setup();
    const a = await newIssue('A');
    const c = await newIssue('C');
    await rankIssue(ctx, a, { top: true });
    await rankIssue(ctx, c, { bottom: true });
    const out = await rankIssue(ctx, c, { before: a.slice(0, 8) });
    expect(out.op).toMatchObject({ op: 'issue.rank', id: c, before: a });
    const rc = (await issueOf(c)).data.rank as number;
    const ra = (await issueOf(a)).data.rank as number;
    expect(rc).toBeLessThan(ra);
  });

  test('rank records the current rank as from and supports after and value', async () => {
    await setup();
    const a = await newIssue('A');
    const b2 = await newIssue('B');
    await rankIssue(ctx, b2, { top: true });
    expect((await rankIssue(ctx, a, { value: 10 })).op).toMatchObject({ from: null, value: 10 });
    const out = await rankIssue(ctx, a, { after: b2 });
    expect(out.op).toMatchObject({ from: 10, after: b2 });
    expect((await rankIssue(ctx, a, { top: true })).op).toMatchObject({ top: true });
  });
});

describe('linkIssue and unlinkIssue', () => {
  test.each([
    ['webapp', { repo: 'webapp' }],
    ['webapp@feat/sso', { repo: 'webapp', ref: 'feat/sso' }],
    ['git@github.com:acme/api.git', { url: 'git@github.com:acme/api.git' }],
    ['git@github.com:acme/api.git@v1.2', { url: 'git@github.com:acme/api.git', ref: 'v1.2' }],
    ['https://github.com/acme/api@feat/x', { url: 'https://github.com/acme/api', ref: 'feat/x' }],
  ])('link %s', async (target, expected) => {
    await setup();
    await fixtures([{ op: 'repo.add', url: 'https://example.com/webapp.git', name: 'webapp' }]);
    const id = await newIssue('T');
    const outcome = await linkIssue(ctx, id, target);
    expect(outcome.op).toMatchObject({ op: 'issue.link', id, ...expected });
    expect(outcome.op).not.toHaveProperty('repo' in expected ? 'url' : 'repo');
  });

  test('link with an unknown name that is no URL is a usage error', async () => {
    await setup();
    const id = await newIssue('T');
    const err = await catchErrAsync(() => linkIssue(ctx, id, 'gibtsnicht'));
    expect(err.code).toBe('usage');
    expect(err.message).toContain('»gibtsnicht«');
  });

  test('link with an invalid ref is a validation error', async () => {
    await setup();
    const id = await newIssue('T');
    const err = await catchErrAsync(() => linkIssue(ctx, id, 'webrepo@-x'));
    expect(err.code).toBe('validation');
    const err2 = await catchErrAsync(() => linkIssue(ctx, id, 'https://example.com/a@-x'));
    expect(err2.code).toBe('validation');
  });

  test('link and unlink round trip', async () => {
    await setup();
    const id = await newIssue('T');
    await linkIssue(ctx, id, 'webrepo@main');
    expect((await issueOf(id)).data.repos).toEqual(['webrepo@main']);
    const out = await unlinkIssue(ctx, id, 'webrepo');
    expect(out.op).toMatchObject({ op: 'issue.unlink', repo: 'webrepo' });
    expect((await issueOf(id)).data.repos).toBeUndefined();
  });
});

describe('deleteIssue', () => {
  test('delete with children needs orphan or recursive', async () => {
    await setup();
    const parent = await newIssue('P');
    const child = await newIssue('K', { parent });
    const err = await catchErrAsync(() => deleteIssue(ctx, parent));
    expect(err.code).toBe('conflict');
    const out = await deleteIssue(ctx, parent, { children: 'orphan' });
    expect(out.op).toMatchObject({ op: 'issue.delete', id: parent, children: 'orphan' });
    expect((await issueOf(child)).data.parent).toBeUndefined();
    expect((await loadSnapshot(b.root)).issues.has(parent)).toBe(false);
  });

  test('delete recursive with force', async () => {
    await setup();
    const parent = await newIssue('P');
    const child = await newIssue('K', { parent });
    const out = await deleteIssue(ctx, parent.slice(0, 8), { children: 'recursive', force: true });
    expect(out.op).toMatchObject({ children: 'recursive', force: true });
    const s = await loadSnapshot(b.root);
    expect([s.issues.has(parent), s.issues.has(child)]).toEqual([false, false]);
  });
});
