import { describe, expect, test } from 'vitest';
import { BackeError } from '../core/errors.ts';
import type { Operation } from '../ops/operation.ts';
import type { IssueListResult } from './issue-list.ts';
import { errorJson, issueListResultJson, noticeJson, outcomeJson } from './views.ts';

const op = { op: 'repo.rm', name: 'x' } as Operation;

describe('errorJson', () => {
  test('renames only the fixed detail keys', () => {
    const e = new BackeError('conflict', 'x', {
      hint: 'h',
      details: { exitCode: 4, props: { myKey: 1 } },
    });
    expect(errorJson(e)).toEqual({
      error: {
        code: 'conflict',
        message: 'x',
        hint: 'h',
        details: { exit_code: 4, props: { myKey: 1 } },
      },
    });
  });

  test('turns a foreign error into unexpected without a stack', () => {
    const out = errorJson(new Error('boom'));
    expect(out).toEqual({ error: { code: 'unexpected', message: 'Unerwarteter Fehler: boom' } });
    expect(JSON.stringify(out)).not.toContain('stack');
  });
});

describe('outcomeJson', () => {
  test('writes commit null and leaves out empty notices and warnings', () => {
    const out = outcomeJson({ commit: undefined, op, notices: [], warnings: [] });
    expect(JSON.parse(JSON.stringify(out))).toEqual({ commit: null, op });
  });

  test('uses ops instead of op for a multi-operation outcome', () => {
    const out = outcomeJson({ commit: 'abc', ops: [op], notices: [], warnings: [] });
    expect(JSON.parse(JSON.stringify(out))).toEqual({ commit: 'abc', ops: [op] });
  });
});

describe('noticeJson', () => {
  test('wraps a plain string as message', () => {
    expect(noticeJson('Hub angelegt')).toEqual({ message: 'Hub angelegt' });
  });

  test('keeps a notice unchanged', () => {
    const n = { code: 'claim_local', message: 'm', ids: ['bk-1'] } as const;
    expect(noticeJson({ ...n, ids: [...n.ids] })).toEqual(n);
  });
});

describe('issueListResultJson', () => {
  const issue = { id: 'bk-1', title: 'T', state: 'open' } as never;
  const r: IssueListResult = {
    header: {},
    items: [{ issue, openDeps: true }],
    truncated: false,
    problems: [],
  };

  test('picks only the requested fields per issue', () => {
    const out = issueListResultJson(r, ['id', 'open_deps']);
    expect(JSON.parse(JSON.stringify(out))).toEqual({ issues: [{ id: 'bk-1', open_deps: true }] });
  });

  test('rejects an unknown field as usage with the allowed list', () => {
    try {
      issueListResultJson(r, ['nope']);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BackeError);
      expect((err as BackeError).code).toBe('usage');
      expect((err as BackeError).details).toMatchObject({ unknown: ['nope'] });
      expect(((err as BackeError).details as { allowed: string[] }).allowed).toContain('open_deps');
    }
  });
});
