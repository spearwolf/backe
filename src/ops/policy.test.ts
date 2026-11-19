import { catchErr } from '../../test/helpers/catch.ts';
import { snap, testKey } from '../../test/helpers/snapshot.ts';
import type { User } from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { userFile } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { checkUserChange } from './policy.ts';

const KEY = testKey('key');
const KEY_A = testKey('a');
const KEY_B = testKey('b');
const KEY_C = testKey('c');
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

    test('only an admin may hand an agent to another human, an admin may change the kind', () => {
      const custom = snap({ config: { admins: ['alice'] } });
      const handover = agent('claude-1', 'alice');
      expect(reason(() => checkUserChange(custom, 'spw', 'claude-1', claude, handover))).toBe(
        'policy',
      );
      expect(() => checkUserChange(custom, 'alice', 'claude-1', claude, handover)).not.toThrow();
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

describe('admin rights', () => {
  const reason = (fn: () => void) => (catchErr(fn).details as { reason: string }).reason;

  test('a non-admin cannot create a user whose handle is listed in the admins', () => {
    const custom = snap({ config: { admins: ['spw', 'ghost'] } });
    const ghost = agent('ghost', 'alice');
    const err = catchErr(() => checkUserChange(custom, 'alice', 'ghost', undefined, ghost));
    expect(err.details).toMatchObject({ reason: 'policy' });
    expect(err.code).toBe('validation');
  });

  test('an admin may create a handle listed in the admins', () => {
    const custom = snap({ config: { admins: ['spw', 'ghost'] } });
    expect(() => checkUserChange(custom, 'spw', 'ghost', undefined, human('ghost'))).not.toThrow();
  });

  test('an agent listed in the admins has no admin rights', () => {
    const custom = snap({ config: { admins: ['spw', 'claude-1'] } });
    const err = catchErr(() => checkUserChange(custom, 'claude-1', 'bob', undefined, human('bob')));
    expect(err.details).toMatchObject({ reason: 'policy' });
    expect(err.code).toBe('validation');
  });

  test('a handle listed in the admins without a user file has no admin rights', () => {
    const custom = snap({ config: { admins: ['spw', 'ghost'] } });
    const err = catchErr(() => checkUserChange(custom, 'ghost', 'bob', undefined, human('bob')));
    expect(err.details).toMatchObject({ reason: 'policy' });
    expect(err.code).toBe('validation');
  });

  test('an admin editing the own record is recognised as human through the state before', () => {
    const without = withUsers(s, { spw: undefined });
    expect(() =>
      checkUserChange(without, 'spw', 'spw', human('spw'), withKey(human('spw'))),
    ).not.toThrow();
    expect(
      reason(() => checkUserChange(without, 'spw', 'spw', agent('spw', 'alice'), undefined)),
    ).toBe('policy');
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

describe('identity rules', () => {
  const reason = (fn: () => void) => (catchErr(fn).details as { reason: string }).reason;
  const keyed = (name: string, keys: string[], more: Partial<User> = {}): User => ({
    name,
    kind: 'human',
    keys,
    ...more,
  });
  const base = snap({ users: ['bob'] });
  const own = withUsers(base, {
    spw: keyed('spw', [KEY_A]),
    alice: keyed('alice', [KEY_B]),
    bob: keyed('bob', []),
  });

  test('a removed handle is re-created only by an admin', () => {
    const x: User = { name: 'X', kind: 'agent', operator: 'alice', keys: [KEY_C] };
    const after = withUsers(own, { x });
    const err = catchErr(() =>
      checkUserChange(after, 'alice', 'x', undefined, x, { removedBefore: true }),
    );
    expect(err.details).toMatchObject({ reason: 'policy' });
    expect(err.message).toBe('alice darf den User x nicht neu anlegen');
    expect(() => checkUserChange(after, 'alice', 'x', undefined, x)).not.toThrow();
    expect(() =>
      checkUserChange(after, 'spw', 'x', undefined, x, { removedBefore: true }),
    ).not.toThrow();
  });

  test('a key of another user is refused, even with another comment and for admins', () => {
    const stolen = keyed('bob', [testKey('a', 'other-comment')]);
    const after = withUsers(own, { bob: stolen });
    for (const actor of ['bob', 'spw']) {
      const err = catchErr(() =>
        checkUserChange(after, actor, 'bob', own.users.get('bob')?.data, stolen),
      );
      expect(err.details).toMatchObject({ reason: 'policy' });
      expect(err.message).toContain('gehört schon spw');
    }
  });

  test('a revoked key of another user is refused as well', () => {
    const alice = keyed('alice', [KEY_B], {
      revoked_keys: [{ key: KEY_C, revoked: '2026-11-01T00:00:00Z' }],
    });
    const taken = keyed('bob', [KEY_C]);
    const after = withUsers(own, { alice, bob: taken });
    expect(
      reason(() => checkUserChange(after, 'spw', 'bob', own.users.get('bob')?.data, taken)),
    ).toBe('policy');
  });

  test('an unchanged key list does not trigger the uniqueness check', () => {
    const bob = keyed('bob', [KEY_A]);
    const dup = withUsers(own, { bob });
    expect(() => checkUserChange(dup, 'bob', 'bob', bob, { ...bob, name: 'Bob' })).not.toThrow();
  });

  test('a revoked key stays revoked, even for admins', () => {
    const revoked = [{ key: KEY_C, revoked: '2026-11-01T00:00:00Z' }];
    const before = keyed('bob', [], { revoked_keys: revoked });
    const state = withUsers(own, { bob: before });
    const cases: User[] = [
      keyed('bob', [], {}),
      keyed('bob', [testKey('c', 'renamed')], { revoked_keys: revoked }),
    ];
    for (const after of cases) {
      const err = catchErr(() =>
        checkUserChange(withUsers(state, { bob: after }), 'spw', 'bob', before, after),
      );
      expect(err.details).toMatchObject({ reason: 'policy' });
      expect(err.message).toBe(`Der Widerruf von ${sshFingerprint(KEY_C)} ist endgültig`);
    }
    const kept = keyed('bob', [], {
      revoked_keys: [...revoked, { key: KEY_A, revoked: '2026-11-02T00:00:00Z' }],
    });
    expect(() =>
      checkUserChange(withUsers(state, { bob: kept }), 'spw', 'bob', before, kept),
    ).not.toThrow();
  });

  test('the previous operator can no longer hand over an agent', () => {
    const custom = withUsers(own, { 'a-1': agent('a-1', 'bob') });
    const err = catchErr(() =>
      checkUserChange(custom, 'alice', 'a-1', agent('a-1', 'alice'), agent('a-1', 'bob')),
    );
    expect(err.details).toMatchObject({ reason: 'policy' });
    expect(err.message).toBe('alice darf den Operator von a-1 nicht ändern');
  });

  test('an operator of agents does not become an agent, even by an admin', () => {
    const asAgent: User = { name: 'Bob', kind: 'agent', operator: 'alice', keys: [] };
    const state = withUsers(own, {
      bob: asAgent,
      'a-1': agent('a-1', 'bob'),
      'a-2': agent('a-2', 'bob'),
    });
    const err = catchErr(() => checkUserChange(state, 'spw', 'bob', keyed('bob', []), asAgent));
    expect(err.details).toEqual({ reason: 'references', ids: ['a-1', 'a-2'] });
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('bob ist Operator von a-1, a-2; ein Operator bleibt Mensch');
  });
});
