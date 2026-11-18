import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { SCHEMA_FILES } from '../../scripts/gen-schemas.ts';
import { catchErr } from '../../test/helpers/catch.ts';
import {
  BacklogConfigSchema,
  IssueSchema,
  KEY_ORDER,
  ProjectConfigSchema,
  ProjectLocalConfigSchema,
  ProjectSchema,
  RepoSchema,
  SprintSchema,
  UserConfigSchema,
  UserSchema,
  validateEntity,
} from './schemas.ts';

const base = {
  id: 'bk-7f3k2',
  title: 'T',
  state: 'todo',
  creator: 'spw',
  created: '2026-11-18T10:04:00Z',
};
const err = (kind: Parameters<typeof validateEntity>[0], data: unknown) =>
  catchErr(() => validateEntity(kind, data, 'f.md')).message;
const bcfg = { version: 1, name: 'acme', id_prefix: 'bk', admins: ['spw'] };
const key = 'ssh-ed25519 AAAAC3Nza spw@host';

describe('issue', () => {
  test('minimal issue is valid', () =>
    expect(validateEntity('issue', base, 'f').unknownKeys).toEqual([]));
  test.each([
    [{ ...base, state: 'blocked' }, 'blocked_by'],
    [{ ...base, blocked_by: ['bk-a91c0'] }, 'blocked_by'],
    [{ ...base, state: 'blocked', blocked_by: ['bk-7f3k2'], paused_from: 'todo' }, 'blocked_by'],
    [{ ...base, depends_on: ['bk-7f3k2'] }, 'depends_on'],
    [{ ...base, parent: 'bk-7f3k2' }, 'parent'],
    [{ ...base, title: 'a\nb' }, 'title'],
    [{ ...base, title: '🐉'.repeat(201) }, 'title'],
    [{ ...base, attachments: [{ name: 'a', file: 'a', url: 'https://x' }] }, 'attachments'],
    [
      {
        ...base,
        attachments: [
          { name: 'a', file: 'a' },
          { name: 'a', url: 'https://x' },
        ],
      },
      'attachments',
    ],
    [{ ...base, props: { Bad: 1 } }, 'props'],
    [{ ...base, created: '2026-11-18 10:04' }, 'created'],
    // Rulings
    [{ ...base, created: '2026-13-18T10:04:00Z' }, 'created'],
    [{ ...base, created: '2026-02-30T10:04:00Z' }, 'created'],
    [{ ...base, state: 'blocked', blocked_by: [], paused_from: 'todo' }, 'blocked_by'],
    [{ ...base, state: 'blocked', blocked_by: ['bk-a91c0'] }, 'paused_from'],
    [{ ...base, paused_from: 'todo' }, 'paused_from'],
    [{ ...base, state: 'on_hold', paused_from: 'done' }, 'paused_from'],
    [{ ...base, state: 'on_hold', paused_from: 'blocked' }, 'paused_from'],
    [
      {
        ...base,
        state: 'blocked',
        blocked_by: ['bk-a91c0'],
        paused_from: 'todo',
        depends_on: ['bk-a91c0', 'bk-a91c0'],
      },
      'depends_on',
    ],
    [{ ...base, rank: 1.5 }, 'rank'],
    [{ ...base, title: '' }, 'title'],
    [{ ...base, title: 'a\rb' }, 'title'],
    [{ ...base, creator: 'Bad Handle' }, 'creator'],
    [{ ...base, projects: ['a//b'] }, 'projects'],
    [{ ...base, sprints: ['2026-w47', '2026-w47'] }, 'sprints'],
    [{ ...base, repos: ['Bad Name'] }, 'repos'],
    [{ ...base, attachments: [{ name: 'a' }] }, 'attachments'],
    [{ ...base, attachments: [{ name: 'a', file: 'x/y' }] }, 'attachments'],
    [{ ...base, attachments: [{ name: 'a', url: 'ftp://x' }] }, 'attachments'],
    [{ ...base, props: { a: null } }, 'props'],
    [{ ...base, props: { a: { b: [1, Number.POSITIVE_INFINITY] } } }, 'props'],
    [{ ...base, props: { a: [{ b: null }] } }, 'props'],
    [{ ...base, id: 'nope' }, 'id'],
    [{ ...base, state: 'nope' }, 'state'],
    ['str', '<root>'],
  ])('rejects %o at %s', (data, field) => {
    expect(err('issue', data)).toContain(field);
  });

  test('200 code points of emoji are fine', () =>
    expect(() => validateEntity('issue', { ...base, title: '🐉'.repeat(200) }, 'f')).not.toThrow());
  test('unknown top-level keys are reported, not dropped', () => {
    const r = validateEntity('issue', { ...base, zeta: 1, custom: 2 }, 'f');
    expect(r.unknownKeys).toEqual(['zeta', 'custom']);
    expect(r.data).not.toHaveProperty('custom');
  });
  test('full issue passes', () => {
    const full = {
      ...base,
      state: 'blocked',
      blocked_by: ['bk-a91c0'],
      paused_from: 'in_progress',
      parent: 'bk-x2c8d',
      depends_on: ['bk-3m9qa'],
      rank: -3000,
      assignee: 'claude-1',
      projects: ['web/auth'],
      sprints: ['2026-w47'],
      repos: ['webapp@feat/sso', 'infra@4e1f9c2'],
      attachments: [
        { name: 'trace', file: 'trace.json' },
        { name: 'figma', url: 'https://www.figma.com/file/x' },
      ],
      props: {
        'github.issue': 'acme/webapp#123',
        estimate_h: 4,
        ok: true,
        nested: { l: ['a', 1, { x: false }] },
      },
    };
    expect(validateEntity('issue', full, 'f').data).toEqual(full);
  });
  test('message carries file and all violations', () => {
    const m = err('issue', { ...base, title: '', created: 'x' });
    expect(m).toContain('f.md: title');
    expect(m).toContain('f.md: created');
  });
  test('error code is validation', () =>
    expect(catchErr(() => validateEntity('issue', {}, 'f')).code).toBe('validation'));
  test('data key order follows KEY_ORDER', () => {
    const r = validateEntity(
      'issue',
      {
        props: { a: 1 },
        created: base.created,
        creator: 'spw',
        state: 'todo',
        title: 'T',
        id: base.id,
      },
      'f',
    );
    expect(Object.keys(r.data)).toEqual(['id', 'title', 'state', 'creator', 'created', 'props']);
  });
});

describe('comment', () => {
  const c = { author: 'spw', created: '2026-11-18T10:04:00Z' };
  test('plain and explicit comment', () => {
    expect(() => validateEntity('comment', c, 'f')).not.toThrow();
    expect(() => validateEntity('comment', { ...c, kind: 'comment' }, 'f')).not.toThrow();
  });
  test('transition needs from and to', () => {
    expect(() =>
      validateEntity('comment', { ...c, kind: 'transition', from: 'todo', to: 'done' }, 'f'),
    ).not.toThrow();
    expect(err('comment', { ...c, kind: 'transition', from: 'todo' })).toContain('f.md: to');
    expect(err('comment', { ...c, kind: 'transition', to: 'todo' })).toContain('f.md: from');
  });
  test('from/to forbidden on plain comment', () => {
    expect(err('comment', { ...c, from: 'todo', to: 'done' })).toContain('f.md: from');
    expect(err('comment', { ...c, kind: 'comment', to: 'done' })).toContain('f.md: to');
  });
  test.each([
    [{ ...c, author: 'X' }, 'author'],
    [{ ...c, created: 'x' }, 'created'],
    [{ ...c, kind: 'edit' }, 'kind'],
  ])('rejects %o', (d, f) => expect(err('comment', d)).toContain(f));
});

describe('user', () => {
  test('agent user requires operator', () =>
    expect(err('user', { name: 'C', kind: 'agent', keys: [key] })).toContain('operator'));
  test('human user forbids operator', () =>
    expect(err('user', { name: 'S', kind: 'human', operator: 'spw', keys: [key] })).toContain(
      'operator',
    ));
  test('only ssh-ed25519 keys', () =>
    expect(err('user', { name: 'S', kind: 'human', keys: ['ssh-rsa AAAA x'] })).toContain('keys'));
  test('valid users', () => {
    expect(() =>
      validateEntity('user', { name: 'S', kind: 'human', keys: [key, 'ssh-ed25519 AAAA'] }, 'f'),
    ).not.toThrow();
    expect(() =>
      validateEntity(
        'user',
        {
          name: 'C',
          kind: 'agent',
          operator: 'spw',
          keys: [],
          revoked_keys: [{ key, revoked: '2026-11-18T10:04:00Z' }],
        },
        'f',
      ),
    ).not.toThrow();
  });
  test.each([
    [{ name: '', kind: 'human', keys: [] }, 'name'],
    [{ name: 'S', kind: 'bot', keys: [] }, 'kind'],
    [{ name: 'S', kind: 'human', keys: [key, key] }, 'keys'],
    [
      {
        name: 'S',
        kind: 'human',
        keys: [],
        revoked_keys: [{ key: 'bad', revoked: '2026-11-18T10:04:00Z' }],
      },
      'revoked_keys',
    ],
    [{ name: 'S', kind: 'human', keys: [], revoked_keys: [{ key, revoked: 'x' }] }, 'revoked_keys'],
    [{ name: 'C', kind: 'agent', operator: 'Bad Op', keys: [] }, 'operator'],
  ])('rejects %o', (d, f) => expect(err('user', d)).toContain(f));
});

describe('project, sprint, repo', () => {
  test('project', () => {
    expect(() => validateEntity('project', { title: 'Auth', lead: 'spw' }, 'f')).not.toThrow();
    expect(err('project', { title: '' })).toContain('title');
    expect(err('project', { title: 'x', lead: 'X' })).toContain('lead');
  });
  test('sprint', () => {
    expect(() =>
      validateEntity(
        'sprint',
        { title: 'S', start: '2026-11-16', end: '2026-11-16', closed: true },
        'f',
      ),
    ).not.toThrow();
    expect(() => validateEntity('sprint', { title: 'S' }, 'f')).not.toThrow();
    expect(err('sprint', { title: 'S', start: '2026-11-17', end: '2026-11-16' })).toContain('end');
    expect(err('sprint', { title: 'S', start: '2026-02-30' })).toContain('start');
    expect(err('sprint', { title: 'S', end: '2026-11-1' })).toContain('end');
    expect(err('sprint', { title: '' })).toContain('title');
    expect(err('sprint', { title: 'S', closed: 'yes' })).toContain('closed');
  });
  test('repo', () => {
    expect(() =>
      validateEntity(
        'repo',
        { url: 'https://github.com/acme/webapp.git', default_ref: 'main' },
        'f',
      ),
    ).not.toThrow();
    expect(err('repo', { url: 'not a url' })).toContain('url');
    expect(err('repo', { url: 'github.com/acme/webapp', default_ref: '' })).toContain(
      'default_ref',
    );
  });
});

describe('KEY_ORDER', () => {
  test('exact order', () => {
    expect(KEY_ORDER.issue).toEqual([
      'id',
      'title',
      'state',
      'blocked_by',
      'paused_from',
      'parent',
      'depends_on',
      'rank',
      'creator',
      'assignee',
      'projects',
      'sprints',
      'repos',
      'attachments',
      'created',
      'props',
    ]);
    expect(KEY_ORDER.comment).toEqual(['author', 'created', 'kind', 'from', 'to']);
    expect(KEY_ORDER.user).toEqual(['name', 'kind', 'operator', 'keys', 'revoked_keys']);
    expect(KEY_ORDER.project).toEqual(['title', 'lead']);
    expect(KEY_ORDER.sprint).toEqual(['title', 'start', 'end', 'closed']);
    expect(KEY_ORDER.repo).toEqual(['url', 'default_ref']);
  });
  test('schema shapes agree with KEY_ORDER', () => {
    for (const [kind, s] of [
      ['issue', IssueSchema],
      ['user', UserSchema],
      ['project', ProjectSchema],
      ['sprint', SprintSchema],
      ['repo', RepoSchema],
    ] as const)
      expect(Object.keys(s.shape).sort()).toEqual([...KEY_ORDER[kind]].sort());
  });
});

describe('backlog config', () => {
  test('defaults', () => {
    const c = BacklogConfigSchema.parse(bcfg);
    expect(c.sync).toEqual({ mode: 'auto', remote: 'origin', branch: 'main', pull_interval: 60 });
    expect(c.workflow).toEqual({ strict: false });
    expect(c.verify).toBe('strict');
    expect(c.attachments).toEqual({ max_bytes: 10485760, lfs: false });
    expect(c.props_strict).toBe(false);
    expect(c.props).toEqual({});
  });
  test('partial nested defaults', () => {
    expect(BacklogConfigSchema.parse({ ...bcfg, sync: { mode: 'manual' } }).sync).toEqual({
      mode: 'manual',
      remote: 'origin',
      branch: 'main',
      pull_interval: 60,
    });
    expect(
      BacklogConfigSchema.parse({ ...bcfg, attachments: { max_bytes: null } }).attachments
        .max_bytes,
    ).toBeNull();
  });
  test('spec example parses', () => {
    const r = BacklogConfigSchema.safeParse({
      $schema: 'https://x/backlog.schema.json',
      ...bcfg,
      props: {
        severity: { type: 'enum', values: ['critical', 'high'], ordered: true, description: 'S' },
        location: { type: 'string', description: 'L' },
      },
    });
    expect(r.success).toBe(true);
  });
  test.each([
    [{ ...bcfg, extra: 1 }],
    [{ ...bcfg, version: 0 }],
    [{ ...bcfg, version: 1.5 }],
    [{ ...bcfg, name: '' }],
    [{ ...bcfg, id_prefix: 'X!' }],
    [{ ...bcfg, admins: [] }],
    [{ ...bcfg, admins: ['Bad'] }],
    [{ ...bcfg, sync: { mode: 'x' } }],
    [{ ...bcfg, sync: { nope: 1 } }],
    [{ ...bcfg, verify: 'x' }],
    [{ ...bcfg, attachments: { max_bytes: 0 } }],
    [{ ...bcfg, props: { a: { type: 'string' } } }],
    [{ ...bcfg, props: { a: { type: 'weird', description: 'd' } } }],
    [{ ...bcfg, props: { a: { type: 'enum', description: 'd' } } }],
    [{ ...bcfg, props: { a: { type: 'enum', values: [], description: 'd' } } }],
    [{ ...bcfg, props: { a: { type: 'enum', values: ['a', 'a'], description: 'd' } } }],
    [{ ...bcfg, props: { a: { type: 'string', values: ['a'], description: 'd' } } }],
    [{ ...bcfg, props: { a: { type: 'string', ordered: true, description: 'd' } } }],
    [{ ...bcfg, props: { A: { type: 'string', description: 'd' } } }],
  ])('rejects %o', (d) => expect(BacklogConfigSchema.safeParse(d).success).toBe(false));
});

describe('user and project config', () => {
  test('user config', () => {
    expect(UserConfigSchema.parse({})).toEqual({});
    const full = {
      $schema: 'x',
      current: 'acme',
      user: 'spw',
      identities: { acme: { spw: { key: '~/.ssh/id_ed25519.pub' } } },
      backlogs: {
        acme: {
          remote: 'git@github.com:acme/backlog.git',
          user: 'spw',
          paths: { spw: '~/code/x' },
          sync: { mode: 'manual' },
        },
      },
      repos: { 'github.com/acme/webapp': '~/code/webapp' },
      output: { format: 'json', color: 'never' },
    };
    expect(UserConfigSchema.parse(full)).toEqual(full);
  });
  test.each([
    [{ extra: 1 }],
    [{ identities: { acme: { Bad: { key: 'k' } } } }],
    [{ identities: { acme: { spw: {} } } }],
    [{ backlogs: { acme: { nope: 1 } } }],
    [{ backlogs: { acme: { paths: { Bad: '/x' } } } }],
    [{ backlogs: { acme: { sync: { mode: 'x' } } } }],
    [{ output: { format: 'xml' } }],
    [{ output: { color: 'sometimes' } }],
  ])('user config rejects %o', (d) => expect(UserConfigSchema.safeParse(d).success).toBe(false));
  test('project config', () => {
    expect(
      ProjectConfigSchema.parse({
        backlog: 'acme',
        project: 'web/auth',
        sprint: '2026-w47',
        repo: 'webapp',
      }).repo,
    ).toBe('webapp');
    expect(ProjectConfigSchema.parse({ repo: null }).repo).toBeNull();
    expect(ProjectConfigSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
  test('user only in local project config', () => {
    expect(ProjectConfigSchema.safeParse({ backlog: 'acme', user: 'spw' }).success).toBe(false);
    expect(ProjectLocalConfigSchema.safeParse({ backlog: 'acme', user: 'spw' }).success).toBe(true);
    expect(ProjectLocalConfigSchema.safeParse({ user: 'Bad' }).success).toBe(false);
  });
});

describe('names and refs that later become paths or git arguments', () => {
  const BAD_NAMES = ['../../.ssh', 'a b', '\u0001', '', 'Acme', '-acme', 'a'.repeat(65)];
  const GOOD_NAMES = ['acme', 'a', '0-backlog', 'a'.repeat(64)];
  const BAD_REFS = ['--upload-pack=x', '-x', 'a b', 'a\tb', '\u0001', '\u007f', '\u0085', ''];
  const GOOD_REFS = ['origin', 'main', 'feat/sso', '4e1f9c2', 'git@github.com:acme/x.git'];
  const ok = (schema: z.ZodType, data: unknown) => schema.safeParse(data).success;

  test.each(BAD_NAMES)('backlog name %j is rejected', (name) => {
    expect(ok(BacklogConfigSchema, { ...bcfg, name })).toBe(false);
    expect(ok(UserConfigSchema, { identities: { [name]: { spw: { key: 'k' } } } })).toBe(false);
    expect(ok(UserConfigSchema, { backlogs: { [name]: {} } })).toBe(false);
  });
  test.each(GOOD_NAMES)('backlog name %j is accepted', (name) => {
    expect(ok(BacklogConfigSchema, { ...bcfg, name })).toBe(true);
    expect(ok(UserConfigSchema, { identities: { [name]: { spw: { key: 'k' } } } })).toBe(true);
    expect(ok(UserConfigSchema, { backlogs: { [name]: {} } })).toBe(true);
  });
  test.each(BAD_REFS)('ref %j is rejected', (ref) => {
    expect(ok(BacklogConfigSchema, { ...bcfg, sync: { remote: ref } })).toBe(false);
    expect(ok(BacklogConfigSchema, { ...bcfg, sync: { branch: ref } })).toBe(false);
    expect(ok(RepoSchema, { url: 'gh:acme/webapp', default_ref: ref })).toBe(false);
    expect(ok(IssueSchema, { ...base, repos: [`webapp@${ref}`] })).toBe(false);
  });
  test.each(GOOD_REFS)('ref %j is accepted', (ref) => {
    expect(ok(BacklogConfigSchema, { ...bcfg, sync: { remote: ref } })).toBe(true);
    expect(ok(BacklogConfigSchema, { ...bcfg, sync: { branch: ref } })).toBe(true);
    expect(ok(RepoSchema, { url: 'gh:acme/webapp', default_ref: ref })).toBe(true);
    expect(ok(IssueSchema, { ...base, repos: [`webapp@${ref}`] })).toBe(true);
  });
  test('the JSON schemas carry the patterns for editors', async () => {
    const backlog = JSON.parse(await readFile('schemas/backlog.schema.json', 'utf8'));
    expect(backlog.properties.name.pattern).toBeTypeOf('string');
    expect(backlog.properties.sync.properties.remote.pattern).toBeTypeOf('string');
    expect(backlog.properties.sync.properties.branch.pattern).toBeTypeOf('string');
    const user = JSON.parse(await readFile('schemas/user-config.schema.json', 'utf8'));
    expect(user.properties.identities.propertyNames.pattern).toBeTypeOf('string');
    expect(user.properties.backlogs.propertyNames.pattern).toBeTypeOf('string');
  });
});

describe('config schemas carry their patterns and reject malformed values', () => {
  test.each([
    ['backlog.schema.json', ['properties', 'admins', 'items', 'pattern']],
    ['backlog.schema.json', ['properties', 'id_prefix', 'pattern']],
    ['backlog.schema.json', ['properties', 'props', 'propertyNames', 'pattern']],
    ['user-config.schema.json', ['properties', 'user', 'pattern']],
    ['user-config.schema.json', ['properties', 'current', 'pattern']],
    ['project-config.schema.json', ['properties', 'project', 'pattern']],
    ['project-local-config.schema.json', ['properties', 'user', 'pattern']],
  ])('%s carries a pattern at %j', async (file, path) => {
    const schema = JSON.parse(await readFile(`schemas/${file}`, 'utf8'));
    expect(
      path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], schema),
    ).toBeTypeOf('string');
  });
  test('the handle pattern in the JSON schema rejects the reserved handle', async () => {
    const schema = JSON.parse(await readFile('schemas/user-config.schema.json', 'utf8'));
    const re = new RegExp(schema.properties.user.pattern, 'u');
    expect(re.test('spw')).toBe(true);
    expect(re.test('me')).toBe(false);
  });
  test('the entity handle still rejects the reserved handle', () => {
    expect(ProjectSchema.safeParse({ title: 'x', lead: 'me' }).success).toBe(false);
    expect(ProjectSchema.safeParse({ title: 'x', lead: 'spw' }).success).toBe(true);
  });
  test.each([
    { current: 'Acme' },
    { backlogs: { acme: { remote: '-x' } } },
    { backlogs: { acme: { remote: 'not a url' } } },
    { repos: { 'git@github.com:acme/webapp.git': '/x' } },
    { repos: { 'github.com/acme/webapp.git': '/x' } },
    { repos: { 'GitHub.com/acme/webapp': '/x' } },
    { project: 'Web' },
    { backlogs: { acme: { sprint: 'w 47' } } },
  ])('user config rejects %o', (d) => expect(UserConfigSchema.safeParse(d).success).toBe(false));
  test('user config accepts project and sprint defaults', () =>
    expect(
      UserConfigSchema.safeParse({
        project: 'web',
        sprint: 'w47',
        backlogs: { acme: { project: 'web/auth', sprint: '2026-w47' } },
      }).success,
    ).toBe(true));
  test('user config accepts canonical repo keys and a normalizable remote', () =>
    expect(
      UserConfigSchema.safeParse({
        repos: { 'github.com/acme/webapp': '/x', 'file:/srv/x': '/y' },
        backlogs: { acme: { remote: 'git@github.com:acme/backlog.git' } },
      }).success,
    ).toBe(true));
  test.each([
    { project: 'web//auth' },
    { sprint: '-x' },
    { repo: 'Web App' },
    { backlog: 'not a url' },
  ])('project config rejects %o', (d) =>
    expect(ProjectConfigSchema.safeParse(d).success).toBe(false),
  );
  test.each([{ backlog: 'acme' }, { backlog: 'git@github.com:acme/backlog.git' }, { repo: null }])(
    'project config accepts %o',
    (d) => expect(ProjectConfigSchema.safeParse(d).success).toBe(true),
  );
});

test('generated JSON schemas are up to date', async () => {
  expect(SCHEMA_FILES.map(([f]) => f)).toEqual([
    'backlog.schema.json',
    'user-config.schema.json',
    'project-config.schema.json',
    'project-local-config.schema.json',
  ]);
  for (const [file, schema] of SCHEMA_FILES) {
    const text = await readFile(`schemas/${file}`, 'utf8');
    expect(JSON.parse(text)).toEqual(z.toJSONSchema(schema, { io: 'input' }));
    expect(text).toBe(`${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2)}\n`);
  }
});

test('backlog JSON schema describes the input side: defaulted fields are not required', async () => {
  const schema = JSON.parse(await readFile('schemas/backlog.schema.json', 'utf8')) as {
    required: string[];
    properties: { sync: { required?: string[] } };
  };
  expect(schema.required).toEqual(
    expect.arrayContaining(['version', 'name', 'id_prefix', 'admins']),
  );
  for (const k of ['workflow', 'sync', 'verify', 'attachments', 'props_strict', 'props'])
    expect(schema.required).not.toContain(k);
  expect(schema.properties.sync.required ?? []).toEqual([]);
});

test('nested __proto__ in props is rejected', () => {
  const props = JSON.parse('{"a":{"b":[{"__proto__":{"x":1}}]}}');
  expect(catchErr(() => validateEntity('issue', { ...base, props }, 'f')).message).toContain(
    'props.a.b.0.__proto__',
  );
});
