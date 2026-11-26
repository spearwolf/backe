import { describe, expect, test } from 'vitest';
import { toolsFor } from '../tools/catalog.ts';
import type { ToolArgs, UiToolName } from './api.ts';

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
};

describe('client tool args', () => {
  test.each(Object.keys(FULL))('%s args fit the catalog schema', (name) => {
    const def = toolsFor('ui', { allowDelete: true }).find((t) => t.name === name);
    expect(def?.input.safeParse(FULL[name as UiToolName]).success).toBe(true);
  });
});
