// @vitest-environment node
/**
 * Beziehungs-Parität: Die Listen des Tabs Issue, auf dem Store-Snapshot gerechnet, gleichen denen
 * von `showIssue` auf demselben Backlog.
 */
import type { ResolvedContext } from '@backe/context/resolve.ts';
import { type IssueDetail, showIssue } from '@backe/services/issue-show.ts';
import { stateJson } from '@backe/ui/state.ts';
import { writeOp } from '../../../test/helpers/context.ts';
import { testBacklog } from '../../../test/helpers/git.ts';
import { Store } from '../data/store.ts';
import { issueRelations } from './issue-relations.ts';

let ctx: ResolvedContext;
let store: Store;
const ids: string[] = [];
const shown: IssueDetail[] = [];

beforeAll(async () => {
  const b = await testBacklog();
  ctx = await b.context();
  const create = async (fields: Record<string, unknown>) => {
    const id = await writeOp(ctx, { op: 'issue.create', ...fields } as never);
    ids.push(id);
    return id;
  };
  const top = await create({ title: 'Top' });
  const mid = await create({ title: 'Mid', parent: top });
  const leaf = await create({ title: 'Leaf', parent: mid, assignee: 'spw' });
  const done = await create({ title: 'Done', parent: mid, state: 'done' });
  await create({ title: 'Later', parent: top, rank: 5 });
  await create({ title: 'Waits', depends_on: [leaf, done], assignee: 'spw' });
  await create({ title: 'Waits too', depends_on: [leaf] });
  await create({ title: 'Stuck', state: 'blocked', paused_from: 'todo', blocked_by: [leaf, done] });
  // Der Temp-Ordner verschwindet nach dem ersten Test, darum liest `showIssue` hier vorab.
  for (const id of ids) shown.push(await showIssue(ctx, id));
  store = new Store();
  store.load(await stateJson(ctx));
});

afterAll(() => store?.dispose());

test.each([0, 1, 2, 3, 4, 5, 6, 7])('relations of issue %i equal issue show', (n) => {
  const id = ids[n] as string;
  const d = shown[n] as IssueDetail;
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('store not loaded');
  const r = issueRelations(s, id);
  expect(r).toEqual({
    parents: d.parents,
    blockedBy: d.blockedBy,
    dependsOn: d.dependsOn,
    dependents: d.dependents,
    children: d.children,
    ...(d.progress === undefined ? {} : { progress: d.progress }),
  });
});
