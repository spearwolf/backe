// @vitest-environment node
/**
 * Nachbarschafts-Parität: Die direkten Nachbarn der Mitte im Abschnitt Abhängigkeiten, auf dem
 * Store-Snapshot gerechnet, gleichen den Listen von `showIssue` auf demselben Backlog.
 */
import type { ResolvedContext } from '@backe/context/resolve.ts';
import { type IssueDetail, showIssue } from '@backe/services/issue-show.ts';
import { stateJson } from '@backe/ui/state.ts';
import { writeOp } from '../../../test/helpers/context.ts';
import { testBacklog } from '../../../test/helpers/git.ts';
import { Store } from '../data/store.ts';
import { dependentsOf, prerequisitesOf } from './dep-graph.ts';

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
  const first = await create({ title: 'First' });
  const second = await create({ title: 'Second', rank: 5 });
  const done = await create({ title: 'Done', state: 'done' });
  const waits = await create({ title: 'Waits', depends_on: [first, second, done] });
  await create({ title: 'Waits too', depends_on: [waits, first] });
  await create({
    title: 'Stuck',
    state: 'blocked',
    paused_from: 'todo',
    blocked_by: [first, done],
    depends_on: [second],
  });
  // Der Temp-Ordner verschwindet nach dem ersten Test, darum liest `showIssue` hier vorab.
  for (const id of ids) shown.push(await showIssue(ctx, id));
  store = new Store();
  store.load(await stateJson(ctx));
});

afterAll(() => store?.dispose());

test.each([0, 1, 2, 3, 4, 5])('neighbours of issue %i equal issue show', (n) => {
  const id = ids[n] as string;
  const d = shown[n] as IssueDetail;
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('store not loaded');
  const ofKind = (list: { id: string; kind: string }[], kind: string) =>
    list.filter((x) => x.kind === kind).map((x) => x.id);
  const up = prerequisitesOf(s, id, false);
  expect(up.map((x) => x.id)).toEqual([...d.dependsOn, ...d.blockedBy].map((x) => x.id));
  expect(ofKind(up, 'depends_on')).toEqual(d.dependsOn.map((x) => x.id));
  expect(ofKind(dependentsOf(s, id, false), 'depends_on')).toEqual(d.dependents.map((x) => x.id));
});
