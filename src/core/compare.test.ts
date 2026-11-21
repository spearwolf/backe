import { describe, expect, it } from 'vitest';
import { compareCodeUnits } from './compare.ts';

describe('compareCodeUnits', () => {
  it('orders by code unit, not by locale', () => {
    expect(['b', 'B', 'a', 'é', 'z'].sort(compareCodeUnits)).toEqual(['B', 'a', 'b', 'z', 'é']);
    expect(compareCodeUnits('a', 'a')).toBe(0);
    expect(compareCodeUnits(1, 2)).toBe(-1);
    expect(compareCodeUnits(2, 1)).toBe(1);
  });
});
