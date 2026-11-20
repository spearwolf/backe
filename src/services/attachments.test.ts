import { execFileSync } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import {
  type AttachSource,
  addAttachment,
  attachmentFileName,
  getAttachment,
  listAttachments,
  removeAttachment,
} from './attachments.ts';
import { createIssue } from './issues.ts';
import { executeWrite } from './write.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const file = (fileName: string, content = new Uint8Array()): AttachSource => ({
  kind: 'file',
  fileName,
  content,
});

let b: TestBacklog;
let ctx: ResolvedContext;
let id: string;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  id = (await createIssue(ctx, { title: 'Mit Anhang' })).id as string;
});

test.each([
  ['trace', 'out.json', 'trace.json'],
  ['bericht', 'Bericht Final.PDF', 'bericht.pdf'],
  ['trace.v2', 'x.log', 'trace.v2'],
  ['dump', 'dump', 'dump'],
])('attachmentFileName(%s, %s) → %s', (name, src, out) =>
  expect(attachmentFileName(name, file(src))).toBe(out),
);

test('json and url names', () => {
  expect(attachmentFileName('data', { kind: 'json', text: '{}' })).toBe('data.json');
  expect(attachmentFileName('data.json', { kind: 'json', text: '{}' })).toBe('data.json');
  expect(attachmentFileName('link', { kind: 'url', url: 'https://x.test' })).toBe('link');
});

test('a source extension that breaks the name rule is a validation error', () => {
  for (const [name, src] of [
    ['x', 'a.b c'],
    ['Großes.txt', 'a.txt'],
  ] as const) {
    let err: unknown;
    try {
      attachmentFileName(name, file(src));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BackeError);
    expect(err).toMatchObject({ code: 'validation' });
    expect((err as BackeError).hint).toContain('--name');
  }
});

test('file names, limits and empty files', async () => {
  const cfgPath = join(b.root, '.backe/backlog.jsonc');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
  cfg.attachments = { max_bytes: 4, lfs: false };
  // Gültig signiert: Ein ungültiger Commit fröre den Stand ein, und Writes auf das Issue danach
  // bauten für verify auf ihm auf.
  await executeWrite(ctx, {
    kind: 'manual',
    subject: 'cfg',
    changes: [{ path: '.backe/backlog.jsonc', content: JSON.stringify(cfg) }],
  });
  await addAttachment(ctx, id, { name: 'vier', source: file('a.TXT', bytes('abcd')) });
  expect(
    await readFile(join(b.root, `issues/${id.slice(3, 5)}/${id}/attachments/vier.txt`), 'utf8'),
  ).toBe('abcd');
  const err = await catchErrAsync(() =>
    addAttachment(ctx, id, { name: 'fuenf', source: file('a.txt', bytes('abcde')) }),
  );
  expect(err).toMatchObject({ code: 'validation' });
  expect(JSON.stringify(err)).toContain('attachments.lfs');
  await addAttachment(ctx, id, { name: 'leer', source: file('leer.txt') });
  expect((await listAttachments(ctx, id)).find((a) => a.name === 'leer')?.size).toBe(0);
});

test('json attachments are validated and formatted', async () => {
  await addAttachment(ctx, id, {
    name: 'data',
    source: { kind: 'json', text: '{"b":1,"a":[1,2]}' },
  });
  const g = await getAttachment(ctx, id, 'data');
  expect(g).toMatchObject({ file: 'data.json' });
  expect(await readFile((g as { path: string }).path, 'utf8')).toBe(
    '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n',
  );
  const err = await catchErrAsync(() =>
    addAttachment(ctx, id, { name: 'kaputt', source: { kind: 'json', text: '{' } }),
  );
  expect(err).toMatchObject({ code: 'validation' });
  expect((err as Error).message).toMatch(/^Ungültiges JSON: /);
});

test('url attachments write no file', async () => {
  await addAttachment(ctx, id, { name: 'doku', source: { kind: 'url', url: 'https://x.test/d' } });
  expect(await listAttachments(ctx, id)).toEqual([{ name: 'doku', url: 'https://x.test/d' }]);
  expect(await getAttachment(ctx, id, 'doku')).toEqual({ name: 'doku', url: 'https://x.test/d' });
  await expect(
    access(join(b.root, `issues/${id.slice(3, 5)}/${id}/attachments`)),
  ).rejects.toThrow();
});

test('list shows sizes, get returns the working copy path, rm removes file and entry', async () => {
  await addAttachment(ctx, id, { name: 'log', source: file('x.log', bytes('hallo')) });
  await addAttachment(ctx, id, { name: 'doku', source: { kind: 'url', url: 'https://x.test/d' } });
  expect(await listAttachments(ctx, id)).toEqual([
    { name: 'log', file: 'log.log', size: 5 },
    { name: 'doku', url: 'https://x.test/d' },
  ]);
  const g = await getAttachment(ctx, id, 'log');
  expect(g).toMatchObject({ name: 'log', file: 'log.log', size: 5 });
  expect((g as { path: string }).path.startsWith(`${b.root}/`)).toBe(true);
  await removeAttachment(ctx, id, 'log');
  expect(await listAttachments(ctx, id)).toEqual([{ name: 'doku', url: 'https://x.test/d' }]);
  await expect(access((g as { path: string }).path)).rejects.toThrow();
});

test('a missing attachment or file is not_found', async () => {
  const err = await catchErrAsync(() => getAttachment(ctx, id, 'nix'));
  expect(err).toMatchObject({ code: 'not_found', message: `${id}: Anhang »nix« nicht gefunden` });
  await addAttachment(ctx, id, { name: 'log', source: file('x.log', bytes('a')) });
  const { path } = (await getAttachment(ctx, id, 'log')) as { path: string };
  execFileSync('rm', [path]);
  expect(await catchErrAsync(() => getAttachment(ctx, id, 'log'))).toMatchObject({
    code: 'not_found',
    message: `${path} existiert nicht`,
  });
  expect((await listAttachments(ctx, id))[0]).toEqual({ name: 'log', file: 'log.log' });
  expect(await catchErrAsync(() => removeAttachment(ctx, id, 'nix'))).toMatchObject({
    code: 'not_found',
  });
});

test('a duplicate name is a conflict', async () => {
  await addAttachment(ctx, id, { name: 'log', source: file('x.log') });
  expect(
    await catchErrAsync(() => addAttachment(ctx, id, { name: 'log', source: file('y.log') })),
  ).toMatchObject({
    code: 'conflict',
  });
});

const lfsInstalled = await (async () => {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const POINTER =
  'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12\n';

async function setLfs(lfs: boolean): Promise<void> {
  const cfgPath = join(b.root, '.backe/backlog.jsonc');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
  cfg.attachments = { max_bytes: 1024, lfs };
  await executeWrite(ctx, {
    kind: 'manual',
    subject: 'cfg',
    changes: [{ path: '.backe/backlog.jsonc', content: JSON.stringify(cfg) }],
  });
}

test.skipIf(!lfsInstalled)('attach get on an lfs pointer asks for lfs pull', async () => {
  await setLfs(true);
  await addAttachment(ctx, id, { name: 'log', source: file('log.txt', bytes('viele Bytes\n')) });
  // Ein Clone ohne `git lfs pull` hat statt der Bytes den Pointer im Arbeitsbaum.
  const path = ((await getAttachment(ctx, id, 'log')) as { path: string }).path;
  await writeFile(path, POINTER);
  const err = await catchErrAsync(() => getAttachment(ctx, id, 'log'));
  expect(err).toMatchObject({
    code: 'sync',
    message: 'Anhang »log« ist nicht geladen (LFS)',
    hint: `git -C ${b.root} lfs pull`,
  });
});

test('an lfs pointer is plain content while attachments.lfs is off', async () => {
  await addAttachment(ctx, id, { name: 'log', source: file('log.txt', bytes(POINTER)) });
  expect(await getAttachment(ctx, id, 'log')).toMatchObject({ name: 'log', file: 'log.txt' });
});

test('an lfs pointer that is not the whole file start is no pointer', async () => {
  await setLfs(false);
  await addAttachment(ctx, id, { name: 'log', source: file('log.txt', bytes(`x${POINTER}`)) });
  expect(await getAttachment(ctx, id, 'log')).toMatchObject({ name: 'log' });
});
