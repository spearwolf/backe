import { ATTACHMENT_NAME_RE } from '@backe/core/names.ts';
import { expect, test } from 'vitest';
import { attachmentLink, attachmentNameFor, mentionsAttachment } from './attachment-name.ts';

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

test.each([
  ['a.', 'image/png'],
  ['---', 'image/png'],
  ['---', 'text/plain'],
  ['😀.png', 'image/png'],
  ['😀', 'image/gif'],
  [`x.${'e'.repeat(200)}`, 'image/png'],
  ['x.-', 'image/png'],
  ['..', 'application/octet-stream'],
  ['é.', 'image/webp'],
  ['a b/c\\d.PNG', 'image/png'],
])('hostile name %j always fits the attachment rule', (name, mime) => {
  const got = attachmentNameFor(name, mime, new Set());
  expect(got).toMatch(ATTACHMENT_NAME_RE);
  expect(got).toHaveLength(Math.min(got.length, 64));
});

test('an extension is cut to 16 characters', () => {
  expect(attachmentNameFor(`x.${'e'.repeat(200)}`, 'image/png', new Set())).toBe(
    `x.${'e'.repeat(16)}`,
  );
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

test('the editor link points at the attachment', () => {
  expect(attachmentLink('shot.png')).toBe('![shot.png](attachments/shot.png)');
  expect(mentionsAttachment(attachmentLink('shot.png'), 'shot.png')).toBe(true);
});

test.each([
  ['![x](attachments/a.png "Titel")', true],
  ['<img src="attachments/a.png" alt="">', true],
  ['[a]: attachments/a.png', true],
  ['![a](./attachments/a.png)', true],
  ['![a](attachments/a.png.bak)', false],
  ['![a](attachments/a-2.png)', false],
  ['![a](attachments/xa.png)', false],
  ['![a](myattachments/a.png)', false],
  ['![a](attachments/aXpng)', false],
  ['', false],
])('mentions a.png: %s', (text, want) => {
  expect(mentionsAttachment(text, 'a.png')).toBe(want);
});
