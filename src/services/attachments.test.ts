import { execFileSync } from 'node:child_process';
import {
  access,
  chmod,
  type FileHandle,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import {
  type AttachmentSource,
  addAttachment,
  attachmentFileName,
  attachmentLimits,
  getAttachment,
  listAttachments,
  loadAttachmentSource,
  removeAttachment,
} from './attachments.ts';
import { createIssue } from './issues.ts';
import { executeWrite } from './write.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const file = (fileName: string, content = new Uint8Array()): AttachmentSource => ({
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

test('addAttachment rejects instead of throwing synchronously', async () => {
  let pending: Promise<unknown> | undefined;
  expect(() => {
    pending = addAttachment(ctx, id, { name: 'Groß', source: file('a.txt') });
  }).not.toThrow();
  expect(await catchErrAsync(() => pending as Promise<unknown>)).toMatchObject({
    code: 'validation',
  });
});

describe('loadAttachmentSource', () => {
  let base: string;
  const limits = { maxBytes: 1024, lfs: false };
  const opts = (over: { confine?: boolean; maxBytes?: number | null } = {}) => ({
    base,
    home: base,
    ...limits,
    confine: true,
    ...over,
  });

  beforeEach(async () => {
    base = await tempDir();
  });

  test('url, json and text need no file', async () => {
    expect(await loadAttachmentSource({ name: 'u', url: 'https://x.test' }, opts())).toEqual({
      kind: 'url',
      url: 'https://x.test',
    });
    expect(await loadAttachmentSource({ name: 'j', json: '{}' }, opts())).toEqual({
      kind: 'json',
      text: '{}',
    });
    expect(await loadAttachmentSource({ name: 't.txt', text: 'hi' }, opts())).toEqual({
      kind: 'file',
      fileName: 't.txt',
      content: bytes('hi'),
    });
    expect(await catchErrAsync(() => loadAttachmentSource({ name: 'x' }, opts()))).toMatchObject({
      code: 'usage',
    });
  });

  test('a file is read relative to base, also via ~', async () => {
    await writeFile(join(base, 'notes.md'), '# N\n');
    for (const path of ['notes.md', '~/notes.md', join(base, 'notes.md')]) {
      const src = await loadAttachmentSource({ name: 'n', path }, opts());
      expect(src).toMatchObject({ kind: 'file', fileName: 'notes.md' });
      expect(new Uint8Array((src as { content: Uint8Array }).content)).toEqual(bytes('# N\n'));
    }
  });

  test('a file over the limit is not read', async () => {
    await writeFile(join(base, 'gross.bin'), 'x'.repeat(20));
    const read = vi.fn((h: FileHandle) => h.readFile());
    const err = await catchErrAsync(() =>
      loadAttachmentSource({ name: 'g', path: 'gross.bin' }, opts({ maxBytes: 10 }), { read }),
    );
    expect(err).toMatchObject({ code: 'validation', details: { reason: 'too_large' } });
    expect(err.message).toBe('Anhang »g.bin« hat 20 Bytes, erlaubt sind 10');
    expect(err.hint).toContain('attachments.lfs');
    expect(read).not.toHaveBeenCalled();
    // Ohne Grenze und unter der Grenze liest der Lader über das Handle.
    await loadAttachmentSource({ name: 'g', path: 'gross.bin' }, opts({ maxBytes: null }), {
      read,
    });
    await loadAttachmentSource({ name: 'g', path: 'gross.bin' }, opts({ maxBytes: 20 }), { read });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a symlink out of base is a validation error unless unconfined', async () => {
    const outside = await tempDir();
    await writeFile(join(outside, 'geheim.txt'), 'geheim\n');
    await symlink(join(outside, 'geheim.txt'), join(base, 'link.txt'));
    const err = await catchErrAsync(() =>
      loadAttachmentSource({ name: 'x', path: 'link.txt' }, opts()),
    );
    expect(err).toMatchObject({
      code: 'validation',
      message: 'Datei »link.txt« liegt außerhalb des Arbeitsverzeichnisses',
      hint: 'Inhalt per text oder json übergeben',
    });
    // Die CLI liest jede Datei, die ihr User lesen kann (backe.md §2.8).
    const src = await loadAttachmentSource(
      { name: 'x', path: 'link.txt' },
      opts({ confine: false }),
    );
    expect(src).toMatchObject({ kind: 'file', fileName: 'link.txt' });
  });

  test.skipIf(process.getuid?.() === 0)(
    'a file without read permission is a validation error naming the path',
    async () => {
      const path = join(base, 'zu.txt');
      await writeFile(path, 'zu\n');
      await chmod(path, 0o000);
      const err = await catchErrAsync(() =>
        loadAttachmentSource({ name: 'z', path: 'zu.txt' }, opts()),
      );
      expect(err).toMatchObject({
        code: 'validation',
        message: 'Datei »zu.txt« lässt sich nicht lesen (EACCES)',
        details: { path },
      });
    },
  );

  test('a symlink loop is a validation error naming the path', async () => {
    await symlink(join(base, 'b'), join(base, 'a'));
    await symlink(join(base, 'a'), join(base, 'b'));
    const err = await catchErrAsync(() =>
      loadAttachmentSource({ name: 'a', path: 'a' }, opts({ confine: false })),
    );
    expect(err).toMatchObject({
      code: 'validation',
      message: 'Datei »a« lässt sich nicht lesen (ELOOP)',
      details: { path: join(base, 'a') },
    });
  });

  test('a file swapped between check and read is a validation error', async () => {
    await writeFile(join(base, 'echt.txt'), 'echt\n');
    await writeFile(join(base, 'fremd.txt'), 'fremd\n');
    const read = vi.fn((h: FileHandle) => h.readFile());
    const beforeOpen = async () => {
      await rename(join(base, 'fremd.txt'), join(base, 'echt.txt'));
    };
    const err = await catchErrAsync(() =>
      loadAttachmentSource({ name: 'e', path: 'echt.txt' }, opts(), { beforeOpen, read }),
    );
    expect(err).toMatchObject({
      code: 'validation',
      message: 'Datei »echt.txt« wurde während des Lesens ausgetauscht',
    });
    expect(read).not.toHaveBeenCalled();
  });

  test('a file swapped for a symlink before opening is a validation error', async () => {
    const outside = await tempDir();
    await writeFile(join(outside, 'geheim.txt'), 'geheim\n');
    await writeFile(join(base, 'echt.txt'), 'echt\n');
    const beforeOpen = async (real: string) => {
      await rm(real);
      await symlink(join(outside, 'geheim.txt'), real);
    };
    const err = await catchErrAsync(() =>
      loadAttachmentSource({ name: 'e', path: 'echt.txt' }, opts(), { beforeOpen }),
    );
    expect(err).toMatchObject({ code: 'validation' });
  });

  test('a parent directory swapped for a symlink out of base is a validation error', async () => {
    const outside = await tempDir();
    await writeFile(join(outside, 'plan.md'), 'geheim\n');
    await mkdir(join(base, 'sub'));
    await writeFile(join(base, 'sub', 'plan.md'), 'echt\n');
    const read = vi.fn((h: FileHandle) => h.readFile());
    const afterConfine = async () => {
      await rm(join(base, 'sub'), { recursive: true });
      await symlink(outside, join(base, 'sub'));
    };
    const err = await catchErrAsync(() =>
      loadAttachmentSource({ name: 'p', path: 'sub/plan.md' }, opts(), { afterConfine, read }),
    );
    expect(err).toMatchObject({
      code: 'validation',
      message: 'Datei »sub/plan.md« wurde während des Lesens ausgetauscht',
    });
    expect(read).not.toHaveBeenCalled();
  });

  test('a missing file is not_found, a directory is no file', async () => {
    await mkdir(join(base, 'dir'));
    expect(
      await catchErrAsync(() => loadAttachmentSource({ name: 'n', path: 'nope.md' }, opts())),
    ).toMatchObject({ code: 'not_found', message: 'Datei »nope.md« nicht gefunden' });
    expect(
      await catchErrAsync(() => loadAttachmentSource({ name: 'd', path: 'dir' }, opts())),
    ).toMatchObject({ code: 'validation', message: `${join(base, 'dir')} ist keine Datei` });
  });
});

test('attachmentLimits come from HEAD of the working copy', async () => {
  expect(await attachmentLimits(ctx)).toEqual({ maxBytes: 10485760, lfs: false });
  await setLfs(true);
  expect(await attachmentLimits(ctx)).toEqual({ maxBytes: 1024, lfs: true });
  const gone = { ...ctx, backlog: { ...ctx.backlog, root: undefined, workingCopy: undefined } };
  expect(await attachmentLimits(gone)).toEqual({ maxBytes: null, lfs: false });
});
