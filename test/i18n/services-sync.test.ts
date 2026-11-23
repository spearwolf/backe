import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../../src/core/errors.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import type { Operation } from '../../src/ops/operation.ts';
import { type SyncStatus, statusLine } from '../../src/services/background.ts';
import { commitEdits } from '../../src/services/commit.ts';
import { parseConfigKey } from '../../src/services/config.ts';
import { runDoctor } from '../../src/services/doctor.ts';
import { initBacklog } from '../../src/services/init.ts';
import { quarantineCommit } from '../../src/services/quarantine.ts';
import { executeWrite } from '../../src/services/write.ts';
import { issueFile } from '../../src/store/layout.ts';
import { tempDir } from '../helpers/backlog.ts';
import { testBacklog } from '../helpers/git.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

/** Fängt den Fehler eines asynchronen Aufrufs. */
async function failure(call: () => Promise<unknown>): Promise<BackeError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof BackeError) return error;
    throw error;
  }
  throw new Error('expected a BackeError');
}

test('init rejects an invalid backlog name with an English message and hint', async () => {
  const error = await failure(() =>
    initBacklog({
      homes: {} as never,
      env: {},
      name: 'Bad Name',
      prefix: 'ab',
      handle: 'alice',
      key: '/dev/null',
    }),
  );
  expect(error.message).toBe("Invalid backlog name 'Bad Name'");
  expect(error.hint).toBe('Use lowercase letters, digits and hyphens (max. 64 characters)');
});

test('config key errors are English', () => {
  expect(() => parseConfigKey('nope')).toThrow(/^Unknown key 'nope'; allowed: /);
});

test('quarantine refuses an empty reason in English', async () => {
  const error = await failure(() =>
    quarantineCommit({} as never, { sha: 'abc', decision: 'accepted', reason: ' ' }),
  );
  expect(error.message).toBe('Reason must not be empty');
});

test('the sync status line is English', () => {
  const status = {
    remote: 'origin',
    mode: 'manual',
    unpushed: 2,
    running: false,
    state: { last_error: { code: 'sync', message: 'boom', at: 'now' } },
    conflicts: [{}, {}],
  } as unknown as SyncStatus;
  expect(statusLine(status)).toBe('Sync: 2 unpushed · 2 conflicts · last sync failed: boom');
});

test('doctor explains a missing git in English and keeps the check format', async () => {
  const home = await tempDir();
  const checks = await runDoctor(
    { env: { HOME: home, BACKE_HOME: home }, cwd: home },
    { run: async () => 'missing', host: 'testhost', isAlive: () => false },
  );
  const git = checks.find((c) => c.id === 'git');
  expect(git).toMatchObject({
    status: 'fail',
    detail: 'git not found',
    hint: 'Install Git ≥ 2.38',
  });
  expect(checks.find((c) => c.id === 'user-config')).toMatchObject({
    status: 'ok',
    detail: 'valid',
  });
  expect(checks.find((c) => c.id === 'backlog')).toMatchObject({
    status: 'warn',
    detail: 'No backlog resolved',
  });
});

test('commit warns in English when -m has no manual change to name', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const created = await executeWrite(ctx, {
    kind: 'batch',
    ops: [{ op: 'issue.create', title: 'B' } as Operation],
  });
  const id = (created.recorded[0] as { id: string }).id;
  const file = join(b.root, issueFile(id));
  await writeFile(file, (await readFile(file, 'utf8')).replace('title: B', 'title: B2'));
  const out = await commitEdits(ctx, { message: 'Notes' });
  expect(out.warnings).toEqual(['-m only applies to manual changes']);
});
