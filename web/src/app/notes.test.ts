import type { IssueJson, PatchJson } from '@backe/ui/api.ts';
import { describe, expect, it } from 'vitest';
import { issue } from '../test/session-harness.ts';
import { conflictNotes, issueNotes } from './notes.ts';

const me = 'spw';
const mine = (n: number, extra: Partial<IssueJson> = {}): IssueJson => ({
  ...issue(n),
  assignee: me,
  ...extra,
});
const lookup = (...issues: IssueJson[]) => {
  const byId = new Map(issues.map((i) => [i.id, i]));
  return (id: string) => byId.get(id);
};
const patchOf = (p: Partial<PatchJson>): PatchJson => ({
  rev: 2,
  head: 'h2',
  upsert: {},
  remove: {},
  ...p,
});

describe('issueNotes', () => {
  it('an issue assigned to me by someone else', () => {
    const p = patchOf({ upsert: { issues: [mine(1)] }, actors: { 'bk-t0001': ['claude-1'] } });
    expect(issueNotes(p, lookup(issue(1)), me)).toEqual([
      { kind: 'assigned', id: 'bk-t0001', title: 'Issue 1', by: ['claude-1'] },
    ]);
  });

  it('someone else changes or comments my issue', () => {
    const upserted = patchOf({
      upsert: { issues: [mine(1, { title: 'Neu' })] },
      actors: { 'bk-t0001': ['claude-1'] },
    });
    expect(issueNotes(upserted, lookup(mine(1)), me)).toEqual([
      { kind: 'changed', id: 'bk-t0001', title: 'Neu', by: ['claude-1'] },
    ]);
    const touched = patchOf({ touched: ['bk-t0001'], actors: { 'bk-t0001': ['claude-1'] } });
    expect(issueNotes(touched, lookup(mine(1)), me)).toEqual([
      { kind: 'changed', id: 'bk-t0001', title: 'Issue 1', by: ['claude-1'] },
    ]);
  });

  it('my issue deleted or reassigned by someone else', () => {
    const removed = patchOf({ remove: { issues: ['bk-t0001'] }, actors: { 'bk-t0001': ['x'] } });
    expect(issueNotes(removed, lookup(mine(1)), me)).toEqual([
      { kind: 'deleted', id: 'bk-t0001', title: 'Issue 1', by: ['x'] },
    ]);
    const away = patchOf({
      upsert: { issues: [mine(1, { assignee: 'claude-1' })] },
      actors: { 'bk-t0001': ['claude-1'] },
    });
    expect(issueNotes(away, lookup(mine(1)), me)).toEqual([
      { kind: 'changed', id: 'bk-t0001', title: 'Issue 1', by: ['claude-1'] },
    ]);
  });

  it('own changes and loads are never notes', () => {
    const own = patchOf({ upsert: { issues: [mine(1)] }, actors: { 'bk-t0001': ['spw'] } });
    expect(issueNotes(own, lookup(issue(1)), me)).toEqual([]);
    expect(issueNotes(patchOf({ upsert: { issues: [mine(1)] } }), lookup(issue(1)), me)).toEqual(
      [],
    );
    const foreign = patchOf({ upsert: { issues: [issue(1)] }, actors: { 'bk-t0001': ['x'] } });
    expect(issueNotes(foreign, lookup(issue(1)), me)).toEqual([]);
  });

  it('a new issue assigned to me by someone else', () => {
    const p = patchOf({ upsert: { issues: [mine(1)] }, actors: { 'bk-t0001': ['x'] } });
    expect(issueNotes(p, lookup(), me)).toEqual([
      { kind: 'assigned', id: 'bk-t0001', title: 'Issue 1', by: ['x'] },
    ]);
  });

  it('upsert and remove of the same id in one patch is a deletion if it was mine', () => {
    const p = patchOf({
      upsert: { issues: [mine(1)] },
      remove: { issues: ['bk-t0001'] },
      actors: { 'bk-t0001': ['x'] },
    });
    expect(issueNotes(p, lookup(mine(1)), me)).toEqual([
      { kind: 'deleted', id: 'bk-t0001', title: 'Issue 1', by: ['x'] },
    ]);
  });

  it('ids unknown to the store give no note', () => {
    const touched = patchOf({ touched: ['bk-t0001'], actors: { 'bk-t0001': ['x'] } });
    expect(issueNotes(touched, lookup(), me)).toEqual([]);
    const removed = patchOf({ remove: { issues: ['bk-t0001'] }, actors: { 'bk-t0001': ['x'] } });
    expect(issueNotes(removed, lookup(), me)).toEqual([]);
  });

  it('an empty title is kept', () => {
    const p = patchOf({ touched: ['bk-t0001'], actors: { 'bk-t0001': ['x'] } });
    expect(issueNotes(p, lookup(mine(1, { title: '' })), me)).toEqual([
      { kind: 'changed', id: 'bk-t0001', title: '', by: ['x'] },
    ]);
  });

  it('by is sorted, deduplicated and without me; notes sorted by id', () => {
    const p = patchOf({
      touched: ['bk-t0002', 'bk-t0001'],
      actors: { 'bk-t0002': ['b', 'spw', 'a', 'b'], 'bk-t0001': ['z'] },
    });
    expect(issueNotes(p, lookup(mine(1), mine(2)), me)).toEqual([
      { kind: 'changed', id: 'bk-t0001', title: 'Issue 1', by: ['z'] },
      { kind: 'changed', id: 'bk-t0002', title: 'Issue 2', by: ['a', 'b'] },
    ]);
  });
});

describe('conflictNotes', () => {
  const conflict = (id: string) => ({ id, subject: `S ${id}`, reason: 'r' });

  it('new conflicts only', () => {
    const sync = { conflicts: [conflict('a'), conflict('b')] };
    const first = conflictNotes(new Set(), sync);
    expect(first.notes).toEqual([
      { kind: 'conflict', id: 'a', title: 'S a' },
      { kind: 'conflict', id: 'b', title: 'S b' },
    ]);
    expect(first.known).toEqual(new Set(['a', 'b']));
    expect(conflictNotes(first.known, sync).notes).toEqual([]);
    expect(conflictNotes(new Set(['a']), { conflicts: [conflict('b')] }).known).toEqual(
      new Set(['a', 'b']),
    );
    expect(conflictNotes(new Set(['a']), null)).toEqual({ notes: [], known: new Set(['a']) });
    expect(conflictNotes(new Set(), null)).toEqual({ notes: [], known: new Set() });
  });

  it('a resolved conflict that returns under the same id does not notify again', () => {
    const gone = conflictNotes(new Set(['a']), { conflicts: [] });
    expect(conflictNotes(gone.known, { conflicts: [conflict('a')] }).notes).toEqual([]);
  });
});
