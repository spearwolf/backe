import { describe, expect, it } from 'vitest';
import type { User } from '../core/schemas.ts';
import { isAdmin } from './admin.ts';

const human = { kind: 'human', name: 'Ada' } as User;
const agent = { kind: 'agent', name: 'Bot', operator: 'ada' } as User;

describe('isAdmin', () => {
  const config = { admins: ['ada', 'bot'] };
  it('requires an entry in admins and a human record', () => {
    expect(isAdmin(config, 'ada', human)).toBe(true);
    expect(isAdmin(config, 'bot', agent)).toBe(false);
    expect(isAdmin(config, 'ada', undefined)).toBe(false);
    expect(isAdmin(config, 'eve', human)).toBe(false);
  });
});
