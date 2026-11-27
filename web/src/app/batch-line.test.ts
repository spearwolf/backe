import { setLocale } from '@backe/i18n/locale.ts';
import { ApiError } from '../data/api-client.ts';
import { withoutBatchLine } from './batch-line.ts';

afterEach(() => setLocale('de'));

const failed = (message: string, details?: unknown) =>
  new ApiError(400, 'invariant', message, 'mit --force abschließen', details);

test('the line prefix of the own batch goes, the rest stays verbatim', () => {
  setLocale('de');
  const details = { reason: 'open_children', ids: ['bk-2'], line: 2 };
  const out = withoutBatchLine(failed('Zeile 2: bk-1 hat noch offene Sub-Issues: bk-2', details));
  expect(out).toBeInstanceOf(ApiError);
  expect(out.message).toBe('bk-1 hat noch offene Sub-Issues: bk-2');
  expect([out.status, out.code, out.hint, out.details]).toEqual([
    400,
    'invariant',
    'mit --force abschließen',
    details,
  ]);

  setLocale('en');
  expect(withoutBatchLine(failed('line 2: bk-1 has open sub-issues', { line: 2 })).message).toBe(
    'bk-1 has open sub-issues',
  );
});

test('without a matching prefix the error stays as it is', () => {
  setLocale('en');
  // Andere Sprache als die Oberfläche, andere Zeile, keine Zeile: unverändert, dasselbe Objekt.
  for (const err of [
    failed('Zeile 2: offen', { line: 2 }),
    failed('line 1: open', { line: 2 }),
    failed('line 2: open'),
    failed('line 2: open', { line: '2' }),
  ]) {
    expect(withoutBatchLine(err)).toBe(err);
  }
});
