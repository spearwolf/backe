import { BackeError } from './errors.ts';

test.each([
  ['usage', 2],
  ['validation', 2],
  ['ambiguous', 2],
  ['not_found', 3],
  ['conflict', 4],
  ['verify', 5],
  ['sync', 6],
  ['unexpected', 1],
] as const)('%s maps to exit code %i', (code, exit) => {
  expect(new BackeError(code, 'x').exitCode).toBe(exit);
});

test('carries message, hint and details', () => {
  const err = new BackeError('conflict', 'boom', { hint: 'retry', details: { a: 1 } });
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('BackeError');
  expect(err.message).toBe('boom');
  expect(err.code).toBe('conflict');
  expect(err.hint).toBe('retry');
  expect(err.details).toEqual({ a: 1 });
});
