import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  rawCommit,
  revParse,
  sigOf,
  statusShort,
  type TestBacklog,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { setIdentity } from '../context/registry.ts';
import { readUserConfig } from '../context/user-config.ts';
import { git } from '../git/exec.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { createAgent } from './agent.ts';
import { verifyRange } from './verify.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;

beforeEach(async () => {
  b = await testBacklog();
});

const present = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

test('create-agent writes a 0600 key, a user signed by the operator and the identity', async () => {
  const r = await createAgent(await b.context(), { handle: 'claude-1' });
  expect(r.keyPath).toBe(join(b.homes.backeHome, 'keys/acme/claude-1'));
  expect((await stat(r.keyPath)).mode & 0o777).toBe(0o600);
  const s = await loadSnapshot(b.root);
  expect(s.users.get('claude-1')?.data).toMatchObject({ kind: 'agent', operator: 'spw' });
  expect(await sigOf(b.root, r.commit, { spw: b.key })).toEqual(['G', 'spw']);
  expect((await readUserConfig(b.homes.backeHome)).identities?.acme?.['claude-1']?.key).toBe(
    r.keyPath,
  );
});

test('the new agent writes in its own working copy after the operator pushed', async () => {
  b = await testBacklog({ remote: true });
  const r = await createAgent(await b.context(), { handle: 'claude-1' });
  await git(['push', '-q', 'origin', 'main'], { cwd: b.root });
  const before = await revParse(b.root, 'HEAD');
  const agent = await b.context({ as: 'claude-1', backlog: 'acme' });
  const res = await executeWrite(agent, {
    kind: 'op',
    op: { op: 'project.create', path: 'web', title: 'Web' },
  });
  const agentKey = {
    line: (await readFile(`${r.keyPath}.pub`, 'utf8')).split('\n')[0] as string,
    priv: r.keyPath,
    pub: `${r.keyPath}.pub`,
  };
  const wc = agent.backlog.workingCopy as string;
  expect(wc).not.toBe(b.root);
  expect(await sigOf(wc, res.commit as string, { 'claude-1': agentKey })).toEqual([
    'G',
    'claude-1',
  ]);
  expect(await revParse(b.root, 'HEAD')).toBe(before);
  expect(await statusShort(b.root)).toEqual([]);
  expect((await verifyRange(wc)).invalid).toEqual([]);
});

test('a policy violation removes the generated key', async () => {
  b = await testBacklog({ remote: true });
  const bob = await testKey('bob');
  await executeWrite(await b.context(), {
    kind: 'op',
    op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
  });
  await rawCommit(b.root, {
    files: {
      [BACKLOG_CONFIG]: JSON.stringify({
        version: 1,
        name: 'acme',
        id_prefix: 'bk',
        admins: ['spw', 'ghost'],
      }),
    },
    key: b.key,
    actor: 'spw',
    op: 'manual',
    subject: 'admins',
  });
  await git(['push', '-q', 'origin', 'main'], { cwd: b.root });
  await setIdentity(b.homes, 'acme', 'bob', bob.priv);
  const ctx = await b.context({ as: 'bob', backlog: 'acme' });
  const err = await catchErrAsync(() => createAgent(ctx, { handle: 'ghost' }));
  expect(err.details).toMatchObject({ reason: 'policy' });
  const keyPath = join(b.homes.backeHome, 'keys/acme/ghost');
  expect(await present(keyPath)).toBe(false);
  expect(await present(`${keyPath}.pub`)).toBe(false);
  expect((await readUserConfig(b.homes.backeHome)).identities?.acme?.ghost).toBeUndefined();
});

test('an existing identity is a conflict before a key is generated', async () => {
  const err = await catchErrAsync(async () => createAgent(await b.context(), { handle: 'spw' }));
  expect(err).toMatchObject({ code: 'conflict' });
  expect(await present(join(b.homes.backeHome, 'keys/acme/spw'))).toBe(false);
});

test('the full history verifies after agent creation and agent writes', async () => {
  const r = await createAgent(await b.context(), {
    handle: 'claude-1',
    name: 'Claude',
    body: 'Bot',
  });
  expect(r.commit).toMatch(/^[0-9a-f]{40}$/);
  expect((await verifyRange(b.root)).invalid).toEqual([]);
});
