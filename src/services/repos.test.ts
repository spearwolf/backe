import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { createIssue, linkIssue } from './issues.ts';
import { addRepo, listRepos, removeRepo } from './repos.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
});

describe('repos', () => {
  test('repo add derives the name, list counts linking issues', async () => {
    await addRepo(ctx, { url: 'git@github.com:acme/widgets.git', defaultRef: 'main' });
    await addRepo(ctx, { url: 'https://example.org/team/api', name: 'backend', body: 'Text' });
    const issue = await createIssue(ctx, { title: 'a' });
    await linkIssue(ctx, issue.id as string, 'widgets');
    expect(await listRepos(ctx)).toEqual([
      {
        name: 'backend',
        url: 'https://example.org/team/api',
        canonical: 'example.org/team/api',
        issues: 0,
      },
      {
        name: 'widgets',
        url: 'git@github.com:acme/widgets.git',
        canonical: 'github.com/acme/widgets',
        defaultRef: 'main',
        issues: 1,
      },
    ]);
  });

  test('repo rm removes an unreferenced repo and rejects a referenced one', async () => {
    await addRepo(ctx, { url: 'gh:acme/widgets' });
    const issue = await createIssue(ctx, { title: 'a' });
    await linkIssue(ctx, issue.id as string, 'widgets');
    expect(await catchErrAsync(() => removeRepo(ctx, 'widgets'))).toBeDefined();
    expect(await listRepos(ctx)).toHaveLength(1);
    await addRepo(ctx, { url: 'gh:acme/other' });
    await removeRepo(ctx, 'other');
    expect((await listRepos(ctx)).map((r) => r.name)).toEqual(['widgets']);
  });
});
