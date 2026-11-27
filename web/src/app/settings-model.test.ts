import type { UserJson } from '@backe/ui/api.ts';
import { testIssue, tid } from '../test/state.ts';
import {
  projectReferences,
  projectRows,
  repoReferences,
  settingsRights,
  sprintGroups,
} from './settings-model.ts';

test('repo references match by name with or without ref', () => {
  const issues = [
    testIssue(3, { repos: ['core@main', 'web'] }),
    testIssue(1, { repos: ['web'] }),
    testIssue(2, { repos: ['core'] }),
    testIssue(4, { repos: ['core-tools@main', 'corex'] }),
    testIssue(5),
  ];
  // Nach Rangfolge, nicht nach Eingabe; `core-tools` ist ein anderer Name.
  expect(repoReferences(issues, 'core')).toEqual([tid(2), tid(3)]);
  expect(repoReferences(issues, 'nope')).toEqual([]);
});

test('an unreadable repo entry refers to nothing', () => {
  expect(repoReferences([testIssue(1, { repos: ['Bad Name@x'] })], 'bad')).toEqual([]);
});

test('project rows form a tree with recursive open counts', () => {
  const projects = [
    { path: 'web/auth', title: 'Auth' },
    { path: 'api', title: 'API' },
    { path: 'web', title: 'Web', lead: 'spw' },
    // `-` liegt vor `/`: In reiner Zeichenordnung stünde `web-x` zwischen `web` und `web/auth`.
    { path: 'web-x', title: 'Web X' },
  ];
  const issues = [
    // Zwei Pfade desselben Zweigs zählen für `web` nur einmal.
    testIssue(1, { projects: ['web/auth', 'web'] }),
    testIssue(2, { projects: ['web/auth'], state: 'done' }),
    testIssue(3, { projects: ['api'], state: 'cancelled' }),
    testIssue(4),
  ];
  const rows = projectRows(projects, issues);
  expect(rows.map((r) => [r.project.path, r.depth, r.open, r.hasChildren])).toEqual([
    ['api', 0, 0, false],
    ['web', 0, 1, true],
    ['web/auth', 1, 1, false],
    ['web-x', 0, 0, false],
  ]);
});

test('project references are exact paths', () => {
  const issues = [
    testIssue(2, { projects: ['web'] }),
    testIssue(1, { projects: ['web/auth', 'web'] }),
    testIssue(3, { projects: ['web/auth'] }),
    testIssue(4, { projects: ['web-x'] }),
    testIssue(5),
  ];
  // Ein Unterprojekt nennt das Elternprojekt nicht; nach Rangfolge.
  expect(projectReferences(issues, 'web')).toEqual([tid(1), tid(2)]);
  expect(projectReferences(issues, 'nope')).toEqual([]);
});

test('sprint groups put open first by start descending', () => {
  const sprints = [
    { slug: 'b', title: 'B', start: '2026-11-01' },
    { slug: 'no-start', title: 'N' },
    { slug: 'a', title: 'A', start: '2026-11-01' },
    { slug: 'late', title: 'L', start: '2026-12-01' },
    { slug: 'old', title: 'O', start: '2026-01-01', closed: true },
    { slug: 'older', title: 'O2', closed: true },
    { slug: 'recent', title: 'R', start: '2026-10-01', closed: true },
  ];
  const { open, closed } = sprintGroups(sprints);
  expect(open.map((s) => s.slug)).toEqual(['late', 'a', 'b', 'no-start']);
  expect(closed.map((s) => s.slug)).toEqual(['recent', 'old', 'older']);
});

const spw: UserJson = { handle: 'spw', name: 'Spw', kind: 'human', admin: true };
const ana: UserJson = { handle: 'ana', name: 'Ana', kind: 'human', admin: false };
const bot: UserJson = { handle: 'bot', name: 'Bot', kind: 'agent', operator: 'ana', admin: false };
const users = [spw, ana, bot];
const config = { admins: ['spw'] };

test('rights follow the identity protection', () => {
  const as = (me: string | null, canWrite = true) =>
    settingsRights({ canWrite, me, users, config });

  const admin = as('spw');
  expect(admin.addHuman).toBe(true);
  expect(admin.addAgent).toBe('any');
  expect(admin.createAgent).toBe(true);
  expect(users.map((u) => admin.revokeKey(u))).toEqual([true, true, true]);
  // `ana` ist Operator von `bot`, `spw` ist Admin und ich selbst.
  expect(users.map((u) => admin.removeUser(u))).toEqual([false, false, true]);

  const member = as('ana');
  expect(member.addHuman).toBe(false);
  expect(member.addAgent).toBe('self');
  expect(member.createAgent).toBe(true);
  expect(users.map((u) => member.revokeKey(u))).toEqual([false, true, true]);
  expect(users.map((u) => member.removeUser(u))).toEqual([false, false, false]);

  // Ein Agent ändert nur sich selbst und legt niemanden an.
  const agent = as('bot');
  expect([agent.addHuman, agent.addAgent, agent.createAgent]).toEqual([false, false, false]);
  expect(users.map((u) => agent.revokeKey(u))).toEqual([false, false, true]);
  expect(users.map((u) => agent.removeUser(u))).toEqual([false, false, false]);

  for (const none of [as('spw', false), as(null)]) {
    expect([none.addHuman, none.addAgent, none.createAgent]).toEqual([false, false, false]);
    expect(users.some((u) => none.revokeKey(u) || none.removeUser(u))).toBe(false);
  }
});

test('an agent listed in admins is no admin', () => {
  const rights = settingsRights({
    canWrite: true,
    me: 'bot',
    users,
    config: { admins: ['spw', 'bot'] },
  });
  expect(rights.addHuman).toBe(false);
  expect(rights.addAgent).toBe(false);
  expect(rights.revokeKey(ana)).toBe(false);
  expect(rights.removeUser(ana)).toBe(false);
  // Ein Handle in `admins` ohne User-Datei ist auch keiner.
  const ghost = settingsRights({
    canWrite: true,
    me: 'ghost',
    users,
    config: { admins: ['ghost'] },
  });
  expect([ghost.addHuman, ghost.addAgent, ghost.createAgent]).toEqual([false, false, false]);
});
