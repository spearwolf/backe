import { catchErr } from '../../test/helpers/catch.ts';
import {
  defaultRandomBytes,
  generateIssueId,
  isIssueId,
  isValidPrefix,
  resolveShortId,
  shardOf,
} from './ids.ts';

const bytes =
  (...v: number[]) =>
  () =>
    Uint8Array.from(v);

test('generates <prefix>-<5 crockford chars>', () => {
  const id = generateIssueId('bk', {
    exists: () => false,
    issueCount: 0,
    randomBytes: bytes(7, 15, 3, 19, 2),
  });
  expect(id).toBe('bk-7f3k2');
});

test('rerolls on local collision', () => {
  const seq = [bytes(7, 15, 3, 19, 2), bytes(10, 9, 1, 12, 0)];
  const id = generateIssueId('bk', {
    exists: (i) => i === 'bk-7f3k2',
    issueCount: 0,
    // biome-ignore lint/style/noNonNullAssertion: Sequenz ist im Test fix
    randomBytes: () => seq.shift()!(),
  });
  expect(id).toBe('bk-a91c0');
});

test('switches to 6 chars above 50 000 issues', () => {
  expect(generateIssueId('bk', { exists: () => false, issueCount: 50_000 }).length).toBe(8);
  expect(generateIssueId('bk', { exists: () => false, issueCount: 50_001 }).length).toBe(9);
});

test('default random source yields valid ids', () => {
  const id = generateIssueId('bk', { exists: () => false, issueCount: 0 });
  expect(isIssueId(id, 'bk')).toBe(true);
});

test('shard is the first two chars of the random part', () => {
  expect(shardOf('bk-7f3k2')).toBe('7f');
  expect(shardOf('abcdef-x2c8d9')).toBe('x2');
});

test('isValidPrefix accepts 2-6 lowercase letters', () => {
  expect(isValidPrefix('bk')).toBe(true);
  expect(isValidPrefix('abcdef')).toBe(true);
  expect(isValidPrefix('b')).toBe(false);
  expect(isValidPrefix('abcdefg')).toBe(false);
  expect(isValidPrefix('B2')).toBe(false);
});

test('isIssueId rejects non-crockford chars and bad prefixes', () => {
  expect(isIssueId('bk-7f3k2')).toBe(true);
  expect(isIssueId('bk-7f3ki')).toBe(false);
  expect(isIssueId('b-7f3k2')).toBe(false);
  expect(isIssueId('bk-7f3k2', 'xy')).toBe(false);
  expect(isIssueId('bk-7f3k2', 'bk')).toBe(true);
  expect(isIssueId('bk-7f3k2c')).toBe(true);
  expect(isIssueId('bk-7f3k')).toBe(false);
});

describe('resolveShortId', () => {
  const ids = ['bk-7f3k2', 'bk-7f3m9', 'bk-a91c0'];
  test('full id passes', () => expect(resolveShortId('bk-a91c0', ids)).toBe('bk-a91c0'));
  test('full id unknown is not_found', () =>
    expect(catchErr(() => resolveShortId('bk-zzzzz', ids)).code).toBe('not_found'));
  test('unique short form', () => expect(resolveShortId('a91', ids)).toBe('bk-a91c0'));
  test('ambiguous lists candidates', () => {
    const err = catchErr(() => resolveShortId('7f3', ids));
    expect(err.code).toBe('ambiguous');
    expect(err.details).toEqual({ candidates: ['bk-7f3k2', 'bk-7f3m9'] });
  });
  test('shorter than 3 chars is usage', () =>
    expect(catchErr(() => resolveShortId('7f', ids)).code).toBe('usage'));
  test('unknown is not_found', () =>
    expect(catchErr(() => resolveShortId('zzz', ids)).code).toBe('not_found'));
});

test('catchErr fails when nothing or a foreign error is thrown', () => {
  expect(() => catchErr(() => 1)).toThrow(/did not throw/);
  expect(() =>
    catchErr(() => {
      throw new TypeError('x');
    }),
  ).toThrow(/expected BackeError/);
});

test('generateIssueId gives up after 100 rerolls', () => {
  const err = catchErr(() => generateIssueId('bk', { exists: () => true, issueCount: 0 }));
  expect(err.code).toBe('unexpected');
});

test('generateIssueId rejects a short byte source', () =>
  expect(
    catchErr(() =>
      generateIssueId('bk', {
        exists: () => false,
        issueCount: 0,
        randomBytes: () => Uint8Array.of(1, 2),
      }),
    ).code,
  ).toBe('unexpected'));

test('defaultRandomBytes delivers the requested number of bytes', () => {
  expect(defaultRandomBytes(3)).toHaveLength(3);
  expect(defaultRandomBytes(0)).toHaveLength(0);
});
