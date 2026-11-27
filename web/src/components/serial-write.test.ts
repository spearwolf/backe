import type { BoardPlan } from '../app/board-move.ts';
import { flush, id as iid, issue, patch, setup, state } from '../test/writes-harness.ts';
import { sendBoardMove } from './board/board-write.ts';
import { rank } from './rank-write.ts';
import { serialWrite } from './serial-write.ts';

const toReview = (from: string, to: string): BoardPlan => ({
  kind: 'change',
  state: { to: 'review', tool: 'issue_move', needsBlockedBy: false },
  lane: { field: 'sprints', remove: [from], add: [to] },
});

test('board moves and ranks share one queue', async () => {
  const { store, writes, calls, answer, dispose } = setup();
  store.load(state(1, 'h1', [issue(1, { sprints: ['s1'], rank: 1000 }), issue(2, { rank: 2000 })]));

  const first = sendBoardMove(store, writes, iid(1), {
    kind: 'change',
    state: { to: 'in_progress', tool: 'issue_move', needsBlockedBy: false },
    lane: { field: 'sprints', remove: ['s1'], add: ['s2'] },
  });
  expect(calls.map((c) => c.args)).toEqual([
    {
      ops: [
        { op: 'issue.edit', id: iid(1), add: { sprints: ['s2'] }, remove: { sprints: ['s1'] } },
        { op: 'issue.move', id: iid(1), from: 'todo', to: 'in_progress' },
      ],
    },
  ]);
  expect(store.issues.get(iid(1)).value).toMatchObject({ state: 'in_progress', sprints: ['s2'] });

  // Ein Umsortieren und ein zweiter Board-Zug warten hinter dem ersten; ihre Vorschau steht sofort.
  rank(store, writes, iid(1), { after: iid(2) });
  const second = sendBoardMove(store, writes, iid(1), toReview('s2', 's3'));
  expect(calls).toHaveLength(1);
  expect(store.issues.get(iid(1)).value).toMatchObject({ state: 'review', sprints: ['s3'] });

  await answer({ commit: 'c1' });
  await expect(first).resolves.toEqual({ commit: 'c1' });
  // Die Antwort allein reicht nicht: Erst mit dem Patch steht der Serverstand des ersten Zugs.
  expect(calls).toHaveLength(0);
  store.applyPatch(
    patch(2, 'c1', [issue(1, { state: 'in_progress', sprints: ['s2'], rank: 1000 })]),
  );
  await flush();
  expect(calls.map((c) => [c.name, c.args])).toEqual([
    ['issue_rank', { id: iid(1), after: iid(2) }],
  ]);

  await answer({ commit: 'c2' });
  expect(calls).toHaveLength(0);
  store.applyPatch(
    patch(3, 'c2', [issue(1, { state: 'in_progress', sprints: ['s2'], rank: 3000 })]),
  );
  await flush();
  // Der zweite Board-Zug rechnet beim Senden: `from` ist der Stand des Servers, nicht der Vorschau.
  expect(calls.map((c) => [c.name, c.args])).toEqual([
    [
      'batch',
      {
        ops: [
          { op: 'issue.edit', id: iid(1), add: { sprints: ['s3'] }, remove: { sprints: ['s2'] } },
          { op: 'issue.move', id: iid(1), from: 'in_progress', to: 'review' },
        ],
      },
    ],
  ]);
  expect(store.issues.get(iid(1)).value).toMatchObject({ state: 'review', sprints: ['s3'] });
  await answer({ commit: null });
  await expect(second).resolves.toEqual({ commit: null });
  dispose();
});

test('a write plans at once, a queued one plans again on sending', async () => {
  const { writes, calls, answer, dispose } = setup();
  const seen: boolean[] = [];
  const plan = (replan: boolean) => {
    seen.push(replan);
    return { call: { name: 'issue_claim' as const, args: { id: iid(1) } } };
  };
  void serialWrite(writes, { plan });
  void serialWrite(writes, { plan });
  expect(seen).toEqual([false]);
  await answer({ commit: null });
  expect(seen).toEqual([false, true]);
  expect(calls).toHaveLength(1);
  await answer({ commit: null });
  // Ohne offenen Vorgänger rechnet der nächste wieder sofort und ohne Neuplanung.
  void serialWrite(writes, { plan });
  expect(seen).toEqual([false, true, false]);
  dispose();
});

test('a queued board move whose issue vanished goes out with the state from before', async () => {
  const { store, writes, calls, answer, dispose } = setup();
  store.load(state(1, 'h1', [issue(1, { sprints: ['s1'] }), issue(2)]));
  rank(store, writes, iid(2), { top: true });
  const sent = sendBoardMove(store, writes, iid(1), toReview('s1', 's2'));
  expect(calls).toHaveLength(1);
  // Während der Zug wartet, löscht ein Patch das Issue beim Server.
  store.applyPatch({ rev: 2, head: 'h2', upsert: {}, remove: { issues: [iid(1)] } });
  await answer({ commit: null });
  // Der Zug geht trotzdem hinaus, mit dem Stand von vorher; `not_found` meldet der Server.
  expect(calls.map((c) => [c.name, c.args])).toEqual([
    [
      'batch',
      {
        ops: [
          { op: 'issue.edit', id: iid(1), add: { sprints: ['s2'] }, remove: { sprints: ['s1'] } },
          { op: 'issue.move', id: iid(1), from: 'todo', to: 'review' },
        ],
      },
    ],
  ]);
  calls.shift()?.reject(new Error('not_found'));
  await expect(sent).rejects.toMatchObject({ name: 'ApiError' });
  dispose();
});

test('a board move for a vanished issue sends nothing', () => {
  const { store, writes, calls, dispose } = setup();
  expect(sendBoardMove(store, writes, 'bk-gone', toReview('s1', 's2'))).toBeUndefined();
  expect(sendBoardMove(store, writes, 'bk-gone', { kind: 'rank', pos: { top: true } })).toBe(
    undefined,
  );
  expect(calls).toHaveLength(0);
  dispose();
});

test('a rejected board move rejects for the caller and drops its preview', async () => {
  const { store, writes, calls, dispose } = setup();
  const sent = sendBoardMove(store, writes, iid(1), {
    kind: 'change',
    state: { to: 'done', tool: 'issue_move', needsBlockedBy: false },
  });
  expect(store.issues.get(iid(1)).value?.state).toBe('done');
  calls.shift()?.reject(new Error('nope'));
  await expect(sent).rejects.toMatchObject({ name: 'ApiError' });
  expect(store.issues.get(iid(1)).value?.state).toBe('todo');
  // Keine Fehlerfläche von sich aus: Was mit der Ablehnung geschieht, entscheidet der Aufrufer.
  expect(writes.failures.value).toEqual([]);
  dispose();
});
