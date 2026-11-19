import { catchErr } from '../../test/helpers/catch.ts';
import { BackeError } from '../core/errors.ts';
import { bodyBlock, columns, paint, renderError, resolveFormat, safeText } from './output.ts';

describe('resolveFormat', () => {
  test('an unknown --format value is a validation error naming its source', () => {
    const err = catchErr(() => resolveFormat({ format: 'xml' }, {}, {}));
    expect([err.code, err.message]).toEqual([
      'validation',
      'Unbekanntes Ausgabeformat »xml« (Quelle: --format)',
    ]);
  });
  test('an unknown BACKE_FORMAT is a validation error too', () =>
    expect(catchErr(() => resolveFormat({}, { BACKE_FORMAT: 'xml' }, {})).code).toBe('validation'));
});

describe('safeText', () => {
  test('keeps newline and tab, shows ESC as ␛ and other controls as \\u{XX}', () => {
    expect(safeText('a\tb\nc')).toBe('a\tb\nc');
    expect(safeText('\x1b[31mrot')).toBe('␛[31mrot');
    expect(safeText('x\x07y\x00z\r')).toBe('x\\u{07}y\\u{00}z\\u{0D}');
    expect(safeText('\x7f\x9b\x85')).toBe('\\u{7F}\\u{9B}\\u{85}');
  });
  test('leaves ordinary text, umlauts and symbols alone', () =>
    expect(safeText('Grüße ⧗ › — ok')).toBe('Grüße ⧗ › — ok'));
  test('text renderers sanitize their cells, bodies, painted text and errors', () => {
    expect(columns([['\x1b]8;;x\x07', 'b']])).toEqual(['␛]8;;x\\u{07}  b']);
    expect(bodyBlock('a\x1bb\n')).toEqual(['', 'a␛b']);
    expect(paint(true, 'bold', '\x1b[2J')).toBe('\x1b[1m␛[2J\x1b[0m');
    const err = catchErr(() => resolveFormat({ format: '\x1b[2J' }, {}, {}));
    expect(renderError(err, 'text')).not.toContain('\x1b');
    expect(renderError(err, 'json')).toContain('\\u001b');
  });
});

test('error details in JSON rename only the fixed keys, values stay', () => {
  const err = new BackeError('unexpected', 'git fehlgeschlagen', {
    details: {
      args: ['rev-parse'],
      exitCode: 128,
      nested: [{ fooBar: 'keepMe' }],
      fromHash: 'a',
      reasonFile: 'r',
    },
  });
  expect(JSON.parse(renderError(err, 'json'))).toEqual({
    error: {
      code: 'unexpected',
      message: 'git fehlgeschlagen',
      details: {
        args: ['rev-parse'],
        exit_code: 128,
        nested: [{ fooBar: 'keepMe' }],
        from_hash: 'a',
        reason_file: 'r',
      },
    },
  });
});

test('safeText shows bidi controls but keeps emoji joiners', () => {
  expect(safeText('a\u202Eb')).toBe('a\\u{202E}b');
  expect(safeText('a\u200Bb\u00ADc')).toBe('a\\u{200B}b\\u{AD}c');
  expect(safeText('👩\u200D💻')).toBe('👩\u200D💻');
  expect(safeText('a\u200Cb')).toBe('a\u200Cb');
});

test('error details keep user keys', () => {
  const err = new BackeError('validation', 'x', {
    details: { exitCode: 2, props: { estimate_h: 1, someKey: 2 } },
  });
  expect(JSON.parse(renderError(err, 'json')).error.details).toEqual({
    exit_code: 2,
    props: { estimate_h: 1, someKey: 2 },
  });
});
