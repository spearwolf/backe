import { I, snap } from '../../test/helpers/snapshot.ts';
import {
  diffTables,
  entityLists,
  entityTable,
  needsFullReload,
  touchedIssues,
  watchedPath,
} from './delta.ts';

test('an unchanged table is no patch', () => {
  const s = snap({ issues: [{ id: I(1) }], projects: ['web'] });
  expect(diffTables(entityTable(s), entityTable(s))).toBeUndefined();
});

test('changed and new entities are upserts, missing ones removes', () => {
  const a = snap({ issues: [{ id: I(1) }, { id: I(2) }], sprints: ['2026-w47'] });
  const b = snap({
    issues: [{ id: I(1), title: 'Neu' }, { id: I(3) }],
    sprints: [],
  });
  const patch = diffTables(entityTable(a), entityTable(b));
  expect(patch?.upsert.issues?.map((i) => [i.id, i.title])).toEqual([
    [I(1), 'Neu'],
    [I(3), b.issues.get(I(3))?.data.title],
  ]);
  expect(patch?.remove).toEqual({ issues: [I(2)], sprints: ['2026-w47'] });
  expect(patch).not.toHaveProperty('touched');
  expect(patch).not.toHaveProperty('problems');
  expect(patch?.upsert).not.toHaveProperty('config');
});

test('entities in a patch have the shape of state', () => {
  const a = snap();
  const b = snap({ projects: ['web'], repos: { webapp: 'git@example.com:a/w.git' } });
  const patch = diffTables(entityTable(a), entityTable(b));
  expect(patch?.upsert.projects?.[0]).toMatchObject({ path: 'web' });
  expect(patch?.upsert.repos?.[0]).toMatchObject({ name: 'webapp' });
});

function withBodies(bodies: { project?: string; sprint?: string; repo?: string }) {
  const s = snap({
    projects: ['web'],
    sprints: ['2026-w47'],
    repos: { webapp: 'git@example.com:a/w.git' },
  });
  for (const [map, key, body] of [
    [s.projects, 'web', bodies.project],
    [s.sprints, '2026-w47', bodies.sprint],
    [s.repos, 'webapp', bodies.repo],
  ] as const) {
    const entry = map.get(key);
    if (entry !== undefined && body !== undefined) entry.body = body;
  }
  return s;
}

test('project, sprint and repo bodies travel in the entity lists', () => {
  const lists = entityLists(withBodies({ project: 'Ziel\n', repo: 'Notiz\n' }));
  expect(lists.projects[0]?.body).toBe('Ziel\n');
  expect(lists.repos[0]?.body).toBe('Notiz\n');
  expect('body' in (lists.sprints[0] ?? {})).toBe(false);
});

test('a changed project, sprint or repo body is an upsert', () => {
  const a = withBodies({ project: 'alt', sprint: 'alt', repo: 'alt' });
  const b = withBodies({ project: 'neu', sprint: 'neu', repo: 'neu' });
  const patch = diffTables(entityTable(a), entityTable(b));
  expect(patch?.upsert.projects).toEqual([{ path: 'web', title: 'web', body: 'neu' }]);
  expect(patch?.upsert.sprints?.[0]).toMatchObject({ slug: '2026-w47', body: 'neu' });
  expect(patch?.upsert.repos?.[0]).toMatchObject({ name: 'webapp', body: 'neu' });
  expect(patch).not.toHaveProperty('touched');
});

test('config changes upsert config and users with changed admin', () => {
  const a = snap({ config: { admins: ['spw'] } });
  const b = snap({ config: { admins: ['spw', 'alice'] } });
  const patch = diffTables(entityTable(a), entityTable(b));
  expect(patch?.upsert.config?.admins).toEqual(['spw', 'alice']);
  expect(patch?.upsert.config).not.toHaveProperty('$schema');
  expect(patch?.upsert.users?.map((u) => [u.handle, u.admin])).toEqual([['alice', true]]);
});

test('problems come as a whole list when they change', () => {
  const a = snap();
  const b = { ...snap(), problems: [{ path: 'issues/x/y/issue.md', message: 'kaputt' }] };
  expect(diffTables(entityTable(a), entityTable(b))).toEqual({
    upsert: {},
    remove: {},
    problems: [{ path: 'issues/x/y/issue.md', message: 'kaputt' }],
  });
  expect(diffTables(entityTable(b), entityTable(a))?.problems).toEqual([]);
});

test('touched alone makes a patch', () => {
  const s = snap({ issues: [{ id: I(1) }] });
  expect(diffTables(entityTable(s), entityTable(s), [I(1)])).toEqual({
    upsert: {},
    remove: {},
    touched: [I(1)],
  });
});

/** `s` mit anderem Body für das Issue `id`; Frontmatter bleibt gleich. */
function withBody(s: ReturnType<typeof snap>, id: string, body: string) {
  const issues = new Map(s.issues);
  const entry = issues.get(id);
  if (entry === undefined) throw new Error(`no issue ${id}`);
  issues.set(id, { ...entry, body });
  return { ...s, issues };
}

test('a changed body marks the issue touched, without the body in the patch', () => {
  const a = snap({ issues: [{ id: I(1) }, { id: I(2) }] });
  const b = withBody(a, I(2), 'Neue Beschreibung\n');
  const patch = diffTables(entityTable(a), entityTable(b));
  expect(patch).toEqual({ upsert: {}, remove: {}, touched: [I(2)] });
  expect(JSON.stringify(patch)).not.toContain('Neue Beschreibung');
});

test('body and path touched merge sorted without duplicates', () => {
  const a = snap({ issues: [{ id: I(1) }, { id: I(2) }, { id: I(3) }] });
  const b = withBody(withBody(a, I(3), 'x'), I(1), 'y');
  expect(diffTables(entityTable(a), entityTable(b), [I(2), I(3)])?.touched).toEqual([
    I(1),
    I(2),
    I(3),
  ]);
});

test('a new or removed issue is no body touch', () => {
  const a = snap({ issues: [{ id: I(1) }] });
  const b = withBody(snap({ issues: [{ id: I(2) }] }), I(2), 'Body');
  const patch = diffTables(entityTable(a), entityTable(b));
  expect(patch).not.toHaveProperty('touched');
  expect(patch?.remove).toEqual({ issues: [I(1)] });
});

test('touchedIssues reads comment and attachment paths', () => {
  expect(
    touchedIssues([
      'issues/t0/bk-t0002/attachments/logo.svg',
      'issues/t0/bk-t0001/comments/20261118T100000Z-spw-abc.md',
      'issues/t0/bk-t0001/attachments/a.txt',
      'issues/t0/bk-t0003/issue.md',
      'issues/t0/bk-t0004/comments',
      'projects/web.md',
    ]),
  ).toEqual(['bk-t0001', 'bk-t0002', 'bk-t0004']);
});

test('watchedPath filters to the backlog dirs', () => {
  for (const p of [
    'issues/t0/bk-t0001/issue.md',
    'issues',
    'projects/web/api.md',
    'sprints/2026-w47.md',
    'repos/webapp.md',
    'users/spw.md',
    '.backe/backlog.jsonc',
  ]) {
    expect([p, watchedPath(p)]).toEqual([p, true]);
  }
  for (const p of [
    '.git/HEAD',
    'README.md',
    'issuesx/a.md',
    'issues/t0/bk-t0001/.issue.md.swp',
    'issues/t0/bk-t0001/issue.md~',
    'issues/t0/bk-t0001/.issue.md.tmp-123-deadbeef',
  ]) {
    expect([p, watchedPath(p)]).toEqual([p, false]);
  }
});

test('needsFullReload for config, directories and non-md paths', () => {
  expect(needsFullReload('.backe/backlog.jsonc')).toBe(true);
  expect(needsFullReload('issues/t0/bk-t0001')).toBe(true);
  expect(needsFullReload('issues')).toBe(true);
  expect(needsFullReload('projects/web')).toBe(true);
  expect(needsFullReload('issues/t0/bk-t0001/issue.md')).toBe(false);
  expect(needsFullReload('projects/web/api.md')).toBe(false);
  expect(needsFullReload('issues/t0/bk-t0001/attachments/a.png')).toBe(false);
  expect(needsFullReload('issues/t0/bk-t0001/comments')).toBe(false);
  expect(needsFullReload('.backe/quarantine.jsonc')).toBe(false);
});
