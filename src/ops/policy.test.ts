import { catchErr } from '../../test/helpers/catch.ts';
import { snap } from '../../test/helpers/snapshot.ts';
import type { User } from '../core/schemas.ts';
import { userFile } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
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

/** Snapshot mit zusätzlichen (oder ohne, bei `undefined`) Users; Stand nach einer Änderung. */
function withUsers(
  base: BacklogSnapshot,
  users: Record<string, User | undefined>,
): BacklogSnapshot {
  const map = new Map(base.users);
  for (const [handle, data] of Object.entries(users)) {
    if (data === undefined) map.delete(handle);
    else map.set(handle, { data, extra: [], body: '', path: userFile(handle) });
  }
  return { ...base, users: map };
}

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

  describe('agents and operators', () => {
    const claude = agent('claude-1', 'spw');
    const reason = (fn: () => void) => (catchErr(fn).details as { reason: string }).reason;

    test('an agent cannot turn itself into a human or drop its operator', () => {
      const asHuman: User = { name: 'claude-1', kind: 'human', keys: [] };
      expect(reason(() => checkUserChange(s, 'claude-1', 'claude-1', claude, asHuman))).toBe(
        'policy',
      );
    });

    test('an agent cannot make itself its own operator', () => {
      const self = agent('claude-1', 'claude-1');
      expect(reason(() => checkUserChange(s, 'claude-1', 'claude-1', claude, self))).toBe('policy');
    });

    test('a non-admin operator cannot turn the agent into a human', () => {
      const custom = snap({ config: { admins: ['alice'] } });
      const asHuman: User = { name: 'claude-1', kind: 'human', keys: [] };
      expect(reason(() => checkUserChange(custom, 'spw', 'claude-1', claude, asHuman))).toBe(
        'policy',
      );
    });

    test('an operator may hand the agent to another human, an admin may change the kind', () => {
      const custom = snap({ config: { admins: ['alice'] } });
      expect(() =>
        checkUserChange(custom, 'spw', 'claude-1', claude, agent('claude-1', 'alice')),
      ).not.toThrow();
      const asHuman: User = { name: 'claude-1', kind: 'human', keys: [] };
      expect(() => checkUserChange(custom, 'alice', 'claude-1', claude, asHuman)).not.toThrow();
    });

    test('an agent is not accepted as operator, for admins as well', () => {
      const sub = agent('sub-1', 'claude-1');
      expect(reason(() => checkUserChange(s, 'claude-1', 'sub-1', undefined, sub))).toBe('schema');
      expect(reason(() => checkUserChange(s, 'spw', 'sub-1', undefined, sub))).toBe('schema');
    });

    test('an unknown operator is a missing reference', () => {
      const sub = agent('sub-1', 'nobody');
      expect(reason(() => checkUserChange(s, 'spw', 'sub-1', undefined, sub))).toBe('missing_ref');
    });

    test('a human operator is accepted when set on an existing agent', () => {
      expect(() =>
        checkUserChange(s, 'spw', 'claude-1', claude, agent('claude-1', 'alice')),
      ).not.toThrow();
    });
  });
});

describe('orphaned operators', () => {
  const reason = (fn: () => void) => (catchErr(fn).details as { reason: string }).reason;
  /** `bob-1` nennt `bob` als Operator, `users/bob.md` fehlt aber. */
  const orphan = withUsers(s, { 'bob-1': agent('bob-1', 'bob') });

  test('a non-human named as operator gets no operator rights', () => {
    const after = withUsers(orphan, { bob: agent('bob', 'alice') });
    const bob1 = agent('bob-1', 'bob');
    expect(reason(() => checkUserChange(after, 'bob', 'bob-1', bob1, withKey(bob1)))).toBe(
      'policy',
    );
    const sub = agent('sub-1', 'claude-1');
    const withSub = withUsers(s, { 'sub-1': sub });
    expect(reason(() => checkUserChange(withSub, 'claude-1', 'sub-1', sub, withKey(sub)))).toBe(
      'policy',
    );
  });

  test('a non-admin cannot create a user that an existing user names as operator', () => {
    const bob = agent('bob', 'alice');
    const after = withUsers(orphan, { bob });
    expect(reason(() => checkUserChange(after, 'alice', 'bob', undefined, bob))).toBe('policy');
  });

  test('a user who still operates agents cannot be removed, for admins as well', () => {
    const after = withUsers(s, {
      'z-1': agent('z-1', 'alice'),
      'a-2': agent('a-2', 'alice'),
      alice: undefined,
    });
    const err = catchErr(() => checkUserChange(after, 'spw', 'alice', human('alice'), undefined));
    expect(err.details).toEqual({ reason: 'references', ids: ['a-2', 'z-1'] });
    expect(err.code).toBe('conflict');
  });
});
