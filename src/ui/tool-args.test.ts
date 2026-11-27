import { describe, expect, test } from 'vitest';
import { batchJson } from '../services/views.ts';
import { toolsFor } from '../tools/catalog.ts';
import type { BatchResultJson, ToolArgs, UiToolName } from './api.ts';

/** Jeder Key des Client-Typs mit einem Wert: `Required` lässt vergessene Keys nicht durch. */
const FULL: { [K in UiToolName]: Required<ToolArgs[K]> } = {
  issue_create: {
    title: 't',
    body: 'b',
    state: 'open',
    projects: ['p'],
    sprints: ['s'],
    repos: ['r'],
    assignee: 'ada',
    depends_on: ['bk-1'],
    parent: 'bk-2',
    props: { a: 1 },
  },
  issue_update: {
    id: 'bk-1',
    title: 't',
    body: 'b',
    add_projects: ['p'],
    rm_projects: ['p'],
    add_sprints: ['s'],
    rm_sprints: ['s'],
    add_deps: ['bk-2'],
    rm_deps: ['bk-3'],
    parent: null,
    assignee: null,
    props: { a: null },
  },
  issue_move: { id: 'bk-1', to: 'done', reason: 'r', blocked_by: ['bk-2'], force: true },
  issue_resume: { id: 'bk-1', reason: 'r' },
  issue_reopen: { id: 'bk-1', to: 'open', reason: 'r' },
  issue_rank: { id: 'bk-1', top: true, bottom: false, before: 'bk-2', after: 'bk-3', value: 1.5 },
  issue_claim: { id: 'bk-1' },
  issue_delete: { id: 'bk-1', force: true, children: 'orphan' },
  comment_add: { id: 'bk-1', body: 'b' },
  comment_edit: { id: 'bk-1', comment: '1', body: 'b' },
  comment_delete: { id: 'bk-1', comment: '1' },
  attachment_rm: { id: 'bk-1', name: 'a.png' },
  repo_locate: { name: 'acme' },
  project_create: { path: 'web', title: 'Web', lead: 'ada', body: 'b' },
  project_mv: { from: 'web', to: 'app' },
  project_rm: { path: 'web', reassign: 'app', detach: false },
  sprint_create: {
    slug: '2026-w47',
    title: 'W47',
    start: '2026-11-16',
    end: '2026-11-22',
    body: 'b',
  },
  sprint_close: { slug: '2026-w47', carry_over: '2026-w48' },
  repo_add: { url: 'git@example.com:a/w.git', name: 'w', ref: 'main', body: 'b' },
  repo_rm: { name: 'w' },
  repo_check: { names: ['w'], remote: true, fresh: true },
  user_add: { handle: 'ada', key: 'ssh-ed25519 AAAA', name: 'Ada', agent: false, operator: 'spw' },
  user_create_agent: { handle: 'bot', name: 'Bot' },
  user_revoke_key: { handle: 'ada', fingerprint: 'SHA256:abcdefgh' },
  user_rm: { handle: 'ada' },
  sync_now: {},
  batch: { ops: [{ op: 'issue.rank', id: 'bk-1', from: null, bottom: true }] },
};

describe('client tool args', () => {
  test.each(Object.keys(FULL))('%s args fit the catalog schema', (name) => {
    const def = toolsFor('ui', { allowDelete: true }).find((t) => t.name === name);
    expect(def, `${name} is a ui tool`).toBeDefined();
    expect(def?.input.safeParse(FULL[name as UiToolName]).success).toBe(true);
  });
});

describe('client tool results', () => {
  test('BatchResultJson has the keys and types of batchJson', () => {
    const full: Required<BatchResultJson> = {
      commit: 'c1',
      refs: { $a: 'bk-1' },
      ops: 2,
      notices: [{ code: 'settled_dependency', message: 'n' }],
      warnings: ['w'],
    };
    const json = batchJson({
      commit: 'c1',
      refs: { $a: 'bk-1' },
      ops: [{}, {}] as never,
      notices: [{ code: 'settled_dependency', message: 'n' }] as never,
      warnings: ['w'],
    });
    expect(Object.keys(json).sort()).toEqual(Object.keys(full).sort());
    expect(json).toEqual(full);
  });
});
