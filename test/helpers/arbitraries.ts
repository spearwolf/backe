import fc from 'fast-check';
import { isGitArg } from '../../src/core/names.ts';
import { KEY_ORDER, type PropValue } from '../../src/core/schemas.ts';

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
