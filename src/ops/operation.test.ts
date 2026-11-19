import fc from 'fast-check';
import { arbOperation } from '../../test/helpers/arbitraries.ts';
import { catchErr } from '../../test/helpers/catch.ts';
import {
  bodyHash,
  decodeBatchBody,
  decodeOp,
  encodeBatchBody,
  encodeOp,
  type Operation,
  OperationSchema,
  PLACEHOLDER_RE,
  parseOpTrailer,
  referencedIds,
  substituteIds,
  summarizeBatch,
  summarizeOp,
  TRAILER_LITERALS,
} from './operation.ts';

const ID = 'bk-7f3k2';
const OTHER = 'bk-a91c0';
const HASH = 'a'.repeat(64);
const FILE = '20261118T100400Z-spw-q8x.md';
/** Zeichen, an denen ein zeilenbasierter Trailer-Parser die Zeile trennen könnte. */
const LINE_BREAKS = /[\n\r\u2028\u2029\u0085]/;

const create: Operation = { op: 'issue.create', ref: '$f1', title: 'Finding' };
const move: Operation = { op: 'issue.move', id: ID, from: 'in_progress', to: 'review' };
const commentAdd: Operation = { op: 'comment.add', id: ID, body: 'hi' };

/** Operation ohne `content`, so wie sie nach dem Kodieren zurückkommt. */
function withoutContent(op: Operation): Operation {
  if (op.op !== 'attach.add') return op;
  const { content: _, ...rest } = op;
  return rest;
}

const invalid = (text: string) => catchErr(() => decodeOp(text)).code;
const invalidOp = (op: object) => invalid(JSON.stringify(op));

describe('operation validation details', () => {
  test('decodeOp rejects -0 in props', () => {
    const text = `{"op":"issue.edit","id":"${ID}","props":{"k":{"from":null,"to":-0}}}`;
    expect(invalid(text)).toBe('validation');
    expect(catchErr(() => decodeOp(text)).message).toContain('-0 ist kein gültiger Wert');
  });

  test('decodeOp rejects -0 nested in a prop value and in issue.create', () => {
    const text = '{"op":"issue.create","title":"x","props":{"k":[1,{"a":-0}]}}';
    expect(invalid(text)).toBe('validation');
  });

  test.each([
    { op: 'issue.move', id: ID, from: 'todo', to: 'in_progress' },
    { op: 'issue.resume', id: ID, from: 'blocked' },
    { op: 'issue.reopen', id: ID, from: 'done' },
  ])('reason_file without reason is rejected for $op', (base) => {
    const text = JSON.stringify({ ...base, reason_file: '20261119T080000Z-spw-abc.md' });
    expect(invalid(text)).toBe('validation');
    expect(catchErr(() => decodeOp(text)).message).toContain('nur zusammen mit');
    const ok = { ...base, reason: 'warum', reason_file: '20261119T080000Z-spw-abc.md' };
    expect(() => decodeOp(JSON.stringify(ok))).not.toThrow();
  });
});

describe('encodeOp / decodeOp', () => {
  test('spec example roundtrips byte-identically', () => {
    const line = '{"op":"issue.move","id":"bk-7f3k2","from":"in_progress","to":"review"}';
    expect(encodeOp(decodeOp(line))).toBe(line);
    expect(summarizeOp(decodeOp(line))).toBe('issue move bk-7f3k2 review');
  });

  test('spec example for issue.edit roundtrips byte-identically', () => {
    const line =
      '{"op":"issue.edit","id":"bk-7f3k2","set":{"assignee":{"from":null,"to":"claude-1"}},"add":{"projects":["api"]}}';
    expect(encodeOp(decodeOp(line))).toBe(line);
  });

  test('decodeOp rejects unknown op names and fields', () => {
    expect(invalid('{"op":"issue.teleport","id":"bk-7f3k2"}')).toBe('validation');
    expect(invalid('{"op":"issue.claim","id":"bk-7f3k2","prio":1}')).toBe('validation');
    expect(
      invalidOp({ op: 'issue.edit', id: ID, set: { title: { from: 'a', to: 'b', x: 1 } } }),
    ).toBe('validation');
  });

  test('there are no issue.prop and issue.body operations', () => {
    expect(invalidOp({ op: 'issue.body', id: ID, from_hash: HASH, body: 'x' })).toBe('validation');
    expect(invalidOp({ op: 'issue.prop', id: ID, key: 'k', from: null, to: 1 })).toBe('validation');
  });

  test('decodeOp rejects malformed JSON, non-objects and __proto__ keys', () => {
    expect(invalid('{"op":')).toBe('validation');
    expect(catchErr(() => decodeOp('{"op":')).message).toMatch(/kein gültiges JSON/);
    expect(invalid('[]')).toBe('validation');
    expect(catchErr(() => decodeOp('null')).message).toMatch(/JSON-Objekt/);
    expect(catchErr(() => decodeOp('{"op":"issue.nope"}')).message).toMatch(
      /op: unbekannte Operation/,
    );
    // zod würde `__proto__` in einem Record still verwerfen; die Operation käme verändert an.
    const proto =
      '{"op":"issue.edit","id":"bk-7f3k2","props":{"k":{"from":null,"to":{"__proto__":1}}}}';
    const err = catchErr(() => decodeOp(proto));
    expect(err.code).toBe('validation');
    expect(err.message).toBe('Key "__proto__" ist in Operationen nicht erlaubt');
    expect(catchErr(() => decodeBatchBody(`${proto}\n`)).message).toBe(
      'Zeile 1: Key "__proto__" ist in Operationen nicht erlaubt',
    );
    expect(
      decodeOp('{"op":"issue.edit","id":"bk-7f3k2","props":{"k":{"from":null,"to":{"a":1}}}}'),
    ).toEqual({ op: 'issue.edit', id: ID, props: { k: { from: null, to: { a: 1 } } } });
  });

  test('trailer stays one line and roundtrips text', () => {
    const op = {
      op: 'comment.add',
      id: 'bk-7f3k2',
      body: 'a\r\nb c 🐉 "q" \u2028x\u2029y\u0085z',
    } as const;
    const enc = encodeOp(op);
    expect(enc).not.toMatch(LINE_BREAKS);
    expect(enc).toContain('\\u2028x\\u2029y\\u0085z');
    expect(decodeOp(enc)).toEqual(op);
  });

  test('content is never encoded', () =>
    expect(
      encodeOp({
        op: 'attach.add',
        id: 'bk-7f3k2',
        name: 'trace',
        file: 'trace.json',
        content: Uint8Array.of(1),
      }),
    ).not.toContain('content'));

  test('content cannot be smuggled in through JSON', () =>
    expect(
      invalidOp({ op: 'attach.add', id: ID, name: 'trace', file: 't.json', content: [1] }),
    ).toBe('validation'));

  test('encodeOp puts op first, then the schema order, nested objects too; maps keep their order', () => {
    const shuffled = {
      body: { to: 'neu', from_hash: HASH },
      props: { zeta: { to: 2, from: null }, alpha: { to: null, from: 'x' } },
      remove: { blocked_by: [OTHER] },
      add: { depends_on: ['$f2'], projects: ['api'] },
      set: { assignee: { to: 'spw', from: null }, title: { to: 'B', from: 'A' } },
      id: ID,
      op: 'issue.edit',
    } as unknown as Operation;
    expect(encodeOp(shuffled)).toBe(
      '{"op":"issue.edit","id":"bk-7f3k2",' +
        '"set":{"title":{"from":"A","to":"B"},"assignee":{"from":null,"to":"spw"}},' +
        '"add":{"projects":["api"],"depends_on":["$f2"]},' +
        '"remove":{"blocked_by":["bk-a91c0"]},' +
        '"props":{"zeta":{"from":null,"to":2},"alpha":{"from":"x","to":null}},' +
        '"body":{"from_hash":"' +
        HASH +
        '","to":"neu"}}',
    );
  });

  test('entity.edit keeps the given order of set fields', () =>
    expect(
      encodeOp({
        op: 'entity.edit',
        kind: 'sprint',
        key: 's1',
        set: { end: { from: null, to: '2026-12-01' }, title: { from: 'A', to: 'B' } },
      }),
    ).toBe(
      '{"op":"entity.edit","kind":"sprint","key":"s1","set":{"end":{"from":null,"to":"2026-12-01"},"title":{"from":"A","to":"B"}}}',
    ));

  test('encodeOp refuses an invalid operation', () =>
    expect(
      catchErr(() => encodeOp({ op: 'issue.claim', id: 'nope' } as unknown as Operation)).code,
    ).toBe('validation'));

  test('roundtrip for every catalogue entry', () =>
    fc.assert(
      fc.property(arbOperation(), (op) => {
        const enc = encodeOp(op);
        expect(enc).not.toMatch(LINE_BREAKS);
        expect(decodeOp(enc)).toEqual(withoutContent(op));
      }),
      { numRuns: 500 },
    ));

  test('arbOperation covers the whole catalogue', () => {
    const seen = new Set(fc.sample(arbOperation(), 3000).map((op) => op.op));
    expect([...seen].sort()).toEqual(
      [...OperationSchema.options.map((o) => o.shape.op.value)].sort(),
    );
  });
});

describe('field rules', () => {
  test('issue ids may be placeholders, nothing else', () => {
    expect(decodeOp('{"op":"issue.claim","id":"$f1"}')).toEqual({ op: 'issue.claim', id: '$f1' });
    expect(invalidOp({ op: 'issue.claim', id: 'BK-7F3K2' })).toBe('validation');
    expect(invalidOp({ op: 'issue.claim', id: '$' })).toBe('validation');
    expect(invalidOp({ op: 'issue.claim', id: `$${'x'.repeat(33)}` })).toBe('validation');
    expect(PLACEHOLDER_RE.test('$f-1_A')).toBe(true);
  });

  test('issue.create: ref is a placeholder, id a real issue id', () => {
    expect(invalidOp({ op: 'issue.create', ref: 'f1', title: 'x' })).toBe('validation');
    expect(invalidOp({ op: 'issue.create', id: '$f1', title: 'x' })).toBe('validation');
    expect(invalidOp({ op: 'issue.create', title: 'zwei\nZeilen' })).toBe('validation');
    expect(invalidOp({ op: 'issue.create', title: 'x', created: '2026-02-30T00:00:00Z' })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'issue.create', title: 'x', depends_on: [] })).toBe('validation');
    expect(invalidOp({ op: 'issue.create', title: 'x', depends_on: [ID, ID] })).toBe('validation');
    expect(decodeOp('{"op":"issue.create","title":"x","projects":[]}')).toEqual({
      op: 'issue.create',
      title: 'x',
      projects: [],
    });
  });

  test('ref only on issue.create (as placeholder)', () =>
    expect(invalidOp({ op: 'issue.claim', id: ID, ref: '$f1' })).toBe('validation'));

  test('issue.edit needs at least one non-empty section', () => {
    expect(invalidOp({ op: 'issue.edit', id: ID })).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, set: {} })).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, add: {} })).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, remove: {} })).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, props: {} })).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, add: { projects: [] } })).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, add: { labels: ['x'] } })).toBe('validation');
  });

  test('issue.edit field types', () => {
    expect(invalidOp({ op: 'issue.edit', id: ID, set: { title: { from: null, to: 'x' } } })).toBe(
      'validation',
    );
    expect(
      invalidOp({ op: 'issue.edit', id: ID, set: { state: { from: 'todo', to: 'done' } } }),
    ).toBe('validation');
    expect(
      invalidOp({ op: 'issue.edit', id: ID, set: { assignee: { from: null, to: 'me' } } }),
    ).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, set: { parent: { to: OTHER } } })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'issue.edit', id: ID, props: { Bad: { from: null, to: 1 } } })).toBe(
      'validation',
    );
    expect(
      invalidOp({ op: 'issue.edit', id: ID, props: { k: { from: null, to: null, x: 1 } } }),
    ).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, body: { from_hash: 'ABC', to: '' } })).toBe(
      'validation',
    );
    expect(
      invalidOp({ op: 'issue.edit', id: ID, body: { from_hash: HASH.toUpperCase(), to: '' } }),
    ).toBe('validation');
    expect(invalidOp({ op: 'issue.edit', id: ID, add: { repos: ['-x'] } })).toBe('validation');
  });

  test('issue.move / resume / reopen states', () => {
    expect(invalidOp({ op: 'issue.move', id: ID, from: 'todo', to: 'later' })).toBe('validation');
    expect(invalidOp({ op: 'issue.move', id: ID, from: 'todo', to: 'done', force: false })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'issue.move', id: ID, from: 'todo', to: 'done', reason: '' })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'issue.resume', id: ID, from: 'todo' })).toBe('validation');
    expect(invalidOp({ op: 'issue.reopen', id: ID, from: 'todo' })).toBe('validation');
    expect(invalidOp({ op: 'issue.reopen', id: ID, from: 'done', to: 'done' })).toBe('validation');
    expect(invalidOp({ op: 'issue.reopen', id: ID, from: 'done', to: 'blocked' })).toBe(
      'validation',
    );
  });

  test('comment file names follow backe.md §2.7', () => {
    const ok = { op: 'comment.delete', id: ID, file: FILE };
    expect(decodeOp(JSON.stringify(ok))).toEqual(ok);
    for (const file of [
      '20261118T100400Z-spw-q8x.txt',
      '20261118T100400Z-spw-q8u.md',
      '20261318T100400Z-spw-q8x.md',
      '20261118T100400Z-me-q8x.md',
      '20261118T100400Z-spw-q8xx.md',
      '../20261118T100400Z-spw-q8x.md',
    ]) {
      expect(invalidOp({ ...ok, file })).toBe('validation');
    }
    expect(
      invalidOp({ op: 'issue.move', id: ID, from: 'todo', to: 'done', reason_file: 'x.md' }),
    ).toBe('validation');
    expect(invalidOp({ op: 'issue.delete', id: ID, blocker_comments: { [OTHER]: 'x.md' } })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'issue.delete', id: ID, blocker_comments: { nope: FILE } })).toBe(
      'validation',
    );
  });

  test('issue.rank needs exactly one position', () => {
    expect(invalidOp({ op: 'issue.rank', id: ID, from: null })).toBe('validation');
    expect(invalidOp({ op: 'issue.rank', id: ID, from: 1, top: true, value: 5 })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'issue.rank', id: ID, from: 1.5, top: true })).toBe('validation');
    expect(invalidOp({ op: 'issue.rank', id: ID, from: 1, value: 2.5 })).toBe('validation');
    expect(invalidOp({ op: 'issue.rank', id: ID, top: true })).toBe('validation');
    expect(decodeOp('{"op":"issue.rank","id":"bk-7f3k2","from":null,"before":"$f1"}')).toEqual({
      op: 'issue.rank',
      id: ID,
      from: null,
      before: '$f1',
    });
  });

  test('issue.link needs exactly one of repo and url', () => {
    expect(invalidOp({ op: 'issue.link', id: ID })).toBe('validation');
    expect(
      invalidOp({ op: 'issue.link', id: ID, repo: 'webapp', url: 'https://github.com/a/b' }),
    ).toBe('validation');
    expect(invalidOp({ op: 'issue.link', id: ID, repo: 'webapp@main' })).toBe('validation');
    expect(invalidOp({ op: 'issue.link', id: ID, url: 'kein url' })).toBe('validation');
    expect(invalidOp({ op: 'issue.link', id: ID, repo: 'webapp', ref: '-x' })).toBe('validation');
  });

  test('attach.add: exactly one of file and url, file is a plain name', () => {
    const base = { op: 'attach.add', id: ID, name: 'trace' };
    expect(invalidOp(base)).toBe('validation');
    expect(invalidOp({ ...base, file: 't.json', url: 'https://x.org/t' })).toBe('validation');
    for (const file of ['', '.', '..', 'a/b'])
      expect(invalidOp({ ...base, file })).toBe('validation');
    expect(invalidOp({ ...base, url: 'ftp://x.org/t' })).toBe('validation');
    expect(invalidOp({ ...base, name: 'Trace', file: 't.json' })).toBe('validation');
    expect(() =>
      encodeOp({
        op: 'attach.add',
        id: ID,
        name: 'trace',
        url: 'https://x.org/t',
        content: Uint8Array.of(1),
      }),
    ).toThrow(/content/);
  });

  test('project.rm takes at most one of reassign and detach', () => {
    expect(invalidOp({ op: 'project.rm', path: 'web', reassign: 'api', detach: true })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'project.rm', path: 'Web' })).toBe('validation');
  });

  test('names and timestamps use the core rules', () => {
    expect(invalidOp({ op: 'sprint.create', slug: 'S1', title: 'x' })).toBe('validation');
    expect(invalidOp({ op: 'sprint.create', slug: 's1', title: 'x', start: '2026-13-01' })).toBe(
      'validation',
    );
    expect(invalidOp({ op: 'sprint.close', slug: 's1', carry_over: 'S2' })).toBe('validation');
    expect(invalidOp({ op: 'repo.add', url: 'kein url' })).toBe('validation');
    expect(invalidOp({ op: 'repo.add', url: 'gh:a/b', name: 'A' })).toBe('validation');
    expect(invalidOp({ op: 'repo.rm', name: 'a@b' })).toBe('validation');
    expect(invalidOp({ op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [] })).toBe(
      'validation',
    );
    expect(
      invalidOp({
        op: 'user.add',
        handle: 'bob',
        name: 'Bob',
        kind: 'robot',
        keys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFhYWEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      }),
    ).toBe('validation');
    expect(invalidOp({ op: 'user.revoke_key', handle: 'bob', key: 'ssh-rsa AAAA' })).toBe(
      'validation',
    );
    expect(
      invalidOp({
        op: 'user.revoke_key',
        handle: 'bob',
        key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFhYWEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        revoked: 'gestern',
      }),
    ).toBe('validation');
    expect(invalidOp({ op: 'user.rm', handle: 'me' })).toBe('validation');
  });

  test('entity.edit: fields from KEY_ORDER of the kind, key valid for the kind', () => {
    const ok = {
      op: 'entity.edit',
      kind: 'project',
      key: 'web/auth',
      set: { lead: { from: null, to: 'spw' } },
    };
    expect(decodeOp(JSON.stringify(ok))).toEqual(ok);
    expect(invalidOp({ ...ok, set: { url: { from: null, to: 'x' } } })).toBe('validation');
    expect(invalidOp({ ...ok, kind: 'issue' })).toBe('validation');
    expect(invalidOp({ ...ok, key: 'Web' })).toBe('validation');
    expect(invalidOp({ ...ok, kind: 'user', key: 'me' })).toBe('validation');
    expect(invalidOp({ ...ok, kind: 'sprint', key: 'a/b' })).toBe('validation');
    expect(invalidOp({ ...ok, kind: 'repo', key: 'a@b' })).toBe('validation');
    expect(invalidOp({ op: 'entity.edit', kind: 'project', key: 'web' })).toBe('validation');
    expect(invalidOp({ op: 'entity.edit', kind: 'project', key: 'web', set: {} })).toBe(
      'validation',
    );
    expect(
      decodeOp(
        JSON.stringify({
          op: 'entity.edit',
          kind: 'repo',
          key: 'webapp',
          body: { from_hash: HASH, to: '' },
        }),
      ).op,
    ).toBe('entity.edit');
  });

  test('entity.edit values follow the core field schema of the kind', () => {
    const edit = (kind: string, key: string, field: string, from: unknown, to: unknown) => ({
      op: 'entity.edit',
      kind,
      key,
      set: { [field]: { from, to } },
    });
    for (const op of [
      edit('project', 'web', 'title', 'Web', 42),
      edit('user', 'bob', 'keys', [], 'y'),
      edit('sprint', 's1', 'closed', null, 'kaputt'),
      edit('project', 'web', 'title', 'Web', null),
      edit('project', 'web', 'title', null, 'Web'),
      edit('repo', 'webapp', 'url', 'kein url', 'gh:acme/webapp'),
      edit('user', 'bob', 'revoked_keys', null, [
        { key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFhYWEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      ]),
    ]) {
      expect(invalidOp(op)).toBe('validation');
      expect(catchErr(() => encodeOp(op as Operation)).code).toBe('validation');
    }
    expect(
      catchErr(() => decodeOp(JSON.stringify(edit('project', 'web', 'title', 'A', 42)))).message,
    ).toMatch(/set\.title\.to/);
    for (const op of [
      edit('project', 'web', 'lead', 'spw', null),
      edit('sprint', 's1', 'closed', null, true),
      edit('repo', 'webapp', 'default_ref', null, 'main'),
      edit('user', 'bob', 'revoked_keys', null, [
        {
          key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFhYWEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          revoked: '2026-11-18T10:04:00Z',
        },
      ]),
      edit(
        'user',
        'bob',
        'keys',
        ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFhYWEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
        [],
      ),
    ]) {
      expect(decodeOp(JSON.stringify(op))).toEqual(op);
    }
  });

  test('sections whose members are all undefined count as empty', () => {
    const undefinedSections = [
      { set: { title: undefined } },
      { add: { projects: undefined } },
      { remove: { depends_on: undefined } },
      { set: { title: { from: 'a', to: 'b' } }, add: { projects: undefined } },
      { props: { k: undefined } },
    ];
    for (const sections of undefinedSections) {
      const op = { op: 'issue.edit', id: ID, ...sections } as Operation;
      expect(catchErr(() => encodeOp(op)).code).toBe('validation');
      expect(OperationSchema.safeParse(op).success).toBe(false);
    }
    expect(
      catchErr(() =>
        encodeOp({
          op: 'entity.edit',
          kind: 'project',
          key: 'web',
          set: { title: undefined },
        } as unknown as Operation),
      ).code,
    ).toBe('validation');
    // Ein fehlender Abschnitt neben einem gefüllten bleibt erlaubt und fällt beim Kodieren weg.
    expect(
      encodeOp({
        op: 'issue.edit',
        id: ID,
        set: { title: { from: 'a', to: 'b' } },
        add: undefined,
      }),
    ).toBe('{"op":"issue.edit","id":"bk-7f3k2","set":{"title":{"from":"a","to":"b"}}}');
  });
});

describe('trailer and batch body', () => {
  test('parseOpTrailer knows the literals', () => {
    expect(parseOpTrailer('batch')).toEqual({ kind: 'batch' });
    expect(parseOpTrailer('manual')).toEqual({ kind: 'manual' });
    expect(parseOpTrailer('init')).toEqual({ kind: 'init' });
    expect(TRAILER_LITERALS).toEqual(['batch', 'manual', 'init']);
    expect(parseOpTrailer('{"op":"issue.claim","id":"bk-7f3k2"}')).toEqual({
      kind: 'op',
      op: { op: 'issue.claim', id: ID },
    });
    expect(catchErr(() => parseOpTrailer('Batch')).code).toBe('validation');
  });

  test('batch body is JSONL with a final newline', () => {
    expect(encodeBatchBody([move, commentAdd])).toBe(
      `${encodeOp(move)}\n${encodeOp(commentAdd)}\n`,
    );
    expect(decodeBatchBody(`${encodeOp(move)}\n${encodeOp(commentAdd)}`)).toEqual([
      move,
      commentAdd,
    ]);
    expect(encodeBatchBody([])).toBe('');
    expect(decodeBatchBody('')).toEqual([]);
  });

  test('decodeBatchBody names the failing line and rejects empty lines', () => {
    const err = catchErr(() => decodeBatchBody(`${encodeOp(move)}\n{"op":"issue.nope"}\n`));
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(/Zeile 2/);
    expect(
      catchErr(() => decodeBatchBody(`${encodeOp(move)}\n\n${encodeOp(move)}\n`)).message,
    ).toMatch(/Zeile 2/);
  });

  test('batch roundtrip', () =>
    fc.assert(
      fc.property(fc.array(arbOperation(), { maxLength: 6 }), (ops) => {
        expect(decodeBatchBody(encodeBatchBody(ops))).toEqual(ops.map(withoutContent));
      }),
      { numRuns: 200 },
    ));
});

describe('bodyHash', () => {
  test('bodyHash ignores line ending style', () => {
    expect(bodyHash('a\r\nb\n')).toBe(bodyHash('a\nb\n'));
    expect(bodyHash('a\rb\r')).toBe(bodyHash('a\nb\n'));
  });

  test('bodyHash is SHA-256 hex', () => {
    expect(bodyHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(bodyHash('a\nb\n')).not.toBe(bodyHash('a\nb'));
  });
});

describe('summaries', () => {
  test.each<[Operation, string]>([
    [move, 'issue move bk-7f3k2 review'],
    [{ op: 'issue.reopen', id: ID, from: 'done', to: 'todo' }, 'issue reopen bk-7f3k2 todo'],
    [{ op: 'issue.reopen', id: ID, from: 'done' }, 'issue reopen bk-7f3k2'],
    [{ op: 'issue.claim', id: ID }, 'issue claim bk-7f3k2'],
    [{ op: 'issue.create', id: ID, title: 'x' }, 'issue create bk-7f3k2'],
    [create, 'issue create $f1'],
    [{ op: 'issue.create', title: 'x' }, 'issue create'],
    [{ op: 'issue.rank', id: ID, from: null, top: true }, 'issue rank bk-7f3k2 --top'],
    [{ op: 'issue.rank', id: ID, from: 3, bottom: true }, 'issue rank bk-7f3k2 --bottom'],
    [{ op: 'issue.rank', id: ID, from: 3, before: OTHER }, 'issue rank bk-7f3k2 --before bk-a91c0'],
    [{ op: 'issue.rank', id: ID, from: 3, after: OTHER }, 'issue rank bk-7f3k2 --after bk-a91c0'],
    [{ op: 'issue.rank', id: ID, from: 3, value: -20 }, 'issue rank bk-7f3k2 -20'],
    [commentAdd, 'comment add bk-7f3k2'],
    [{ op: 'attach.rm', id: ID, name: 'trace' }, 'attach rm bk-7f3k2'],
    [{ op: 'project.create', path: 'web/auth', title: 'Auth' }, 'project create web/auth'],
    [
      { op: 'project.mv', from: 'web/auth', to: 'platform/auth' },
      'project mv web/auth platform/auth',
    ],
    [{ op: 'project.rm', path: 'web', detach: true }, 'project rm web'],
    [{ op: 'sprint.close', slug: 's1' }, 'sprint close s1'],
    [{ op: 'repo.add', url: 'gh:acme/webapp', name: 'webapp' }, 'repo add webapp'],
    [{ op: 'repo.add', url: 'gh:acme/webapp' }, 'repo add gh:acme/webapp'],
    [{ op: 'repo.rm', name: 'webapp' }, 'repo rm webapp'],
    [{ op: 'user.rm', handle: 'bob' }, 'user rm bob'],
    [
      {
        op: 'user.revoke_key',
        handle: 'bob',
        key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGFhYWEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      'user revoke_key bob',
    ],
    [
      { op: 'entity.edit', kind: 'sprint', key: 's1', set: { title: { from: 'a', to: 'b' } } },
      'entity edit sprint s1',
    ],
  ])('%j → %s', (op, expected) => expect(summarizeOp(op)).toBe(expected));

  test('summarizeBatch counts by verb', () =>
    expect(summarizeBatch([create, create, move, commentAdd])).toBe(
      'batch: 2 create, 1 move, 1 comment.add',
    ));

  test('summarizeBatch keeps the order of first appearance', () =>
    expect(
      summarizeBatch([commentAdd, move, { op: 'repo.rm', name: 'x' }, commentAdd, create]),
    ).toBe('batch: 2 comment.add, 1 move, 1 repo.rm, 1 create'));
});

describe('issue id fields', () => {
  const map = new Map([
    ['$f1', 'bk-00001'],
    [ID, 'bk-00002'],
  ]);

  test('substituteIds reaches every id field', () => {
    const cases: [Operation, Operation][] = [
      [
        { op: 'issue.claim', id: '$f1' },
        { op: 'issue.claim', id: 'bk-00001' },
      ],
      [
        {
          op: 'issue.create',
          ref: '$f9',
          id: ID,
          title: '$f1',
          parent: '$f1',
          depends_on: ['$f1', OTHER],
          blocked_by: ['$f1'],
        },
        {
          op: 'issue.create',
          ref: '$f9',
          id: 'bk-00002',
          title: '$f1',
          parent: 'bk-00001',
          depends_on: ['bk-00001', OTHER],
          blocked_by: ['bk-00001'],
        },
      ],
      [
        { op: 'issue.move', id: '$f1', from: 'todo', to: 'blocked', blocked_by: ['$f1'] },
        { op: 'issue.move', id: 'bk-00001', from: 'todo', to: 'blocked', blocked_by: ['bk-00001'] },
      ],
      [
        { op: 'issue.rank', id: OTHER, from: null, before: '$f1' },
        { op: 'issue.rank', id: OTHER, from: null, before: 'bk-00001' },
      ],
      [
        { op: 'issue.rank', id: OTHER, from: null, after: '$f1' },
        { op: 'issue.rank', id: OTHER, from: null, after: 'bk-00001' },
      ],
      [
        {
          op: 'issue.edit',
          id: OTHER,
          set: { title: { from: '$f1', to: '$f1' }, parent: { from: '$f1', to: ID } },
          add: { projects: ['api'], depends_on: ['$f1'], blocked_by: ['$f1'] },
          remove: { depends_on: ['$f1'], blocked_by: [ID] },
        },
        {
          op: 'issue.edit',
          id: OTHER,
          set: { title: { from: '$f1', to: '$f1' }, parent: { from: 'bk-00001', to: 'bk-00002' } },
          add: { projects: ['api'], depends_on: ['bk-00001'], blocked_by: ['bk-00001'] },
          remove: { depends_on: ['bk-00001'], blocked_by: ['bk-00002'] },
        },
      ],
      [
        { op: 'issue.edit', id: OTHER, set: { parent: { from: null, to: '$f1' } } },
        { op: 'issue.edit', id: OTHER, set: { parent: { from: null, to: 'bk-00001' } } },
      ],
      [
        { op: 'issue.delete', id: '$f1', blocker_comments: { [OTHER]: FILE, $f1: FILE } },
        {
          op: 'issue.delete',
          id: 'bk-00001',
          blocker_comments: { [OTHER]: FILE, 'bk-00001': FILE },
        },
      ],
      [
        { op: 'comment.add', id: '$f1', body: '$f1' },
        { op: 'comment.add', id: 'bk-00001', body: '$f1' },
      ],
      [
        { op: 'project.mv', from: 'a', to: 'b' },
        { op: 'project.mv', from: 'a', to: 'b' },
      ],
    ];
    for (const [input, expected] of cases) {
      const before = structuredClone(input);
      const out = substituteIds(input, map);
      expect(out).toEqual(expected);
      expect(Object.keys(out)).toEqual(Object.keys(expected));
      expect(input).toEqual(before);
    }
  });

  test('substituteIds keeps blocker_comments key order and content', () => {
    const content = Uint8Array.of(1, 2);
    const out = substituteIds({ op: 'attach.add', id: '$f1', name: 'a', file: 'a', content }, map);
    expect(out).toEqual({ op: 'attach.add', id: 'bk-00001', name: 'a', file: 'a', content });
    const del = substituteIds(
      { op: 'issue.delete', id: OTHER, blocker_comments: { $f1: FILE, 'bk-00009': FILE } },
      map,
    );
    expect(del.op === 'issue.delete' && Object.keys(del.blocker_comments ?? {})).toEqual([
      'bk-00001',
      'bk-00009',
    ]);
  });

  test('referencedIds lists every id field once', () => {
    expect(
      referencedIds({
        op: 'issue.create',
        ref: '$f9',
        title: 'x',
        parent: '$f1',
        depends_on: ['$f1', OTHER],
        blocked_by: [ID],
      }),
    ).toEqual(['$f1', OTHER, ID]);
    expect(
      referencedIds({
        op: 'issue.edit',
        id: ID,
        set: { parent: { from: OTHER, to: null } },
        add: { depends_on: ['$f2'], projects: ['api'] },
        remove: { blocked_by: [ID] },
      }),
    ).toEqual([ID, OTHER, '$f2']);
    expect(
      referencedIds({ op: 'issue.delete', id: ID, blocker_comments: { [OTHER]: FILE } }),
    ).toEqual([ID, OTHER]);
    expect(referencedIds({ op: 'project.mv', from: 'a', to: 'b' })).toEqual([]);
    expect(
      referencedIds({ op: 'issue.edit', id: ID, set: { assignee: { from: null, to: 'spw' } } }),
    ).toEqual([ID]);
    expect(referencedIds({ op: 'issue.rank', id: ID, from: 1, after: OTHER })).toEqual([ID, OTHER]);
  });
});
