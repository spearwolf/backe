import { afterAll, beforeAll, expect, test } from 'vitest';
import { setLocale } from '../../src/i18n/locale.ts';
import { resolveCommentRef } from '../../src/services/comments.ts';
import { listSort } from '../../src/services/issue-list.ts';
import { normalizeStates } from '../../src/services/read.ts';
import { checkFields, toBackeError } from '../../src/services/views.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

test('an invalid sort order is reported in English, with a hint', () => {
  expect(() => listSort('name')).toThrow(
    expect.objectContaining({ message: "Invalid sort order: 'name'", hint: 'rank or created' }),
  );
});

test('unknown --fields name the allowed ones in English', () => {
  expect(() => checkFields(['x', 'y'], ['id', 'title'])).toThrow(
    expect.objectContaining({
      message: "Unknown fields for --fields: 'x', 'y'",
      hint: 'Allowed: id, title',
    }),
  );
});

test('a missing comment is reported in English, with a hint', () => {
  expect(() => resolveCommentRef([], '3')).toThrow(
    expect.objectContaining({
      message: "Comment '3' not found",
      hint: 'give a file name or a number from 1 in the comment list',
    }),
  );
});

test('state and unexpected-error messages are English', () => {
  expect(() => normalizeStates([])).toThrow('No state given');
  expect(() => normalizeStates(['open', 'all'])).toThrow("'all' must stand alone");
  expect(toBackeError('boom').message).toBe('Unexpected error: boom');
});
