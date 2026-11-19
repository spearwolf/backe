import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { bodyHash, type Operation } from '../ops/operation.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { createIssue, editIssue } from './issues.ts';
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
      rmProjects: ['api'],
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
});
