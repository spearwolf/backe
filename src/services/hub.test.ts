/**
 * Der lokale Hub (backe.md §2.16.1): Ein Backlog ohne Remote bekommt ihn, sobald eine zweite
 * Identität ihre Arbeitskopie klont; beide Arbeitskopien syncen danach über ihn.
 */
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { revParse, type TestBacklog, testBacklog, testKey } from '../../test/helpers/git.ts';
import { setIdentity } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { readLocalState } from '../git/local-state.ts';
import { ensureHub } from './hub.ts';
import { syncNow, syncRemote } from './sync.ts';
import { ensureWorkingCopy } from './working-copy.ts';
import { executeWrite } from './write.ts';

let solo: TestBacklog;
let spw: ResolvedContext;

beforeEach(async () => {
  solo = await testBacklog();
  spw = await solo.context();
});

const hubPath = () => join(solo.homes.backeHome, 'backlogs', 'acme', 'hub.git');
const config = { remote: 'origin', branch: 'main' };

async function addAgent(handle = 'claude-1'): Promise<ResolvedContext> {
  const key = await testKey(handle);
  await executeWrite(spw, {
    kind: 'op',
    op: { op: 'user.add', handle, name: handle, kind: 'agent', operator: 'spw', keys: [key.line] },
  });
  await setIdentity(solo.homes, 'acme', handle, key.priv);
  return solo.context({ as: handle, backlog: 'acme' });
}

const isBare = async (dir: string) =>
  (await git(['rev-parse', '--is-bare-repository'], { cwd: dir })).stdout.trim() === 'true';

test('a second identity without remote creates the hub and both copies sync through it', async () => {
  const agent = await addAgent();

  const { root, notices } = await ensureWorkingCopy(agent, 'claude-1');

  expect(notices).toEqual([`Lokaler Hub ${hubPath()} angelegt; ${solo.root} synct jetzt darüber`]);
  expect(await isBare(hubPath())).toBe(true);
  expect(await syncRemote(solo.root, 'origin')).toBe(hubPath());
  expect(await syncRemote(root, 'origin')).toBe(hubPath());
  const head = await revParse(solo.root, 'HEAD');
  expect(await revParse(root, 'HEAD')).toBe(head);
  expect(await readLocalState(solo.root, 'upstream')).toBe(head);
  expect(await readLocalState(root, 'upstream')).toBe(head);

  await executeWrite(agent, { kind: 'op', op: { op: 'issue.create', title: 'vom Agent' } });
  const pushed = (await syncNow(agent)).pushed;
  expect(pushed).toBe(await revParse(root, 'HEAD'));

  const r = await syncNow(spw);
  expect(r).toMatchObject({ fetched: 1, pushed: undefined });
  expect(await revParse(solo.root, 'HEAD')).toBe(pushed);

  // Eine dritte Identität klont vom vorhandenen Hub, ohne Hinweis.
  const third = await addAgent('claude-2');
  await syncNow(spw);
  const again = await ensureWorkingCopy(third, 'claude-2');
  expect(again.notices).toEqual([]);
  expect(await revParse(again.root, 'HEAD')).toBe(await revParse(solo.root, 'HEAD'));
});

test('two concurrent first clones share one hub', async () => {
  let release: () => void = () => {};
  const second = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = ensureHub(solo.homes, 'acme', solo.root, config, {
    beforeFinish: () => second,
  });
  const fast = await ensureHub(solo.homes, 'acme', solo.root, config);
  release();
  const late = await slow;

  expect(fast).toEqual({ hub: hubPath(), created: true });
  expect(late).toEqual({ hub: hubPath(), created: false });
  expect(await readdir(join(solo.homes.backeHome, 'tmp'))).toEqual([]);
  expect(await revParse(hubPath(), 'refs/heads/main')).toBe(await revParse(solo.root, 'HEAD'));
});

test('a source remote pointing to a non-bare sibling is moved to the hub', async () => {
  const sibling = join(await tempDir(), 'sibling');
  await git(['clone', '-q', solo.root, sibling], { cwd: dirname(sibling) });
  await git(['remote', 'add', 'origin', sibling], { cwd: solo.root });

  await ensureHub(solo.homes, 'acme', solo.root, config);

  expect(await syncRemote(solo.root, 'origin')).toBe(hubPath());
  expect(await revParse(solo.root, 'refs/remotes/origin/main')).toBe(
    await revParse(solo.root, 'HEAD'),
  );
});

test('a source remote pointing to a bare repository stays', async () => {
  const bare = join(await tempDir(), 'elsewhere.git');
  await git(['init', '--bare', '-q', bare], { cwd: dirname(bare) });
  await git(['remote', 'add', 'origin', bare], { cwd: solo.root });

  const r = await ensureHub(solo.homes, 'acme', solo.root, config);

  expect(r.created).toBe(true);
  expect(await syncRemote(solo.root, 'origin')).toBe(bare);
});
