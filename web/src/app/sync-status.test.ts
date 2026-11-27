import { syncOutcomeView, syncStatusView } from './sync-status.ts';

test('a sync status reads defensively', () => {
  expect(
    syncStatusView({
      remote: 'origin',
      mode: 'manual',
      unpushed: 3,
      last_attempt: '2026-11-20T10:00:00Z',
      last_error: 'kaputt',
      running: 'yes',
      conflicts: [
        { id: 'c1', created: 5, subject: null, reason: 'Text statt Objekt' },
        { id: 7 },
        'c3',
        { id: 'c4', created: '2026-11-20T10:00:00Z', subject: 's', reason: { message: 'm' } },
      ],
    }),
  ).toEqual({
    remote: 'origin',
    mode: 'manual',
    unpushed: 3,
    lastAttempt: '2026-11-20T10:00:00Z',
    lastSuccess: null,
    lastError: 'kaputt',
    running: false,
    conflicts: [
      { id: 'c1', created: null, subject: '', reason: 'Text statt Objekt' },
      { id: 'c4', created: '2026-11-20T10:00:00Z', subject: 's', reason: 'm' },
    ],
  });
  expect(syncStatusView({}).mode).toBe('');
});

test('a sync outcome reads the wire format and tolerates others', () => {
  expect(
    syncOutcomeView({
      fetched: 1,
      replayed: 2,
      pushed: 'a'.repeat(40),
      notices: [{ message: 'n1' }, 'n2', 3],
    }),
  ).toEqual({ skipped: false, fetched: 1, replayed: 2, pushed: 'aaaaaaa', notices: ['n1', 'n2'] });
  expect(syncOutcomeView({ fetched: 'x', pushed: 4 })).toEqual({
    skipped: false,
    fetched: 0,
    replayed: 0,
    pushed: '4',
    notices: [],
  });
  expect(syncOutcomeView({ skipped: 'no_remote' })).toEqual({ skipped: true, notices: [] });
  expect(syncOutcomeView(null)).toEqual({
    skipped: false,
    fetched: 0,
    replayed: 0,
    pushed: null,
    notices: [],
  });
});
