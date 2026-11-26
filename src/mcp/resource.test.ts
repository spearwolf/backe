import { catchErr } from '../../test/helpers/catch.ts';
import { issueRefOf } from './resource.ts';

test('issueRefOf takes the first value of a template variable and decodes it', () => {
  expect(issueRefOf('bk-7f3k2')).toBe('bk-7f3k2');
  expect(issueRefOf(['bk-%37f3k2', 'x'])).toBe('bk-7f3k2');
  expect(issueRefOf([])).toBe('');
  expect(issueRefOf(undefined)).toBe('');
});

test('issueRefOf rejects a malformed percent encoding', () => {
  expect(catchErr(() => issueRefOf('bk-%E0%A4%A')).code).toBe('validation');
});
