/**
 * Der Ablauf eines Agents aus backe.md §2.19 über alle Türen des MCP-Servers: anlegen, das
 * nächste Issue holen, claimen, kommentieren, in den Review schieben, nachlesen. Hintergrund-Starts
 * landen in einem injizierten `spawn`, Backoffs schlafen nicht.
 */
import { parseOpTrailer } from '../../src/ops/operation.ts';
import type { SyncDeps } from '../../src/services/sync.ts';
import { logTrailers, revParse, testBacklog } from '../helpers/git.ts';
import { type CallResult, connectMcp } from '../helpers/mcp.ts';

// biome-ignore lint/suspicious/noExplicitAny: Tests greifen ohne Narrowing in das Ergebnis.
function ok(r: CallResult): any {
  if (!('ok' in r)) throw new Error(JSON.stringify(r));
  return r.ok;
}

test('create → next → claim → comment → move → review', async () => {
  const b = await testBacklog({ remote: true });
  const sync: SyncDeps = { sleep: async () => {}, spawn: () => {} };
  const m = await connectMcp(b, { deps: { sync, claim: sync } });
  try {
    const created = ok(await m.call('issue_create', { title: 'Login reparieren' }));
    const id = created.id as string;
    expect(ok(await m.call('issue_next'))).toHaveProperty('issue.id', id);
    const claimed = ok(await m.call('issue_claim', { id }));
    expect(claimed.commit).toBe(await revParse(b.remote as string, 'refs/heads/main'));
    ok(await m.call('comment_add', { id, body: 'Ursache gefunden' }));
    ok(await m.call('issue_move', { id, to: 'review' }));
    const issue = ok(await m.call('issue_get', { id }));
    expect(issue).toMatchObject({ id, state: 'review', assignee: 'spw' });
    expect(issue.comments_count).toBeGreaterThanOrEqual(1);
    const ops = (await logTrailers(b.root)).map((c) => {
      const t = c.op === undefined ? undefined : parseOpTrailer(c.op);
      return t?.kind === 'op' ? t.op.op : t?.kind;
    });
    expect(ops.slice(0, 4)).toEqual(['issue.move', 'comment.add', 'issue.claim', 'issue.create']);
  } finally {
    await m.close();
  }
});
