import { checkNodeVersion } from './node-version.ts';

test('checkNodeVersion rejects older majors', () => {
  expect(checkNodeVersion('26.13.1')).toBeUndefined();
  expect(checkNodeVersion('27.0.0')).toBeUndefined();
  expect(checkNodeVersion('22.11.0')).toBe('backe braucht Node.js ≥ 26 (gefunden 22.11.0)');
  expect(checkNodeVersion('kaputt')).toBe('backe braucht Node.js ≥ 26 (gefunden kaputt)');
});
