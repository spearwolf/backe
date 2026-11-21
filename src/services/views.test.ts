import { describe, expect, test } from 'vitest';
import { BackeError } from '../core/errors.ts';
import type { Operation } from '../ops/operation.ts';
import type { IssueListResult } from './issue-list.ts';
import {
  attachmentJson,
  batchJson,
  contextJson,
  errorJson,
  issueDetailJson,
  issueListResultJson,
  issueShowJson,
  nextJson,
  noticeJson,
  outcomeJson,
  pickFields,
  repoLocateJson,
  sprintShowJson,
  syncJson,
  toBackeError,
} from './views.ts';

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

describe('toBackeError', () => {
  test('keeps a BackeError and wraps anything else', () => {
    const e = new BackeError('conflict', 'x');
    expect(toBackeError(e)).toBe(e);
    expect(toBackeError('s').code).toBe('unexpected');
    expect(toBackeError('s').message).toBe('Unerwarteter Fehler: s');
  });
});

/** Was auf dem Draht ankommt: `undefined` fällt weg. */
const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const issue = { id: 'bk-1', title: 'T', state: 'open' } as never;

describe('nextJson', () => {
  const r = { header: { project: 'p' }, issue, resumed: false, openDeps: true, notices: [] };

  test('without a claim has no commit or attempts', () => {
    expect(wire(nextJson(r, { notices: [], warnings: [] }))).toEqual({
      context: { project: 'p' },
      issue: { id: 'bk-1', title: 'T', state: 'open', open_deps: true },
      resumed: false,
    });
  });

  test('with a claim adds commit (null when none) and attempts', () => {
    const out = wire(
      nextJson(r, {
        claimed: { commit: undefined, attempts: ['a'] },
        notices: [{ code: 'claim_local', message: 'm', ids: [] }],
        warnings: ['w'],
      }),
    );
    expect(out).toMatchObject({ commit: null, attempts: ['a'], warnings: ['w'] });
    expect(out).toHaveProperty('notices');
  });

  test('with fields keeps only those', () => {
    const out = nextJson(r, { notices: [], warnings: [], fields: ['id'] });
    expect(wire(out)).toMatchObject({ issue: { id: 'bk-1' } });
    expect((out.issue as object) && Object.keys(out.issue as object)).toEqual(['id']);
  });
});

describe('attachmentJson', () => {
  test('url, file and path override', () => {
    expect(attachmentJson({ name: 'n', url: 'u' })).toEqual({ name: 'n', url: 'u' });
    const f = { name: 'n', file: 'f', path: '/p', size: 3 };
    expect(attachmentJson(f)).toEqual({ name: 'n', file: 'f', size: 3, path: '/p' });
    expect(attachmentJson(f, '/q')).toEqual({ name: 'n', file: 'f', size: 3, path: '/q' });
  });
});

describe('sprintShowJson', () => {
  test('flattens the sprint and groups issues, omitting empty context and body', () => {
    const out = sprintShowJson('s1', {
      header: {},
      sprint: { title: 'S' } as never,
      body: '',
      groups: [{ state: 'todo', items: [{ issue, openDeps: false }] }],
    });
    expect(wire(out)).toEqual({
      slug: 's1',
      title: 'S',
      groups: [{ state: 'todo', issues: [{ id: 'bk-1', title: 'T', state: 'open' }] }],
    });
  });
});

describe('syncJson', () => {
  test('pushed undefined becomes null, empty notices are omitted', () => {
    const out = {
      fetched: 1,
      replayed: 0,
      conflicts: [],
      pushed: undefined,
      rounds: 1,
      notices: [],
    };
    expect(wire(syncJson(out))).toEqual({
      fetched: 1,
      replayed: 0,
      conflicts: [],
      pushed: null,
      rounds: 1,
    });
  });
});

describe('contextJson', () => {
  test('renames canWrite to can_write', () => {
    const info = {
      backlog: { value: 'b' },
      user: { value: 'u', canWrite: true },
      project: {},
      sprint: {},
      repo: {},
    } as never;
    const out = contextJson(info) as { user: Record<string, unknown> };
    expect(out.user).toEqual({ value: 'u', can_write: true });
  });
});

describe('repoLocateJson', () => {
  test('omits default_ref when absent', () => {
    const out = repoLocateJson({ name: 'r', url: 'u', canonical: 'c', path: '/p' });
    expect(wire(out)).toEqual({ name: 'r', url: 'u', canonical: 'c', path: '/p' });
    expect(
      wire(repoLocateJson({ name: 'r', url: 'u', canonical: 'c', defaultRef: 'm', path: '/p' })),
    ).toMatchObject({ default_ref: 'm' });
  });
});

describe('issueDetailJson', () => {
  const base = {
    issue,
    body: '',
    raw: '',
    parents: [],
    blockedBy: [],
    dependsOn: [],
    dependents: [],
    children: [],
    commentsCount: 0,
    comments: [],
    rawComments: [],
    notices: [],
  };

  test('omits empty lists and body but keeps comments_count', () => {
    expect(wire(issueDetailJson(base))).toEqual({
      id: 'bk-1',
      title: 'T',
      state: 'open',
      comments_count: 0,
    });
  });

  test('fills body and lists when present', () => {
    const out = wire(
      issueDetailJson({ ...base, body: 'b', parents: [{ id: 'bk-0' }] as never }),
    ) as object;
    expect(out).toMatchObject({ body: 'b', parents: [{ id: 'bk-0' }] });
  });

  test('issueShowJson is the detail view, cut to the requested fields', () => {
    expect(issueShowJson(base)).toEqual(issueDetailJson(base));
    expect(wire(issueShowJson(base, ['state', 'id', 'body']))).toEqual({
      state: 'open',
      id: 'bk-1',
    });
    expect(() => issueShowJson(base, ['bogus'])).toThrow('Unbekannte Felder');
  });
});

describe('batchJson', () => {
  test('reports the op count, not the ops', () => {
    const out = batchJson({
      commit: undefined,
      refs: { a: 'bk-1' },
      ops: [op, op],
      notices: [],
      warnings: [],
    });
    expect(wire(out)).toEqual({ commit: null, refs: { a: 'bk-1' }, ops: 2 });
  });
});

describe('pickFields', () => {
  test('keeps request order and drops undefined values', () => {
    const out = pickFields({ a: 1, b: undefined, c: 3 }, ['c', 'b', 'a'], ['a', 'b', 'c']);
    expect(Object.keys(out)).toEqual(['c', 'a']);
  });
});
