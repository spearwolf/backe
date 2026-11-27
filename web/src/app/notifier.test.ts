import type { IssueJson, PatchJson } from '@backe/ui/api.ts';
import { expect, test, vi } from 'vitest';
import { hello, issue, patch, setup, state } from '../test/session-harness.ts';
import { m } from './notes.messages.ts';
import { attachNotifier, NOTE_SUMMARY_AFTER } from './notifier.ts';

const assigned = (n: number, title?: string): IssueJson => ({
  ...issue(n),
  assignee: 'spw',
  ...(title === undefined ? {} : { title }),
});

function actorsPatch(rev: number, issues: IssueJson[], by = ['claude-1']): PatchJson {
  return {
    ...patch(rev, issues),
    actors: Object.fromEntries(issues.map((i) => [i.id, by])),
  };
}

function conflict(id: string, subject: string) {
  return { id, subject, created: '2026-11-27T10:00:00Z', reason: 'x' };
}

function syncStatus(conflicts: unknown[]): Record<string, unknown> {
  return { remote: 'r', mode: 'auto', unpushed: 0, last_error: null, running: false, conflicts };
}

/** Sitzung mit geladenem Zustand und angehängtem Notifier. */
async function rig(over: { sync?: Record<string, unknown> | null; issues?: IssueJson[] } = {}) {
  const h = setup();
  const es = h.es() as NonNullable<ReturnType<typeof h.es>>;
  es.emitOpen();
  es.emitEvent('hello', hello(1));
  await h.answer({
    ...state(1, over.issues ?? [issue(1), issue(2), issue(3), issue(4), issue(5)]),
    sync: over.sync ?? null,
  });
  const show = vi.fn();
  const open = vi.fn();
  const off = attachNotifier(h.session, { me: 'spw', show, open });
  const emit = async (type: string, data: unknown) => {
    es.emitEvent(type, data);
    await h.flush();
  };
  return { ...h, show, open, off, emit };
}

test('a foreign assignment shows a note that opens the issue', async () => {
  const r = await rig();
  await r.emit('patch', actorsPatch(2, [assigned(1)]));
  expect(r.show).toHaveBeenCalledTimes(1);
  expect(r.show).toHaveBeenCalledWith({
    title: 'bk-t0001 Issue 1',
    body: m.assigned('claude-1'),
    tag: 'backe:main:bk-t0001',
    onClick: expect.any(Function),
  });
  r.show.mock.calls[0]?.[0].onClick();
  expect(r.open).toHaveBeenCalledWith('/b/main/issue/bk-t0001');
});

test('an empty title falls back to the bare id', async () => {
  const r = await rig();
  await r.emit('patch', actorsPatch(2, [assigned(1, '')]));
  expect(r.show.mock.calls[0]?.[0].title).toBe('bk-t0001');
});

test('three notes stay single, more become one summary', async () => {
  expect(NOTE_SUMMARY_AFTER).toBe(3);
  const r = await rig();
  await r.emit('patch', actorsPatch(2, [assigned(1), assigned(2), assigned(3)]));
  expect(r.show).toHaveBeenCalledTimes(3);
  r.show.mockClear();
  const four = [assigned(1), assigned(2), assigned(3), assigned(4)];
  await r.emit('patch', {
    ...patch(3, four),
    actors: {
      'bk-t0001': ['zed'],
      'bk-t0002': ['claude-1'],
      'bk-t0003': ['claude-1', 'zed'],
      'bk-t0004': ['claude-1'],
    },
  });
  expect(r.show).toHaveBeenCalledTimes(1);
  expect(r.show).toHaveBeenCalledWith({
    title: m.summaryTitle(4),
    body: m.summaryBody('claude-1, zed'),
    tag: 'backe:main:summary',
    onClick: expect.any(Function),
  });
  r.show.mock.calls[0]?.[0].onClick();
  expect(r.open).toHaveBeenCalledWith('/b/main/backlog?assignee=spw');
});

test('a new sync conflict shows a note, the first status none', async () => {
  const r = await rig({ sync: syncStatus([conflict('c1', 'Titel gegen Titel')]) });
  expect(r.show).not.toHaveBeenCalled();
  await r.emit(
    'sync',
    syncStatus([conflict('c1', 'Titel gegen Titel'), conflict('c2', 'Zweiter')]),
  );
  expect(r.show).toHaveBeenCalledTimes(1);
  expect(r.show).toHaveBeenCalledWith({
    title: m.syncConflict,
    body: 'Zweiter',
    tag: 'backe:main:c2',
    onClick: expect.any(Function),
  });
  r.show.mock.calls[0]?.[0].onClick();
  expect(r.open).toHaveBeenCalledWith('/b/main/settings/backlog');
  // Bekannte Konflikte melden sich nicht noch einmal.
  await r.emit(
    'sync',
    syncStatus([conflict('c1', 'Titel gegen Titel'), conflict('c2', 'Zweiter')]),
  );
  expect(r.show).toHaveBeenCalledTimes(1);
});

test('without a status at attach time the first status is the baseline', async () => {
  const r = await rig({ sync: null });
  await r.emit('sync', syncStatus([conflict('c1', 'Alt')]));
  expect(r.show).not.toHaveBeenCalled();
  await r.emit('sync', syncStatus([conflict('c1', 'Alt'), conflict('c2', 'Neu')]));
  expect(r.show).toHaveBeenCalledTimes(1);
  expect(r.show.mock.calls[0]?.[0].body).toBe('Neu');
});

test('detached notifier stays silent', async () => {
  const r = await rig({ sync: syncStatus([]) });
  r.off();
  await r.emit('patch', actorsPatch(2, [assigned(1)]));
  await r.emit('sync', syncStatus([conflict('c9', 'Spät')]));
  expect(r.show).not.toHaveBeenCalled();
});
