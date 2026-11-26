import { describe, expect, test } from 'vitest';
import { editList } from './edit-list.ts';

describe('editList', () => {
  test('removes first, then appends what is missing, in order', () => {
    expect(editList(['a', 'b', 'c'], ['d', 'a'], ['b'])).toEqual(['a', 'c', 'd']);
    // Was entfernt und wieder hinzugefügt wird, rückt ans Ende.
    expect(editList(['a', 'b'], ['a'], ['a'])).toEqual(['b', 'a']);
  });

  test('an empty result drops the field', () => {
    expect(editList(['a'], undefined, ['a'])).toBeUndefined();
    expect(editList(undefined, undefined, undefined)).toBeUndefined();
    expect(editList(undefined, ['x', 'x'], undefined)).toEqual(['x']);
  });

  test('the input list stays untouched', () => {
    const current = ['a'];
    editList(current, ['b'], undefined);
    expect(current).toEqual(['a']);
  });
});
