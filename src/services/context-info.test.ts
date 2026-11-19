import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { contextInfo } from './context-info.ts';

test('context shows every value with its source and props on demand', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const file = join(b.root, '.backe/backlog.jsonc');
  const config = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  config.props = { sev: { type: 'integer', description: 'Schwere' } };
  await writeFile(file, JSON.stringify(config));
  const info = await contextInfo(ctx);
  expect(info.backlog).toEqual({
    value: ctx.backlog.value,
    source: ctx.backlog.source,
    root: ctx.backlog.root,
  });
  expect(info.user).toMatchObject({ value: 'spw', key: b.key.priv, canWrite: true });
  expect(info.project).toEqual(ctx.project);
  expect(info.sprint).toEqual(ctx.sprint);
  expect(info.repo).toEqual(ctx.repo);
  expect(info.props).toBeUndefined();
  const withProps = await contextInfo(ctx, { props: true });
  expect(withProps.props).toEqual({ sev: { type: 'integer', description: 'Schwere' } });
});

test('canWrite needs handle and key', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const noKey: ResolvedContext = { ...ctx, user: { ...ctx.user, key: undefined } };
  expect((await contextInfo(noKey)).user.canWrite).toBe(false);
  const noUser: ResolvedContext = { ...ctx, user: { ...ctx.user, value: undefined } };
  expect((await contextInfo(noUser)).user.canWrite).toBe(false);
});

test('props without a working copy is not_found, plain context works', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const bare: ResolvedContext = {
    ...ctx,
    backlog: { ...ctx.backlog, root: undefined, workingCopy: undefined },
  };
  expect((await contextInfo(bare)).backlog.root).toBeUndefined();
  const err = await catchErrAsync(() => contextInfo(bare, { props: true }));
  expect(err.code).toBe('not_found');
});
