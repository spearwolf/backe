import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { catchErr, catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { cfg, snap } from '../../test/helpers/snapshot.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { issueFile } from '../store/layout.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import {
  effectiveFilter,
  normalizeStates,
  openSnapshot,
  resolveHandle,
  resolveIssueRef,
} from './read.ts';

test('openSnapshot loads the working copy', async () => {
  const b = await testBacklog();
  const { root, snapshot } = await openSnapshot(await b.context());
  expect(root).toBe(b.root);
  expect(snapshot.issues.size).toBe(0);
});

test('openSnapshot without working copy names the add command', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const err = await catchErrAsync(() =>
    openSnapshot({ ...ctx, backlog: { ...ctx.backlog, root: undefined } }),
  );
  expect(err.code).toBe('not_found');
  expect(err.message).toBe('Keine Arbeitskopie von »acme« vorhanden');
  expect(err.hint).toBe('backe backlog add acme <pfad>');
});

test('openSnapshot without working copy names the clone command when a remote is configured', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const err = await catchErrAsync(() =>
    openSnapshot({
      ...ctx,
      backlog: { ...ctx.backlog, root: undefined },
      userConfig: {
        ...ctx.userConfig,
        backlogs: { acme: { remote: 'git@example.com:acme/backlog.git' } },
      },
    }),
  );
  expect(err.hint).toBe('backe backlog clone git@example.com:acme/backlog.git');
});

test('a broken issue is reported, not missing', async () => {
  const b = await testBacklog();
  const id = 'bk-7f3k2';
  const file = join(b.root, issueFile(id));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, '---\ntitle: [kaputt\n---\n');
  const s = await loadSnapshot(b.root);
  const err = catchErr(() => resolveIssueRef(s, '7f3'));
  expect(err.code).toBe('validation');
  expect(err.message).toContain(issueFile(id));
  expect(catchErr(() => resolveIssueRef(s, 'zzzz9')).code).toBe('not_found');
});

test('a loaded issue resolves by short id', () => {
  const s = snap({ config: cfg(), issues: [{ id: 'bk-7f3k2' }] });
  expect(resolveIssueRef(s, '7f3')).toBe('bk-7f3k2');
});

test('me resolves to the context user', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  expect(resolveHandle(ctx, 'me')).toBe('spw');
  expect(resolveHandle(ctx, 'ana')).toBe('ana');
  expect(catchErr(() => resolveHandle(ctx, 'Not A Handle')).code).toBe('validation');
  const anon = { ...ctx, user: { ...ctx.user, value: undefined } };
  const err = catchErr(() => resolveHandle(anon, 'me'));
  expect(err.code).toBe('usage');
  expect(err.message).toBe('»me« braucht eine Identität');
});

test.each([
  [['in-progress,todo'], ['in_progress', 'todo']],
  [
    ['review', 'done'],
    ['review', 'done'],
  ],
  [['all'], 'all'],
])('normalizeStates(%j)', (input, out) => {
  expect(normalizeStates(input)).toEqual(out);
});

test('normalizeStates rejects all next to other states and unknown states', () => {
  const mixed = catchErr(() => normalizeStates(['all,todo']));
  expect([mixed.code, mixed.message]).toEqual(['validation', '»all« steht allein']);
  const unknown = catchErr(() => normalizeStates(['nope']));
  expect([unknown.code, unknown.message]).toEqual(['validation', 'Unbekannter State: »nope«']);
});

test('normalizeStates drops empty elements and rejects empty input', () => {
  expect(normalizeStates(['todo,', ' ,review'])).toEqual(['todo', 'review']);
  for (const input of [[''], [], [',']]) {
    const err = catchErr(() => normalizeStates(input));
    expect([err.code, err.message]).toEqual(['validation', 'Kein State angegeben']);
  }
});

const withContext = (
  ctx: ResolvedContext,
  over: Partial<Pick<ResolvedContext, 'project' | 'sprint' | 'repo'>>,
): ResolvedContext => ({ ...ctx, ...over });

test('explicit filters replace context values and leave the header', async () => {
  const b = await testBacklog();
  const ctx = withContext(await b.context(), {
    project: { value: 'web/auth', source: { kind: 'env' } },
  });
  expect(effectiveFilter(ctx, { project: ['api'] }, false)).toEqual({
    project: ['api'],
    header: {},
  });
  expect(effectiveFilter(ctx, {}, false)).toEqual({
    project: ['web/auth'],
    header: { backlog: 'acme', project: 'web/auth' },
  });
  expect(effectiveFilter(ctx, {}, true)).toEqual({ header: {} });
});

test('flag values filter but stay out of the header; a disabled repo is no filter', async () => {
  const b = await testBacklog();
  const ctx = withContext(await b.context(), {
    sprint: { value: 'one', source: { kind: 'flag' } },
    repo: { value: null, source: { kind: 'env' } },
  });
  expect(effectiveFilter(ctx, {}, false)).toEqual({ sprint: ['one'], header: {} });
  expect(effectiveFilter(ctx, {}, true)).toEqual({ sprint: ['one'], header: {} });
  const repo = withContext(ctx, { repo: { value: 'github.com/a/b', source: { kind: 'project' } } });
  expect(effectiveFilter(repo, {}, false).header).toEqual({
    backlog: 'acme',
    repo: 'github.com/a/b',
  });
});
