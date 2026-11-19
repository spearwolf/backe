import fc from 'fast-check';
import { isGitArg } from '../../src/core/names.ts';
import { type Issue, KEY_ORDER, type PropValue } from '../../src/core/schemas.ts';
import type { State } from '../../src/core/state.ts';
import type { Operation } from '../../src/ops/operation.ts';
import { serializeEntityFile } from '../../src/store/frontmatter.ts';
import { commentFileName } from '../../src/store/layout.ts';

/**
 * Bausteine, an denen YAML-Quoting typischerweise scheitert: Indikatoren am Anfang,
 * `: ` und ` #` mitten im Text, Zeilenumbrüche, Steuerzeichen, Werte, die das
 * Core-Schema als Zahl, Boolean oder null lesen würde.
 */
const TRICKY_PIECES = [
  ': ',
  ' #',
  '#',
  '- ',
  '-',
  '---',
  '...',
  '? ',
  ':',
  ',',
  '[',
  ']',
  '{',
  '}',
  '&a',
  '*a',
  '!x',
  '!!str',
  '%',
  '@',
  '`',
  '|',
  '>',
  '"',
  "'",
  '\\',
  ' ',
  '  ',
  '\t',
  '\n',
  '\r',
  '\r\n',
  '\0',
  '\u0085',
  '\u2028',
  '\ufeff',
  'true',
  'false',
  'null',
  '~',
  'yes',
  '0x1f',
  '0o17',
  '1e3',
  '.inf',
  '.nan',
  '4',
  '-1.5',
  '2026-11-18',
  '2026-11-18T10:04:00Z',
  'a',
  'é',
  '😀',
];

/** Beliebige Strings mit Schwerpunkt auf YAML-Sonderfällen. */
export function arbString(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.string({ unit: fc.constantFrom(...TRICKY_PIECES), maxLength: 8 }),
    fc.string({ unit: 'binary', maxLength: 20 }),
    fc.string({ unit: 'grapheme', maxLength: 20 }),
    fc.string(),
  );
}

const arbNumber = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
);

const arbScalar: fc.Arbitrary<PropValue> = fc.oneof(arbString(), arbNumber, fc.boolean());

const arbPropKey = fc.stringMatching(/^[a-z][a-z0-9_.-]{0,15}$/);

/**
 * Verschachtelte Property-Werte: Skalare, Listen und Maps beliebiger Strings. `__proto__` ist
 * als Key ausgenommen, wie beim Top-Level-Generator (validateEntity lehnt ihn ab).
 */
const { propValue: arbPropValue } = fc.letrec<{ propValue: PropValue }>((tie) => ({
  propValue: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    arbScalar,
    fc.array(tie('propValue'), { maxLength: 5 }),
    fc.dictionary(
      arbString().filter((k) => k !== '__proto__'),
      tie('propValue'),
      { maxKeys: 4, noNullPrototype: true },
    ),
  ),
}));

const ID_ALPHABET = [...'0123456789abcdefghjkmnpqrstvwxyz'];
const arbIssueId = fc
  .string({ unit: fc.constantFrom(...ID_ALPHABET), minLength: 5, maxLength: 6 })
  .map((s) => `bk-${s}`);
const arbHandle = fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,31}$/).filter((h) => h !== 'me');
const arbProject = fc
  .array(fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,12}$/), { minLength: 1, maxLength: 5 })
  .map((segs) => segs.join('/'));
const arbSprint = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/);
const arbRepo = fc
  .tuple(fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}$/), fc.option(arbString().filter(isGitArg)))
  .map(([name, ref]) => (ref === null ? name : `${name}@${ref}`));
const arbTimestamp = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T23:59:59Z'),
    noInvalidDate: true,
  })
  .map((d) => `${d.toISOString().slice(0, 19)}Z`);
const arbTitle = arbString().filter(
  (s) => s.length > 0 && [...s].length <= 200 && !/[\r\n]/.test(s),
);

const arbAttachment = fc.oneof(
  fc.record({
    name: fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}$/),
    file: arbString().filter((s) => s !== '' && !s.includes('/')),
  }),
  fc.record({
    name: fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}$/),
    url: arbString().map((s) => `https://example.com/${s}`),
  }),
);

function nonEmptyUnique<T>(arb: fc.Arbitrary<T>, maxLength: number): fc.Arbitrary<T[]> {
  return fc.uniqueArray(arb, { minLength: 1, maxLength });
}

/** Status samt der davon abhängigen Pflichtfelder (`blocked_by`, `paused_from`). */
const arbStateFields = fc.oneof(
  fc.record({
    state: fc.constantFrom(
      'backlog',
      'todo',
      'in_progress',
      'review',
      'done',
      'cancelled',
      'rejected',
    ),
  }),
  fc.record({
    state: fc.constant('blocked'),
    blocked_by: nonEmptyUnique(arbIssueId, 4),
    paused_from: fc.constantFrom('backlog', 'todo', 'in_progress', 'review'),
  }),
  fc.record({
    state: fc.constant('on_hold'),
    paused_from: fc.constantFrom('backlog', 'todo', 'in_progress', 'review'),
  }),
);

/**
 * Unbekannte Top-Level-Keys (backe.md §2.3), auch integer-artige wie `"2"`, die JS-Objekte
 * vor alle anderen Keys stellen. Werte wie bei `props`, oben ohne leere Liste (kanonisch).
 */
const arbUnknownTopLevel = fc.dictionary(
  fc
    .oneof(fc.stringMatching(/^[a-z_][a-z0-9_]{0,10}$/), fc.nat({ max: 999 }).map(String))
    .filter((k) => !KEY_ORDER.issue.includes(k) && k !== '__proto__'),
  arbPropValue.filter((v) => !(Array.isArray(v) && v.length === 0)),
  { maxKeys: 3, noNullPrototype: true },
);

/**
 * Gültige, kanonische Issue-Frontmatter (backe.md §2.4): keine leeren Listen, keine leeren
 * `props`, kein `null`, kein `undefined`, nur endliche Zahlen ohne `-0`. Dazu bis zu drei
 * unbekannte Top-Level-Keys.
 */
export function arbIssueData(): fc.Arbitrary<Record<string, unknown>> {
  const optional = fc.record(
    {
      parent: arbIssueId,
      depends_on: nonEmptyUnique(arbIssueId, 4),
      rank: fc.integer(),
      assignee: arbHandle,
      projects: nonEmptyUnique(arbProject, 6),
      sprints: nonEmptyUnique(arbSprint, 6),
      repos: nonEmptyUnique(arbRepo, 4),
      attachments: fc.uniqueArray(arbAttachment, {
        minLength: 1,
        maxLength: 3,
        selector: (a) => a.name,
      }),
      props: fc.dictionary(arbPropKey, arbPropValue, {
        minKeys: 1,
        maxKeys: 6,
        noNullPrototype: true,
      }),
    },
    { requiredKeys: [] },
  );
  return fc
    .tuple(
      fc.record({ id: arbIssueId, title: arbTitle, creator: arbHandle, created: arbTimestamp }),
      arbStateFields,
      optional,
      arbUnknownTopLevel,
    )
    .map(
      ([base, stateFields, rest, unknown]): Record<string, unknown> => ({
        ...unknown,
        ...base,
        ...stateFields,
        ...rest,
      }),
    )
    .filter((d) => {
      const own = (list: unknown) => Array.isArray(list) && list.includes(d.id);
      return d.parent !== d.id && !own(d.blocked_by) && !own(d.depends_on);
    });
}

// --- Operationen (backe.md §2.16.4) ---------------------------------------------------

const arbPlaceholder = fc.stringMatching(/^\$[A-Za-z0-9_-]{1,32}$/);
const arbIssueRef = fc.oneof(arbIssueId, arbPlaceholder);
const arbState: fc.Arbitrary<State> = fc.constantFrom(
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked',
  'on_hold',
  'cancelled',
  'rejected',
);
const arbHash = fc.stringMatching(/^[0-9a-f]{64}$/);
const arbCommentFile = fc
  .tuple(
    arbTimestamp,
    arbHandle,
    fc.string({ unit: fc.constantFrom(...ID_ALPHABET), minLength: 3, maxLength: 3 }),
  )
  .map(([created, author, rnd]) => commentFileName(created, author, rnd));
const arbRepoName = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}$/);
const arbAttachName = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}$/);
const arbAttachFile = arbString().filter(
  (s) => s !== '' && s !== '.' && s !== '..' && !s.includes('/'),
);
const arbHttpUrl = arbString().map((s) => `https://example.com/${s}`);
const arbRepoUrl = fc
  .tuple(
    fc.constantFrom('https://github.com/', 'ssh://git@example.com/', 'gh:', '/srv/git/'),
    fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,10}$/),
    fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,10}$/),
  )
  .map(([base, owner, repo]) => `${base}${owner}/${repo}`);
const arbGitArg = arbString().filter(isGitArg);
const arbSshKey = fc
  .tuple(
    // Ein gültiger ed25519-Blob: Typ-Feld plus 32 Byte Schlüsseldaten.
    fc
      .uint8Array({ minLength: 32, maxLength: 32 })
      .map((material) =>
        Buffer.concat([
          Buffer.from([0, 0, 0, 11]),
          Buffer.from('ssh-ed25519'),
          Buffer.from([0, 0, 0, 32]),
          material,
        ]).toString('base64'),
      ),
    fc.option(arbString().filter((s) => !/[\r\n]/.test(s))),
  )
  .map(([b64, comment]) => `ssh-ed25519 ${b64}${comment === null ? '' : ` ${comment}`}`);
const arbDate = arbTimestamp.map((t) => t.slice(0, 10));
const arbReason = arbString().filter((s) => s !== '');
const arbRefList = nonEmptyUnique(arbIssueRef, 4);
const arbPropOrNull = fc.option(arbPropValue, { nil: null });

function fromTo<T>(arb: fc.Arbitrary<T>) {
  return fc.record({ from: arb, to: arb });
}

const arbBodyEdit = fc.record({ from_hash: arbHash, to: arbString() });

/** Record, dessen Schlüssel alle optional sind. */
function opt<T extends Record<string, fc.Arbitrary<unknown>>>(model: T) {
  return fc.record(model, { requiredKeys: [] });
}

/** Wie `opt`, aber mit mindestens einem gesetzten Schlüssel. */
function someOf<T extends Record<string, fc.Arbitrary<unknown>>>(model: T) {
  return opt(model).filter((o) => Object.keys(o).length > 0);
}

/** Pflichtfelder plus optionale Felder einer Katalogzeile. */
function variant<N extends string>(
  op: N,
  required: Record<string, fc.Arbitrary<unknown>>,
  optional: Record<string, fc.Arbitrary<unknown>> = {},
) {
  return fc
    .tuple(fc.record(required), opt(optional))
    .map(([req, rest]) => ({ op, ...req, ...rest }));
}

/** Hängt genau eine der Alternativen an den Kopf. */
function withOneOf(
  head: fc.Arbitrary<Record<string, unknown>>,
  ...alternatives: fc.Arbitrary<Record<string, unknown>>[]
) {
  return fc.tuple(head, fc.oneof(...alternatives)).map(([h, alt]) => ({ ...h, ...alt }));
}

const arbListSection = someOf({
  projects: nonEmptyUnique(arbProject, 3),
  sprints: nonEmptyUnique(arbSprint, 3),
  repos: nonEmptyUnique(arbRepo, 3),
  depends_on: arbRefList,
  blocked_by: arbRefList,
});

const arbIssueEditOp = fc
  .tuple(
    arbIssueRef,
    someOf({
      set: someOf({
        title: fromTo(arbTitle),
        parent: fromTo(fc.option(arbIssueRef, { nil: null })),
        assignee: fromTo(fc.option(arbHandle, { nil: null })),
      }),
      add: arbListSection,
      remove: arbListSection,
      props: fc.dictionary(arbPropKey, fromTo(arbPropOrNull), {
        minKeys: 1,
        maxKeys: 4,
        noNullPrototype: true,
      }),
      body: arbBodyEdit,
    }),
  )
  .map(([id, sections]) => ({ op: 'issue.edit', id, ...sections }));

const ENTITY_KEY_ARBS = {
  project: arbProject,
  sprint: arbSprint,
  repo: arbRepoName,
  user: arbHandle,
} as const;

type FieldArb = { value: fc.Arbitrary<unknown>; optional: boolean };
const required = (value: fc.Arbitrary<unknown>): FieldArb => ({ value, optional: false });
const optional = (value: fc.Arbitrary<unknown>): FieldArb => ({ value, optional: true });

/** Gültige Werte je Feld der Entität, wie die Kernschemas sie verlangen. */
const ENTITY_FIELD_ARBS: Record<
  'project' | 'sprint' | 'repo' | 'user',
  Record<string, FieldArb>
> = {
  project: { title: required(arbTitle), lead: optional(arbHandle) },
  sprint: {
    title: required(arbTitle),
    start: optional(arbDate),
    end: optional(arbDate),
    closed: optional(fc.boolean()),
  },
  repo: { url: required(arbRepoUrl), default_ref: optional(arbGitArg) },
  user: {
    name: required(arbTitle),
    kind: required(fc.constantFrom('human', 'agent')),
    operator: optional(arbHandle),
    keys: required(fc.uniqueArray(arbSshKey, { maxLength: 2 })),
    revoked_keys: optional(
      fc.array(fc.record({ key: arbSshKey, revoked: arbTimestamp }), { maxLength: 2 }),
    ),
  },
};

function arbFieldChange({ value, optional }: FieldArb) {
  return fromTo(optional ? fc.option(value, { nil: null }) : value);
}

const arbEntityEdit = fc
  .constantFrom(...(['project', 'sprint', 'repo', 'user'] as const))
  .chain((kind) => {
    const fields = ENTITY_FIELD_ARBS[kind];
    const arbSet = fc
      .shuffledSubarray([...KEY_ORDER[kind]], { minLength: 1 })
      .chain((names) =>
        fc.tuple(
          ...names.map((name) => {
            const field = fields[name];
            if (field === undefined) throw new Error(`kein Generator für ${kind}.${name}`);
            return arbFieldChange(field).map((change) => [name, change] as const);
          }),
        ),
      )
      .map((entries) => Object.fromEntries(entries));
    return fc
      .tuple(ENTITY_KEY_ARBS[kind], someOf({ set: arbSet, body: arbBodyEdit }))
      .map(([key, sections]) => ({ op: 'entity.edit', kind, key, ...sections }));
  });

/** Gültige Operationen aus allen Einträgen des Operationskatalogs, `content` inklusive. */
export function arbOperation(): fc.Arbitrary<Operation> {
  const pausedFrom = fc.constantFrom('backlog', 'todo', 'in_progress', 'review');
  // `reason_file` gibt es nur zusammen mit `reason`.
  const reasonAlternatives = [
    fc.constant({}),
    fc.record({ reason: arbReason }),
    fc.record({ reason: arbReason, reason_file: arbCommentFile }),
  ] as const;
  const arbs = [
    variant(
      'issue.create',
      { title: arbTitle },
      {
        ref: arbPlaceholder,
        id: arbIssueId,
        body: arbString(),
        state: arbState,
        blocked_by: arbRefList,
        paused_from: pausedFrom,
        parent: arbIssueRef,
        depends_on: arbRefList,
        rank: fc.integer(),
        assignee: arbHandle,
        projects: fc.uniqueArray(arbProject, { maxLength: 3 }),
        sprints: fc.uniqueArray(arbSprint, { maxLength: 3 }),
        repos: fc.uniqueArray(arbRepo, { maxLength: 3 }),
        props: fc.dictionary(arbPropKey, arbPropValue, {
          minKeys: 1,
          maxKeys: 4,
          noNullPrototype: true,
        }),
        created: arbTimestamp,
      },
    ),
    arbIssueEditOp,
    withOneOf(
      variant(
        'issue.move',
        { id: arbIssueRef, from: arbState, to: arbState },
        { blocked_by: arbRefList, force: fc.constant(true) },
      ),
      ...reasonAlternatives,
    ),
    withOneOf(
      variant('issue.resume', { id: arbIssueRef, from: fc.constantFrom('blocked', 'on_hold') }),
      ...reasonAlternatives,
    ),
    withOneOf(
      variant(
        'issue.reopen',
        { id: arbIssueRef, from: fc.constantFrom('done', 'cancelled', 'rejected') },
        { to: pausedFrom },
      ),
      ...reasonAlternatives,
    ),
    variant('issue.claim', { id: arbIssueRef }),
    withOneOf(
      variant('issue.rank', { id: arbIssueRef, from: fc.option(fc.integer(), { nil: null }) }),
      fc.record({ top: fc.constant(true) }),
      fc.record({ bottom: fc.constant(true) }),
      fc.record({ before: arbIssueRef }),
      fc.record({ after: arbIssueRef }),
      fc.record({ value: fc.integer() }),
    ),
    withOneOf(
      variant('issue.link', { id: arbIssueRef }, { ref: arbGitArg }),
      fc.record({ repo: arbRepoName }),
      fc.record({ url: arbRepoUrl }),
    ),
    variant('issue.unlink', { id: arbIssueRef, repo: arbRepoName }),
    variant(
      'issue.delete',
      { id: arbIssueRef },
      {
        force: fc.constant(true),
        children: fc.constantFrom('orphan', 'recursive'),
        blocker_comments: fc.dictionary(arbIssueRef, arbCommentFile, {
          maxKeys: 3,
          noNullPrototype: true,
        }),
      },
    ),
    variant('comment.add', { id: arbIssueRef, body: arbString() }, { file: arbCommentFile }),
    variant('comment.edit', {
      id: arbIssueRef,
      file: arbCommentFile,
      from_hash: arbHash,
      body: arbString(),
    }),
    variant('comment.delete', { id: arbIssueRef, file: arbCommentFile }),
    withOneOf(
      variant('attach.add', { id: arbIssueRef, name: arbAttachName }),
      fc.record(
        { file: arbAttachFile, content: fc.uint8Array({ maxLength: 8 }) },
        { requiredKeys: ['file'] },
      ),
      fc.record({ url: arbHttpUrl }),
    ),
    variant('attach.rm', { id: arbIssueRef, name: arbAttachName }),
    variant(
      'project.create',
      { path: arbProject, title: arbTitle },
      { lead: arbHandle, body: arbString() },
    ),
    variant('project.mv', { from: arbProject, to: arbProject }),
    withOneOf(
      variant('project.rm', { path: arbProject }),
      fc.constant({}),
      fc.record({ reassign: arbProject }),
      fc.record({ detach: fc.constant(true) }),
    ),
    variant(
      'sprint.create',
      { slug: arbSprint, title: arbTitle },
      { start: arbDate, end: arbDate, body: arbString() },
    ),
    variant('sprint.close', { slug: arbSprint }, { carry_over: arbSprint }),
    variant(
      'repo.add',
      { url: arbRepoUrl },
      { name: arbRepoName, default_ref: arbGitArg, body: arbString() },
    ),
    variant('repo.rm', { name: arbRepoName }),
    variant(
      'user.add',
      {
        handle: arbHandle,
        name: arbTitle,
        kind: fc.constantFrom('human', 'agent'),
        keys: nonEmptyUnique(arbSshKey, 2),
      },
      { operator: arbHandle, body: arbString() },
    ),
    variant('user.revoke_key', { handle: arbHandle, key: arbSshKey }, { revoked: arbTimestamp }),
    variant('user.rm', { handle: arbHandle }),
    arbEntityEdit,
  ];
  // Die Generatoren sind nur strukturell typisiert; der Roundtrip-Test prüft jede Ausgabe
  // gegen OperationSchema.
  return fc.oneof(...arbs) as fc.Arbitrary<unknown> as fc.Arbitrary<Operation>;
}

// --- Hand-Edits (backe.md §2.13) ------------------------------------------------------

/**
 * Das feste Issue für `arbIssueEdit`: mit `rank`, `assignee`, `props`, Body und dem unbekannten
 * Key `legacy`. Die Assignees der Nachher-Datei kommen aus den Default-Users von `snap()`.
 */
export const EDIT_ISSUE: { data: Issue; extra: [string, unknown][]; body: string } = {
  data: {
    id: 'bk-t0001',
    title: 'T',
    state: 'todo',
    rank: 1000,
    creator: 'spw',
    assignee: 'alice',
    created: '2026-11-18T10:00:00Z',
    props: { size: 3, team: 'core' },
  },
  extra: [['legacy', 'alt']],
  body: 'Body.\n',
};

const EDIT_ASSIGNEES = ['spw', 'alice', 'claude-1'];

/**
 * Vorher-/Nachher-Datei eines Hand-Edits an `EDIT_ISSUE`: beide kanonisch, in der Nachher-Datei
 * sind `title`, `rank`, `assignee`, `props` und Body beliebig geändert (`assignee` und `props`
 * auch entfernt), `legacy` bleibt. Der Rank bleibt gesetzt, weil sein Entfernen keine Operation hat.
 */
export function arbIssueEdit(): fc.Arbitrary<{ before: string; after: string }> {
  const { data, extra, body } = EDIT_ISSUE;
  const before = serializeEntityFile('issue', data, body, extra);
  return fc
    .record({
      title: fc.option(arbTitle, { nil: undefined }),
      rank: fc.option(fc.integer(), { nil: undefined }),
      assignee: fc.option(fc.option(fc.constantFrom(...EDIT_ASSIGNEES), { nil: null }), {
        nil: undefined,
      }),
      props: fc.option(
        fc.option(fc.dictionary(arbPropKey, arbPropValue, { maxKeys: 4, noNullPrototype: true }), {
          nil: null,
        }),
        { nil: undefined },
      ),
      body: fc.option(arbString(), { nil: undefined }),
    })
    .map((change) => {
      const next: Record<string, unknown> = { ...data };
      if (change.title !== undefined) next.title = change.title;
      if (change.rank !== undefined) next.rank = change.rank;
      if (change.assignee !== undefined) next.assignee = change.assignee ?? undefined;
      if (change.props !== undefined) next.props = change.props ?? undefined;
      const after = serializeEntityFile('issue', next, change.body ?? body, extra);
      return { before, after };
    });
}
