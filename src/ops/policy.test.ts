import { catchErr } from '../../test/helpers/catch.ts';
import { snap } from '../../test/helpers/snapshot.ts';
import type { User } from '../core/schemas.ts';
import { checkUserChange } from './policy.ts';

const KEY = 'ssh-ed25519 AAAAkey';
const human = (name: string): User => ({ name, kind: 'human', keys: [] });
const agent = (name: string, operator: string): User => ({
  name,
  kind: 'agent',
  operator,
  keys: [],
});
const withKey = (u: User): User => ({ ...u, keys: [KEY] });

const s = snap();

describe('checkUserChange', () => {
  test.each<[string, string, User | undefined, User | undefined, 'policy' | undefined]>([
    ['alice adds a human', 'alice', undefined, human('bob'), 'policy'],
    ['alice adds her agent', 'alice', undefined, agent('a-1', 'alice'), undefined],
    ['alice adds an agent for spw', 'alice', undefined, agent('a-1', 'spw'), 'policy'],
    [
      'alice adds an agent without operator',
      'alice',
      undefined,
      { ...human('a-1'), kind: 'agent' },
      'policy',
    ],
    [
      'operator edits own agent',
      'spw',
      agent('claude-1', 'spw'),
      withKey(agent('claude-1', 'spw')),
      undefined,
    ],
    [
      'non-admin operator edits own agent',
      'alice',
      agent('a-1', 'alice'),
      withKey(agent('a-1', 'alice')),
      undefined,
    ],
    [
      'alice edits claude-1',
      'alice',
      agent('claude-1', 'spw'),
      withKey(agent('claude-1', 'spw')),
      'policy',
    ],
    ['alice edits herself', 'alice', human('alice'), withKey(human('alice')), undefined],
    ['alice edits a human', 'alice', human('bob'), withKey(human('bob')), 'policy'],
    ['spw removes alice', 'spw', human('alice'), undefined, undefined],
    ['alice removes herself', 'alice', human('alice'), undefined, 'policy'],
    ['alice removes her agent', 'alice', agent('a-1', 'alice'), undefined, 'policy'],
    ['admin adds a human', 'spw', undefined, human('bob'), undefined],
  ])('%s', (_name, actor, before, after, reason) => {
    const handle = (after ?? before)?.name ?? 'x';
    const run = () => checkUserChange(s, actor, handle, before, after);
    if (reason === undefined) {
      expect(run).not.toThrow();
      return;
    }
    const err = catchErr(run);
    expect(err.details).toMatchObject({ reason });
    expect(err.code).toBe('validation');
  });

  test('admins come from the config of the snapshot', () => {
    const custom = snap({ config: { admins: ['alice'] } });
    expect(() => checkUserChange(custom, 'alice', 'bob', undefined, human('bob'))).not.toThrow();
    expect(() => checkUserChange(custom, 'spw', 'bob', undefined, human('bob'))).toThrow();
  });
});
