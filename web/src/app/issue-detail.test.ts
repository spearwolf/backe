import type { AttachmentListJson, IssueDetailJson } from '@backe/ui/api.ts';
import { ApiError } from '../data/api-client.ts';
import { Store } from '../data/store.ts';
import { testIssue, testPatch, testState, tid } from '../test/state.ts';
import { IssueDetailModel } from './issue-detail.ts';

const ID = tid(1);
const detailOf = (title: string): IssueDetailJson => {
  const { depends_on: _deps, ...issue } = testIssue(1, { title });
  return { ...issue, comments_count: 0 };
};
const NONE: AttachmentListJson = [];

type Call<T> = { resolve(v: T): void; reject(e: unknown): void };

/** Loader, die jede Anfrage offen halten, bis der Test antwortet. */
function setup(issues = [testIssue(1), testIssue(2)], over = {}) {
  const store = new Store();
  store.load(testState(issues, over));
  const issueCalls: Call<IssueDetailJson>[] = [];
  const attachCalls: Call<AttachmentListJson>[] = [];
  const model = new IssueDetailModel(store, ID, {
    issue: () => new Promise((resolve, reject) => issueCalls.push({ resolve, reject })),
    attachments: () => new Promise((resolve, reject) => attachCalls.push({ resolve, reject })),
  });
  const settle = async (title = 'T') => {
    issueCalls.at(-1)?.resolve(detailOf(title));
    attachCalls.at(-1)?.resolve(NONE);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { store, model, issueCalls, attachCalls, settle };
}

test('loads detail and attachments once', async () => {
  const { model, issueCalls, attachCalls, settle } = setup();
  expect(model.state()).toEqual({ status: 'loading' });
  expect([issueCalls.length, attachCalls.length]).toEqual([1, 1]);
  await settle('Eins');
  const s = model.state();
  expect(s.status === 'ready' && s.detail.title).toBe('Eins');
  expect([issueCalls.length, attachCalls.length]).toEqual([1, 1]);
  model.dispose();
});

test('a touch reloads and keeps the old data meanwhile', async () => {
  const { store, model, issueCalls, attachCalls, settle } = setup();
  await settle('alt');
  store.applyPatch(testPatch(2, { touched: [ID] }));
  expect([issueCalls.length, attachCalls.length]).toEqual([2, 2]);
  const s = model.state();
  expect(s.status === 'ready' && s.detail.title).toBe('alt');
  await settle('neu');
  const n = model.state();
  expect(n.status === 'ready' && n.detail.title).toBe('neu');
  model.dispose();
});

test('a patch on another issue does not reload', async () => {
  const { store, model, issueCalls } = setup();
  store.applyPatch(
    testPatch(2, { upsert: { issues: [testIssue(2, { title: 'x' })] }, touched: [tid(2)] }),
  );
  expect(issueCalls).toHaveLength(1);
  model.dispose();
});

test('stale detail answers are ignored', async () => {
  const { store, model, issueCalls, attachCalls } = setup();
  store.applyPatch(testPatch(2, { touched: [ID] }));
  issueCalls[1]?.resolve(detailOf('zweite'));
  attachCalls[1]?.resolve(NONE);
  await Promise.resolve();
  await Promise.resolve();
  issueCalls[0]?.resolve(detailOf('erste'));
  attachCalls[0]?.resolve(NONE);
  await Promise.resolve();
  await Promise.resolve();
  const s = model.state();
  expect(s.status === 'ready' && s.detail.title).toBe('zweite');
  model.dispose();
});

test('a 404 after delete is deleted', async () => {
  const { store, model, issueCalls } = setup();
  store.applyPatch(testPatch(2, { touched: [ID], remove: { issues: [ID] } }));
  issueCalls.at(-1)?.reject(new ApiError(404, 'not_found', 'weg'));
  await Promise.resolve();
  await Promise.resolve();
  expect(model.state()).toEqual({ status: 'deleted' });
  model.dispose();
});

test('a 404 for an issue the store still has is an error', async () => {
  const { model, issueCalls } = setup();
  issueCalls[0]?.reject(new ApiError(404, 'not_found', 'weg'));
  await Promise.resolve();
  await Promise.resolve();
  expect(model.state().status).toBe('error');
  model.dispose();
});

test('a missing issue in a loaded store is deleted', () => {
  const { model } = setup([testIssue(2)]);
  expect(model.state()).toEqual({ status: 'deleted' });
  model.dispose();
});

test('a broken issue is an error with the problem message', () => {
  const { model } = setup([testIssue(2)], {
    problems: [{ path: 'issues/x.md', message: 'kaputt', kind: 'issue', key: ID }],
  });
  const s = model.state();
  expect(s.status === 'error' && s.error.message).toBe('kaputt');
  model.dispose();
});

test('a problem of another entity kind with the same key is no broken issue', () => {
  const { model } = setup([testIssue(2)], {
    problems: [{ path: 'projects/x.yml', message: 'kaputt', kind: 'project', key: ID }],
  });
  expect(model.state()).toEqual({ status: 'deleted' });
  model.dispose();
});

test('relations update live', () => {
  const { store, model } = setup();
  expect(model.relations()?.dependents).toEqual([]);
  store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2, { depends_on: [ID] })] } }));
  expect(model.relations()?.dependents.map((r) => r.id)).toEqual([tid(2)]);
  model.dispose();
});
