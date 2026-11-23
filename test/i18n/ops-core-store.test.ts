import { BackeError, schemaError } from '../../src/core/errors.ts';
import { resolveShortId } from '../../src/core/ids.ts';
import { parseRepoRef } from '../../src/core/names.ts';
import { IssueSchema, validateEntity } from '../../src/core/schemas.ts';
import { planTransition } from '../../src/core/state.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import { decodeBatchBody } from '../../src/ops/operation.ts';
import { parsePropAssignment } from '../../src/ops/props.ts';
import { assertRelative } from '../../src/store/files.ts';
import { parseEntityFile } from '../../src/store/frontmatter.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

/** Die Meldung samt Hinweis, mit dem `fn` wirft. */
function thrown(fn: () => unknown): BackeError {
  try {
    fn();
  } catch (err) {
    if (err instanceof BackeError) return err;
    throw err;
  }
  throw new Error('expected a BackeError');
}

describe('core', () => {
  test('an unknown short ID is reported in English', () => {
    expect(thrown(() => resolveShortId('bk-aaaaa', ['bk-bbbbb'])).message).toBe(
      "Issue 'bk-aaaaa' not found",
    );
  });

  test('a forbidden transition carries the English reason', () => {
    const err = thrown(() =>
      planTransition({ state: 'done' }, 'move', { to: 'todo', strict: false }),
    );
    expect(err.message).toBe(
      'Transition done -> todo not allowed: done can only be left via reopen',
    );
  });

  test('an invalid repo name has an English message and hint', () => {
    const err = thrown(() => parseRepoRef('Bad Name'));
    expect(err.message).toBe("Invalid repo name: 'Bad Name'");
    expect(err.hint).toBe(
      'Allowed are a-z, 0-9, ".", "_" and "-", starting with a letter or digit (max. 64 characters).',
    );
  });

  test('schema errors name the root in English and use the English custom messages', () => {
    const parsed = IssueSchema.safeParse({
      id: 'bk-aaaaa',
      title: 'x',
      state: 'todo',
      creator: 'a',
      created: 'nope',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(schemaError('f.md', parsed.error).message).toContain(
      'f.md: created: expected UTC timestamp YYYY-MM-DDTHH:MM:SSZ',
    );
    const rootError = IssueSchema.safeParse(null);
    if (rootError.success) throw new Error('expected a failure');
    expect(schemaError('f.md', rootError.error).message).toMatch(/^f\.md: \(root\): /);
  });

  test('validateEntity reports a custom schema message in English', () => {
    const err = thrown(() =>
      validateEntity(
        'issue',
        {
          id: 'bk-aaaaa',
          title: 'x',
          state: 'todo',
          creator: 'bad handle',
          created: '2026-01-01T00:00:00Z',
        },
        'f.md',
      ),
    );
    expect(err.message).toBe('f.md: creator: not a valid handle');
  });
});

describe('store', () => {
  test('a file without frontmatter fence is rejected in English', () => {
    expect(thrown(() => parseEntityFile('no fence', 'a.md')).message).toBe(
      'a.md:1: Frontmatter must start with "---" on line 1',
    );
  });

  test('an absolute path is rejected with an English hint', () => {
    const err = thrown(() => assertRelative('/abs'));
    expect(err.message).toBe("Invalid path in backlog: '/abs'");
    expect(err.hint).toBe(
      'Only normalized, relative paths without "..", ".", "//" and a trailing slash are allowed.',
    );
  });
});

describe('ops', () => {
  test('a malformed property expression is reported in English', () => {
    expect(thrown(() => parsePropAssignment('???')).message).toBe(
      "Invalid property expression '???' (expected key=value or key:=<json>)",
    );
  });

  test('a batch line error is prefixed with the English line label', () => {
    expect(thrown(() => decodeBatchBody('\n')).message).toBe('line 1: empty line');
    expect(thrown(() => decodeBatchBody('not json')).message).toMatch(
      /^line 1: Operation is not valid JSON: /,
    );
  });
});
