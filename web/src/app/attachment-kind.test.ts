import { expect, test } from 'vitest';
import { attachmentKind } from './attachment-kind.ts';

test('kinds by extension and size', () => {
  expect(attachmentKind({ name: 'a.PNG', file: 'a.PNG', size: 10 })).toBe('image');
  expect(attachmentKind({ name: 'a.bmp', file: 'a.bmp', size: 10 })).not.toBe('image');
  expect(attachmentKind({ name: 'a.svg', file: 'a.svg', size: 10 })).toBe('image');
  expect(attachmentKind({ name: 'notes.md', file: 'notes.md', size: 10 })).toBe('markdown');
  expect(attachmentKind({ name: 'n.MARKDOWN', file: 'n.MARKDOWN', size: 10 })).toBe('markdown');
  expect(attachmentKind({ name: 'log.txt', file: 'log.txt', size: 262_144 })).toBe('text');
  expect(attachmentKind({ name: 'log.txt', file: 'log.txt', size: 262_145 })).toBe('download');
  expect(attachmentKind({ name: 'big.md', file: 'big.md', size: 262_145 })).toBe('download');
  expect(attachmentKind({ name: 'x', url: 'https://example.com/x' })).toBe('url');
  expect(attachmentKind({ name: 'm.bin', file: 'm.bin', not_loaded: true })).toBe('not-loaded');
  expect(attachmentKind({ name: 'nosize.txt', file: 'nosize.txt' })).toBe('download');
});
