import fc from 'fast-check';
import { arbIssueData } from '../../test/helpers/arbitraries.ts';
import { catchErr } from '../../test/helpers/catch.ts';
import { readFixture } from '../../test/helpers/fixtures.ts';
import { validateEntity } from '../core/schemas.ts';
import { parseEntityFile, serializeEntityFile } from './frontmatter.ts';

const minimalIssue = {
  id: 'bk-7f3k2',
  title: 'SSO-Login bricht ab',
  state: 'todo',
  creator: 'spw',
  created: '2026-11-18T10:04:00Z',
};

const MINIMAL_YAML =
  'id: bk-7f3k2\ntitle: SSO-Login bricht ab\nstate: todo\ncreator: spw\ncreated: 2026-11-18T10:04:00Z\n';

const issueFile = readFixture('issue.md'); // das Beispiel aus backe.md §2.4, wörtlich

describe('Brief', () => {
  test('spec example is canonical (byte-identical roundtrip)', () => {
    const { data, body } = parseEntityFile(issueFile, 'issue.md');
    expect(serializeEntityFile('issue', data, body)).toBe(issueFile);
  });

  test('canonical output is idempotent (property)', () => {
    fc.assert(
      fc.property(arbIssueData(), fc.string(), (data, body) => {
        const once = serializeEntityFile('issue', data, body);
        const p = parseEntityFile(once, 'f');
        expect(p.data).toEqual(data);
        expect(serializeEntityFile('issue', p.data, p.body)).toBe(once);
      }),
    );
  });

  test.each([
    'true',
    'null',
    '~',
    '0x1f',
    '1e3',
    '.inf',
    '4',
    'a: b',
    '[x]',
    '- x',
    '* x',
    '&a',
    '!x',
    '# x',
    'yes',
    '2026-11-18',
  ])('canonical roundtrip keeps ambiguous strings: %s', (s) => {
    const data = { ...minimalIssue, title: s, props: { v: s } };
    expect(parseEntityFile(serializeEntityFile('issue', data, ''), 'f').data).toEqual(data);
  });

  test('tolerates hand-edited file edges', () => {
    const crlf = '\ufeff---\r\nid: bk-7f3k2\r\n---\r\nText\r\n\r\n---\r\nmehr';
    const { body } = parseEntityFile(crlf, 'f');
    expect(body).toBe('Text\n\n---\nmehr'); // --- im Body bleibt Body
    expect(serializeEntityFile('issue', minimalIssue, body).endsWith('mehr\n')).toBe(true);
    expect(parseEntityFile('---\nid: bk-7f3k2\n---\n', 'f').body).toBe('');
  });

  test.each([
    ['anchor', 'x: &a 1\n'],
    ['alias', 'x: &a 1\ny: *a\n'],
    ['tag', 'x: !!str 1\n'],
    ['comment', 'x: 1 # c\n'],
  ])('rejects %s with file:line', (_, yaml) => {
    const err = catchErr(() =>
      parseEntityFile(`---\nid: bk-7f3k2\n${yaml}---\n`, 'issues/7f/bk-7f3k2/issue.md'),
    );
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(/issues\/7f\/bk-7f3k2\/issue\.md:\d+/);
  });

  test('missing frontmatter fence is a validation error', () =>
    expect(catchErr(() => parseEntityFile('Nur Text', 'f')).code).toBe('validation'));

  test('unknown keys go after known keys, props stay last', () => {
    const out = serializeEntityFile(
      'issue',
      { ...minimalIssue, zeta: 1, props: { b: 1, a: 2 } },
      '',
    );
    expect(out).toMatch(/created: .*\nzeta: 1\nprops:\n {2}a: 2\n {2}b: 1\n---\n$/);
  });

  test('long lists switch to block style', () => {
    const projects = Array.from({ length: 12 }, (_, i) => `project-number-${i}`);
    expect(serializeEntityFile('issue', { ...minimalIssue, projects }, '')).toContain(
      'projects:\n  - project-number-0\n',
    );
  });
});

describe('arbIssueData', () => {
  test('erzeugt gültige Issues', () => {
    fc.assert(
      fc.property(arbIssueData(), (data) => {
        expect(() => validateEntity('issue', data, 'f')).not.toThrow();
      }),
      { numRuns: 50 },
    );
  });
});

describe('parseEntityFile', () => {
  const parse = (yaml: string, body = '') => parseEntityFile(`---\n${yaml}---\n${body}`, 'f.md');
  const fail = (yaml: string) => catchErr(() => parse(yaml));

  test('Zeitstempel und Daten bleiben Strings, Zahlen und Booleans werden getypt', () => {
    expect(
      parse('a: 2026-11-18T10:04:00Z\nb: 2026-11-18\nc: 4\nd: true\ne: 1.5\nf: yes\n').data,
    ).toEqual({
      a: '2026-11-18T10:04:00Z',
      b: '2026-11-18',
      c: 4,
      d: true,
      e: 1.5,
      f: 'yes',
    });
  });

  test('Key-Reihenfolge folgt der Datei', () => {
    expect(Object.keys(parse('state: todo\nid: x\nzeta: 1\n').data)).toEqual([
      'state',
      'id',
      'zeta',
    ]);
  });

  test('Block-Sequenzen, Flow-Maps und Block-Maps werden gelesen', () => {
    expect(parse('l:\n  - a\n  - {x: 1}\nm:\n  k: [1, b]\n').data).toEqual({
      l: ['a', { x: 1 }],
      m: { k: [1, 'b'] },
    });
  });

  test('leeres Frontmatter ist eine leere Map', () => {
    expect(parse('')).toEqual({ data: {}, body: '' });
  });

  test('der Body bleibt unverändert, auch ohne abschließenden Newline', () => {
    expect(parse('id: x\n', '\n  Text  \n\n\n').body).toBe('\n  Text  \n\n\n');
    expect(parseEntityFile('---\nid: x\n---', 'f').body).toBe('');
    expect(parseEntityFile('---\nid: x\n---\nA', 'f').body).toBe('A');
  });

  test('__proto__ als Key wird ein eigenes Feld', () => {
    const { data } = parse('__proto__: 1\n');
    expect(Object.keys(data)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  });

  test('Zeile 1 muss exakt --- sein', () => {
    for (const text of ['', '--- \nid: x\n---\n', ' ---\nid: x\n---\n', 'id: x\n---\n']) {
      const err = catchErr(() => parseEntityFile(text, 'f.md'));
      expect(err.code).toBe('validation');
      expect(err.message).toMatch(/^f\.md:1: /);
    }
  });

  test('fehlende schließende Zeile ist ein Fehler', () => {
    for (const text of [
      '---',
      '---\n',
      '---\nid: x\n',
      '---\nid: x\n--- \n',
      '---\nid: x\n----\n',
    ]) {
      const err = catchErr(() => parseEntityFile(text, 'f.md'));
      expect(err.code).toBe('validation');
      expect(err.message).toMatch(/^f\.md:1: /);
    }
  });

  test.each([
    ['Anker', 'a: 1\nb: &x 2\n', 3],
    ['Alias', 'a: 1\nb: *x\n', 3],
    ['Tag', 'a: 1\nb: !!str 2\n', 3],
    ['lokaler Tag', 'a: 1\nb: !foo 2\n', 3],
    ['Kommentar am Zeilenende', 'a: 1\nb: 2 # c\n', 3],
    ['Kommentarzeile', 'a: 1\n# c\nb: 2\n', 3],
    ['Kommentar am Ende', 'a: 1\nb: 2\n# c\n', 4],
    ['Kommentar in Flow-Sequenz', 'a: [1, # c\n  2]\n', 2],
    ['zweites Dokument', 'a: 1\n--- b\n', 3],
    ['Dokument-Ende', 'a: 1\n...\n', 3],
    ['null', 'a: 1\nb: null\n', 3],
    ['Tilde', 'a: 1\nb: ~\n', 3],
    ['leerer Wert', 'a: 1\nb:\nc: 2\n', 3],
    ['leerer Listeneintrag', 'a:\n  - x\n  -\n', 4],
    ['null in Flow-Map', 'a: {x}\n', 2],
    ['Zahl als Key', 'a: 1\n4: x\n', 3],
    ['Boolean als Key', 'a: 1\ntrue: x\n', 3],
    ['Liste als Key', 'a: 1\n? [x]\n: y\n', 3],
    ['doppelter Key', 'a: 1\nb: 2\na: 3\n', 4],
    ['Syntaxfehler', 'a: 1\nb: [x\n', 4],
    ['falsche Einrückung', 'a: 1\n b: 2\n', 2],
  ])('lehnt %s mit Zeilennummer ab', (_, yaml, line) => {
    const err = fail(yaml);
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(new RegExp(`^f\\.md:${line}: `));
  });

  test.each([
    ['Skalar', 'x\n'],
    ['Liste', '- x\n'],
    ['null', '~\n'],
  ])('Frontmatter muss eine Map sein: %s', (_, yaml) => {
    const err = fail(yaml);
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(/^f\.md:2: /);
  });

  test('Zeilennummern zählen nach BOM und CRLF wie in der Datei', () => {
    const err = catchErr(() => parseEntityFile('\ufeff---\r\na: 1\r\nb: 2 # c\r\n---\r\n', 'f.md'));
    expect(err.message).toMatch(/^f\.md:3: /);
  });

  test('# und & innerhalb von Strings sind keine Kommentare oder Anker', () => {
    expect(parse('a: x#1\nb: "y # z"\nc: a&b\nd: \'*q\'\n').data).toEqual({
      a: 'x#1',
      b: 'y # z',
      c: 'a&b',
      d: '*q',
    });
  });
});

describe('serializeEntityFile', () => {
  const ser = (data: Record<string, unknown>, body = '') =>
    serializeEntityFile('issue', data, body);
  const frontmatter = (data: Record<string, unknown>) => {
    const out = ser(data);
    return out.slice(4, out.length - 4);
  };

  test('Keys in KEY_ORDER, unabhängig von der Eingabereihenfolge', () => {
    const data = {
      props: { a: 1 },
      zeta: 'z',
      created: '2026-11-18T10:04:00Z',
      rank: 1,
      alpha: 'a',
      title: 't',
      id: 'bk-7f3k2',
    };
    expect(frontmatter(data)).toBe(
      'id: bk-7f3k2\ntitle: t\nrank: 1\ncreated: 2026-11-18T10:04:00Z\nzeta: z\nalpha: a\nprops:\n  a: 1\n',
    );
  });

  test('undefined, leere Listen und leere props entfallen', () => {
    expect(frontmatter({ ...minimalIssue, assignee: undefined, projects: [], props: {} })).toBe(
      MINIMAL_YAML,
    );
    expect(frontmatter({ ...minimalIssue, props: { a: undefined } })).toBe(MINIMAL_YAML);
  });

  test('verschachtelte leere Listen und Maps bleiben erhalten', () => {
    expect(frontmatter({ ...minimalIssue, props: { a: [], b: {} } })).toBe(
      `${MINIMAL_YAML}props:\n  a: []\n  b: {}\n`,
    );
  });

  test('Flow-Sequenz bis genau 100 Zeichen, ab 101 Block', () => {
    // "projects: [" = 11, "]" = 1 → Inhalt 88 Zeichen ergibt genau 100
    const at100 = ['a'.repeat(43), 'b'.repeat(43)]; // 43 + ", " + 43 = 88
    const line100 = `projects: [${at100.join(', ')}]`;
    expect(line100).toHaveLength(100);
    expect(frontmatter({ ...minimalIssue, projects: at100 })).toContain(`\n${line100}\n`);

    const at101 = ['a'.repeat(44), 'b'.repeat(43)];
    expect(frontmatter({ ...minimalIssue, projects: at101 })).toContain(
      `\nprojects:\n  - ${'a'.repeat(44)}\n  - ${'b'.repeat(43)}\n`,
    );
  });

  test('die 100-Zeichen-Regel zählt Einrückung und Quotes mit', () => {
    // "  k: [" = 6, '"4", ' ... gequotete Strings zählen mit
    const items = Array.from({ length: 23 }, () => '4'); // je "4" = 3 Zeichen
    const flow = `  k: [${items.map(() => '"4"').join(', ')}]`;
    expect(flow.length).toBeGreaterThan(100);
    expect(frontmatter({ ...minimalIssue, props: { k: items } })).toContain(
      'props:\n  k:\n    - "4"\n',
    );
    const fewer = items.slice(0, 18);
    const flowFewer = `  k: [${fewer.map(() => '"4"').join(', ')}]`;
    expect(flowFewer.length).toBeLessThanOrEqual(100);
    expect(frontmatter({ ...minimalIssue, props: { k: fewer } })).toContain(
      `props:\n${flowFewer}\n`,
    );
  });

  test('Listen von Maps werden Block-Sequenzen mit Flow-Maps', () => {
    const attachments = [
      { name: 'trace', file: 'trace.json' },
      { name: 'f', url: `https://example.com/${'x'.repeat(120)}` },
    ];
    expect(frontmatter({ ...minimalIssue, attachments })).toContain(
      `attachments:\n  - {name: trace, file: trace.json}\n  - {name: f, url: https://example.com/${'x'.repeat(120)}}\n`,
    );
  });

  test('revoked_keys beim User folgt derselben Regel', () => {
    const out = serializeEntityFile(
      'user',
      {
        revoked_keys: [{ key: 'ssh-ed25519 AAAA alt', revoked: '2026-01-01T00:00:00Z' }],
        keys: ['ssh-ed25519 BBBB neu'],
        kind: 'human',
        name: 'Sam',
      },
      '',
    );
    expect(out).toBe(
      '---\nname: Sam\nkind: human\nkeys: [ssh-ed25519 BBBB neu]\nrevoked_keys:\n  - {key: ssh-ed25519 AAAA alt, revoked: 2026-01-01T00:00:00Z}\n---\n',
    );
  });

  test('props: Keys alphabetisch, auch verschachtelt; kurze Maps als Flow, lange als Block', () => {
    const long = 'x'.repeat(90);
    const out = frontmatter({
      ...minimalIssue,
      props: { zz: { b: 1, a: [1, 2] }, aa: { y: long, b: 2, a: 1 }, mm: 'm' },
    });
    expect(out).toBe(
      `${MINIMAL_YAML}props:\n  aa:\n    a: 1\n    b: 2\n    y: ${long}\n  mm: m\n  zz: {a: [1, 2], b: 1}\n`,
    );
  });

  test('Codepoint-Reihenfolge der props-Keys', () => {
    const out = frontmatter({ ...minimalIssue, props: { b: 1, B: 2, a_: 3, a: 4 } });
    expect(out).toContain('props:\n  B: 2\n  a: 4\n  a_: 3\n  b: 1\n');
  });

  test('unbekannte Map-Keys außerhalb von props behalten ihre Reihenfolge', () => {
    expect(frontmatter({ ...minimalIssue, zeta: { b: 1, a: 2 } })).toBe(
      `${MINIMAL_YAML}zeta: {b: 1, a: 2}\n`,
    );
  });

  test('lange Strings werden nicht umbrochen', () => {
    const title = 'wort '.repeat(60).trim();
    expect(frontmatter({ ...minimalIssue, title })).toContain(`\ntitle: ${title}\n`);
  });

  test('Listen in Listen und Maps in Listen außerhalb reiner Map-Listen', () => {
    const long = 'y'.repeat(100);
    const data = { ...minimalIssue, props: { l: [[1, 2], [long], 'x', { a: 1 }, { b: long }] } };
    const out = ser(data);
    expect(out).toContain(
      `props:\n  l:\n    - [1, 2]\n    - - ${long}\n    - x\n    - {a: 1}\n    - b: ${long}\n`,
    );
    expect(parseEntityFile(out, 'f').data).toEqual(data);
  });

  test('mehrzeilige Strings bleiben exakt erhalten, auch mit --- und Einrückung', () => {
    for (const s of [
      'a\n---\nb',
      'a\n---\n',
      '---',
      '  x\n y',
      'x\r\ny',
      'a\n\n',
      '\n',
      'ende\n',
    ]) {
      const data = { ...minimalIssue, zeta: s, props: { v: s, l: [s, 'x'] } };
      const out = ser(data, 'Body');
      expect(out.split('\n').filter((l) => l === '---')).toHaveLength(2);
      expect(parseEntityFile(out, 'f')).toEqual({ data, body: 'Body\n' });
    }
  });

  test('Body: fehlender Newline wird ergänzt, mehrere bleiben, CRLF wird LF', () => {
    expect(ser(minimalIssue, 'a')).toBe(`---\n${MINIMAL_YAML}---\na\n`);
    expect(ser(minimalIssue, 'a\n\n\n')).toBe(`---\n${MINIMAL_YAML}---\na\n\n\n`);
    expect(ser(minimalIssue, 'a\r\nb\r\n')).toBe(`---\n${MINIMAL_YAML}---\na\nb\n`);
    expect(ser(minimalIssue, 'a\r')).toBe(`---\n${MINIMAL_YAML}---\na\n`);
    expect(ser(minimalIssue, '')).toBe(`---\n${MINIMAL_YAML}---\n`);
  });

  test('Zahlen und Booleans plain, Strings, die so aussehen, gequotet', () => {
    const out = frontmatter({
      ...minimalIssue,
      props: { n: 4, s: '4', b: true, t: 'true', f: 1.5 },
    });
    expect(out).toContain('props:\n  b: true\n  f: 1.5\n  n: 4\n  s: "4"\n  t: "true"\n');
  });

  test('nicht darstellbare Werte sind ein Programmierfehler', () => {
    for (const v of [null, 1n, () => 1, Symbol('x')]) {
      const err = catchErr(() => ser({ ...minimalIssue, props: { v } }));
      expect(err.code).toBe('unexpected');
    }
  });
});
