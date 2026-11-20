import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revParse, testBacklog } from '../../test/helpers/git.ts';
import { connectMcp } from '../../test/helpers/mcp.ts';
import { git } from '../git/exec.ts';
import { issueFile } from '../store/layout.ts';
import { propsArgs } from './write-tools.ts';

type Backlog = Awaited<ReturnType<typeof testBacklog>>;
type Mcp = Awaited<ReturnType<typeof connectMcp>>;

async function withMcp<T>(
  fn: (m: Mcp, b: Backlog) => Promise<T>,
  opts: Parameters<typeof connectMcp>[1] = {},
  backlog?: Backlog,
): Promise<T> {
  const b = backlog ?? (await testBacklog());
  const m = await connectMcp(b, opts);
  try {
    return await fn(m, b);
  } finally {
    await m.close();
  }
}

async function count(b: Backlog): Promise<number> {
  const { stdout } = await git(['rev-list', '--count', 'HEAD'], { cwd: b.root });
  return Number(stdout.trim());
}

/** Legt ein Issue an und liefert seine ID. */
async function create(m: Mcp, title = 'A'): Promise<string> {
  const r = await m.call('issue_create', { title });
  if (!('ok' in r)) throw new Error(JSON.stringify(r));
  return r.ok.id as string;
}

test('propsArgs turns values into JSON assignments and null into unset', () => {
  expect(propsArgs({ level: 3, tags: ['a'], s: 'x' }, true)).toEqual({
    props: ['level:=3', 'tags:=["a"]', 's:="x"'],
    unset: [],
  });
  expect(propsArgs({ level: null }, true)).toEqual({ props: [], unset: ['level'] });
  expect(() => propsArgs({ level: null }, false)).toThrow('null geht nur in issue_update');
});

test('props keys outside the key grammar are rejected, set and unset alike', () =>
  withMcp(async (m, b) => {
    const id = await create(m);
    const file = () => readFile(join(b.root, issueFile(id)), 'utf8');
    const before = await file();
    expect(await m.call('issue_update', { id, props: { 'a=b': 1 } })).toMatchObject({
      error: { code: 'validation', message: 'Ungültiger Property-Key »a=b«' },
    });
    expect(await m.call('issue_update', { id, props: { Bad: null } })).toMatchObject({
      error: { code: 'validation', message: 'Ungültiger Property-Key »Bad«' },
    });
    expect(await file()).toBe(before);
  }));

test('issue_create returns the outcome of backe issue create --json', () =>
  withMcp(async (m) => {
    const r = await m.call('issue_create', { title: 'Neu', body: 'Text' });
    if (!('ok' in r)) throw new Error(JSON.stringify(r));
    expect(r.ok.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(r.ok.op.op).toBe('issue.create');
    expect(r.ok.id).toMatch(/^bk-/);
  }));

test('issue_update applies props as an object and null removes', () =>
  withMcp(async (m, b) => {
    const id = await create(m);
    await m.call('issue_update', { id, props: { level: 3, tags: ['a'] } });
    const file = () => readFile(join(b.root, issueFile(id)), 'utf8');
    const first = await file();
    expect(first).toContain('  level: 3\n  tags: [a]\n');
    await m.call('issue_update', { id, props: { level: null } });
    const after = await file();
    expect(after).toContain('props:\n  tags: [a]\n');
    expect(after).not.toContain('level');
  }));

test('issue_update sets and removes the assignee', () =>
  withMcp(async (m, b) => {
    const id = await create(m);
    const set = await m.call('issue_update', { id, assignee: 'me' });
    if (!('ok' in set)) throw new Error(JSON.stringify(set));
    expect(set.ok.op.set.assignee.to).toBe('spw');
    const cleared = await m.call('issue_update', { id, assignee: null });
    if (!('ok' in cleared)) throw new Error(JSON.stringify(cleared));
    expect(await readFile(join(b.root, issueFile(id)), 'utf8')).not.toContain('assignee');
  }));

test('issue_update without changes is usage', () =>
  withMcp(async (m) => {
    const id = await create(m);
    const r = await m.call('issue_update', { id });
    expect(r).toMatchObject({ error: { code: 'usage', message: 'Nichts zu ändern' } });
  }));

test('contradictory parameters are usage errors and the server keeps serving', () =>
  withMcp(async (m) => {
    const id = await create(m);
    expect(await m.call('issue_rank', { id, top: true, before: id })).toMatchObject({
      error: { code: 'usage' },
    });
    expect(
      await m.call('attachment_add', { id, name: 'a.txt', url: 'https://x.y', text: 'x' }),
    ).toMatchObject({
      error: { code: 'usage', message: 'Genau eins von path, url, json, text angeben' },
    });
    expect(await m.call('issue_create', { title: 'X', props: { x: null } })).toMatchObject({
      error: { code: 'validation', message: 'Property »x«: null geht nur in issue_update' },
    });
    expect(await m.call('batch', { ops: [] })).toMatchObject({
      error: { code: 'usage', message: 'batch braucht mindestens eine Operation' },
    });
    expect(await m.call('issue_create', { title: 'Danach' })).toHaveProperty('ok');
  }));

test('a schema violation is rejected by the SDK with its own message', () =>
  withMcp(async (m) => {
    const r = await m.call('issue_create', { title: 5 });
    expect(r).toMatchObject({ error: { code: 'protocol' } });
    expect((r as { error: { message: string } }).error.message).toContain(
      'Invalid arguments for tool issue_create',
    );
  }));

test('an unknown parameter is rejected by the SDK and names the key', () =>
  withMcp(async (m, b) => {
    const head = await revParse(b.root, 'HEAD');
    const r = await m.call('issue_create', { title: 'X', project: ['p'] });
    expect(r).toMatchObject({ error: { code: 'protocol' } });
    const { message } = (r as { error: { message: string } }).error;
    expect(message).toContain('Invalid arguments for tool issue_create');
    expect(message).toContain('Unrecognized key: "project"');
    expect(await revParse(b.root, 'HEAD')).toBe(head);
    expect(await m.call('context_get', { prop: true })).toMatchObject({
      error: { code: 'protocol' },
    });
  }));

test('concurrent writes from one client all land', () =>
  withMcp(async (m, b) => {
    const id = await create(m);
    const before = await count(b);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => m.call('comment_add', { id, body: `K${i}` })),
    );
    const commits = results.map((r) => {
      if (!('ok' in r)) throw new Error(JSON.stringify(r));
      return r.ok.commit as string;
    });
    expect(new Set(commits).size).toBe(5);
    expect(await count(b)).toBe(before + 5);
  }));

test('writes with a commit schedule a background sync', async () => {
  const calls: unknown[] = [];
  const b = await testBacklog({ remote: true });
  await withMcp(
    async (m) => {
      const id = await create(m);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const same = await m.call('issue_move', { id, to: 'backlog' });
      expect(same).toMatchObject({ ok: { commit: null } });
      // Ein Schreib-Roundtrip der Warteschlange ohne Commit hat den Nachlauf schon durchlaufen.
      await Promise.resolve();
      expect(calls).toHaveLength(1);
      // Der Nachlauf ist nicht abgewartet; ein Roundtrip danach macht ihn sichtbar.
      await m.call('comment_add', { id: id, body: 'x' }).then(() => undefined);
      await vi.waitFor(() => expect(calls).toHaveLength(2));
    },
    { deps: { sync: { spawn: (a) => void calls.push(a) } } },
    b,
  );
});

test('batch writes one commit and returns refs', () =>
  withMcp(async (m, b) => {
    const before = await count(b);
    const r = await m.call('batch', {
      ops: [
        { op: 'issue.create', ref: '$a', title: 'A' },
        { op: 'comment.add', id: '$a', body: 'x' },
      ],
    });
    if (!('ok' in r)) throw new Error(JSON.stringify(r));
    expect(r.ok.refs.$a).toMatch(/^bk-/);
    expect(r.ok.ops).toBe(2);
    expect(await count(b)).toBe(before + 1);
  }));

/** Ein Batch mit genau `op`, der abgelehnt wird, ohne dass `HEAD` sich bewegt. */
async function rejected(m: Mcp, b: Backlog, op: Record<string, unknown>): Promise<void> {
  const head = await revParse(b.root, 'HEAD');
  const r = await m.call('batch', { ops: [{ op: 'comment.add', id: 'bk-x', body: 'x' }, op] });
  expect(r).toEqual({
    error: {
      code: 'validation',
      message: `Zeile 2: »${op.op as string}« gibt es im MCP-Modus nicht`,
      details: { line: 2 },
    },
  });
  expect(await revParse(b.root, 'HEAD')).toBe(head);
}

test('batch rejects issue.delete without allowDelete and takes it with', async () => {
  await withMcp(async (m, b) => {
    const id = await create(m);
    await rejected(m, b, { op: 'issue.delete', id });
    expect(await readFile(join(b.root, issueFile(id)), 'utf8')).toContain(id);
  });
  await withMcp(
    async (m) => {
      const id = await create(m);
      const r = await m.call('batch', { ops: [{ op: 'issue.delete', id }] });
      expect(r).toMatchObject({ ok: { ops: 1 } });
    },
    { allowDelete: true },
  );
});

test('batch rejects user, project, repo and removing ops before touching the backlog', () =>
  withMcp(async (m, b) => {
    const id = await create(m);
    await rejected(m, b, { op: 'user.add', handle: 'mallory', keys: ['ssh-ed25519 AAAA x'] });
    await rejected(m, b, { op: 'project.create', path: 'geheim' });
    await rejected(m, b, { op: 'repo.add', name: 'r', url: 'https://example.com/r.git' });
    await rejected(m, b, { op: 'comment.delete', id, comment: 'c-1' });
    await rejected(m, b, { op: 'attach.rm', id, name: 'a' });
    await rejected(m, b, { op: 'issue.claim', id });
    // Ohne String-`op` bleibt es bei der Meldung von `runBatch`.
    const r = await m.call('batch', { ops: [{ op: 5 }] });
    expect(r).toMatchObject({ error: { code: 'validation', details: { line: 1 } } });
    expect((r as { error: { message: string } }).error.message).not.toContain('MCP-Modus');
  }));

test('issue_delete exists only with allowDelete', async () => {
  await withMcp(async (m) => {
    const names = (await m.client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('issue_delete');
    expect(names).toContain('issue_create');
  });
  await withMcp(
    async (m) => {
      const names = (await m.client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('issue_delete');
      const id = await create(m);
      const r = await m.call('issue_delete', { id });
      if (!('ok' in r)) throw new Error(JSON.stringify(r));
      expect(r.ok.op.op).toBe('issue.delete');
    },
    { allowDelete: true },
  );
});

test('attachment_add reads path relative to the server cwd', () =>
  withMcp(async (m, b) => {
    await writeFile(join(b.root, 'notes.md'), '# Notizen\n');
    const id = await create(m);
    const r = await m.call('attachment_add', { id, name: 'notes', path: 'notes.md' });
    if (!('ok' in r)) throw new Error(JSON.stringify(r));
    expect(r.ok.op.op).toBe('attach.add');
    const missing = await m.call('attachment_add', { id, name: 'x', path: 'nope.md' });
    expect(missing).toMatchObject({ error: { code: 'not_found' } });
  }));

test('attachment_add takes text, json and url sources', () =>
  withMcp(async (m) => {
    const id = await create(m);
    for (const args of [
      { name: 't.txt', text: 'hallo' },
      { name: 'j', json: '{"a":1}' },
      { name: 'u', url: 'https://example.com' },
    ]) {
      const r = await m.call('attachment_add', { id, ...args });
      expect(r).toMatchObject({ ok: { op: { op: 'attach.add' } } });
    }
  }));

test('move, resume, reopen and rank return outcomes', () =>
  withMcp(async (m) => {
    const id = await create(m);
    const other = await create(m, 'B');
    await m.call('issue_rank', { id: other, top: true });
    expect(await m.call('issue_rank', { id, before: other })).toMatchObject({
      ok: { op: { op: 'issue.rank' } },
    });
    expect(await m.call('issue_rank', { id, value: 1.5 })).toMatchObject({
      error: { code: 'validation' },
    });
    await m.call('issue_move', { id, to: 'in_progress' });
    expect(
      await m.call('issue_move', { id, to: 'blocked', reason: 'wartet', blocked_by: [other] }),
    ).toMatchObject({
      ok: { op: { op: 'issue.move' } },
    });
    expect(await m.call('issue_resume', { id, reason: 'weiter' })).toMatchObject({
      ok: { op: { op: 'issue.resume' } },
    });
    await m.call('issue_move', { id, to: 'done' });
    expect(await m.call('issue_reopen', { id })).toMatchObject({
      ok: { op: { op: 'issue.reopen' } },
    });
  }));

test('every optional parameter reaches its service', () =>
  withMcp(
    async (m, b) => {
      const parent = await create(m, 'Eltern');
      const dep = await create(m, 'Dep');
      const r = await m.call('issue_create', {
        title: 'Voll',
        body: 'Text',
        state: 'todo',
        assignee: 'me',
        depends_on: [dep],
        parent,
        props: { n: 1 },
      });
      if (!('ok' in r)) throw new Error(JSON.stringify(r));
      const id = r.ok.id as string;
      const file = await readFile(join(b.root, issueFile(id)), 'utf8');
      expect(file).toContain(`parent: ${parent}`);
      expect(file).toContain('assignee: spw');
      const upd = await m.call('issue_update', {
        id,
        title: 'Neu',
        body: 'Anderer Text',
        add_deps: [parent],
        rm_deps: [dep],
        add_projects: [],
        rm_projects: [],
        add_sprints: [],
        rm_sprints: [],
        parent: null,
      });
      expect(upd).toMatchObject({ ok: { op: { op: 'issue.edit' } } });
      expect(await m.call('issue_rank', { id, bottom: true })).toHaveProperty('ok');
      expect(await m.call('issue_rank', { id, after: dep })).toMatchObject({
        error: { code: 'validation' },
      });
      expect(await m.call('issue_move', { id, to: 'cancelled', force: true })).toHaveProperty('ok');
      expect(await m.call('issue_reopen', { id, to: 'todo', reason: 'doch' })).toHaveProperty('ok');
      const del = await m.call('issue_delete', { id: parent, force: true, children: 'orphan' });
      expect(del).toMatchObject({ ok: { op: { op: 'issue.delete' } } });
    },
    { allowDelete: true },
  ));
