import { ATTACHMENT_NAME_RE } from '@backe/core/names.ts';
import { expect, test } from 'vitest';
import { attachmentNameFor } from './attachment-name.ts';

test.each([
  [
    'Screen Shot 2026-11-26 at 10.00.00 PM.PNG',
    'image/png',
    'screen-shot-2026-11-26-at-10.00.00-pm.png',
  ],
  ['.hidden', 'application/octet-stream', 'hidden.bin'],
  ['ümlaut.png', 'image/png', 'umlaut.png'],
  ['image.png', 'image/png', 'image.png'],
  ['', 'image/jpeg', 'image.jpg'],
  ['', 'application/pdf', 'file.bin'],
  ['clip', 'image/svg+xml', 'clip.svg'],
])('names fit the attachment rule: %s', (name, mime, want) => {
  const got = attachmentNameFor(name, mime, new Set());
  expect(got).toBe(want);
  expect(got).toMatch(ATTACHMENT_NAME_RE);
});

test('long names keep their extension within 64', () => {
  const got = attachmentNameFor(`${'a'.repeat(200)}.png`, 'image/png', new Set());
  expect(got).toHaveLength(64);
  expect(got.endsWith('.png')).toBe(true);
  expect(got).toMatch(ATTACHMENT_NAME_RE);
});

test('taken names count up', () => {
  const taken = new Set(['shot.png', 'shot-2.png']);
  expect(attachmentNameFor('shot.png', 'image/png', taken)).toBe('shot-3.png');
});

test('counting up stays within 64 characters', () => {
  const long = `${'a'.repeat(200)}.png`;
  const first = attachmentNameFor(long, 'image/png', new Set());
  const got = attachmentNameFor(long, 'image/png', new Set([first]));
  expect(got).toHaveLength(64);
  expect(got.endsWith('-2.png')).toBe(true);
  expect(got).toMatch(ATTACHMENT_NAME_RE);
});
