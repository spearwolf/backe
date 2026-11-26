import type { SyncStatus } from '../services/background.ts';
import { syncStatusJson } from '../services/views.ts';
import { type SyncLineInput, syncLineParts } from './sync-line.ts';

const input = (over: Partial<SyncLineInput> = {}): SyncLineInput => ({
  remote: 'git@example.org:team/backlog.git',
  mode: 'auto',
  unpushed: 0,
  last_error: null,
  conflicts: [],
  ...over,
});

describe('syncLineParts', () => {
  it('nothing open yields no parts', () => {
    expect(syncLineParts(input())).toEqual({});
    expect(syncLineParts(input({ last_error: undefined }))).toEqual({});
  });

  it('unpushed counts only with a remote and manual mode or an error', () => {
    expect(syncLineParts(input({ unpushed: 3 }))).toEqual({});
    expect(syncLineParts(input({ unpushed: 3, mode: 'manual' }))).toEqual({ unpushed: 3 });
    expect(syncLineParts(input({ unpushed: 2, last_error: { message: 'boom' } }))).toEqual({
      unpushed: 2,
      failed: 'boom',
    });
    expect(syncLineParts(input({ unpushed: 3, mode: 'manual', remote: null }))).toEqual({});
    expect(syncLineParts(input({ unpushed: 3, mode: 'manual', remote: undefined }))).toEqual({});
    expect(syncLineParts(input({ unpushed: 0, mode: 'manual' }))).toEqual({});
  });

  it('conflicts and failure are reported', () => {
    expect(syncLineParts(input({ conflicts: [{}, {}] }))).toEqual({ conflicts: 2 });
    expect(syncLineParts(input({ last_error: { message: 'push rejected' } }))).toEqual({
      failed: 'push rejected',
    });
  });

  it('accepts the sync status json', () => {
    const status: SyncStatus = {
      remote: undefined,
      mode: 'manual',
      unpushed: 4,
      running: false,
      state: {},
      conflicts: [],
    };
    expect(syncLineParts(syncStatusJson(status) as SyncLineInput)).toEqual({});
    const withRemote = { ...status, remote: 'git@example.org:x.git' };
    expect(syncLineParts(syncStatusJson(withRemote) as SyncLineInput)).toEqual({ unpushed: 4 });
  });
});
