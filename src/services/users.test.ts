import { readFile } from 'node:fs/promises';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawCommit, type TestBacklog, testBacklog, testKey } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { addUser, listUsers, removeUser, revokeKey, showUser } from './users.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
});

describe('users', () => {
  test('user add reads the key file and defaults name to the handle', async () => {
    const k = await testKey('anna');
    await addUser(ctx, { handle: 'anna', keyFile: k.priv });
    const shown = await showUser(ctx, 'anna');
    expect(shown.user).toMatchObject({ name: 'anna', kind: 'human', keys: [k.line] });
    expect(shown.admin).toBe(false);
    await addUser(ctx, { handle: 'bert', keyFile: (await testKey('bert')).pub, name: 'Bert B.' });
    expect((await showUser(ctx, 'bert')).user.name).toBe('Bert B.');
  });

  test('an agent without operator gets the actor as operator', async () => {
    await addUser(ctx, {
      handle: 'bot',
      keyFile: (await testKey('bot')).priv,
      agent: true,
    });
    expect((await showUser(ctx, 'bot')).user).toMatchObject({ kind: 'agent', operator: 'spw' });
  });

  test('an operator without agent is a usage error', async () => {
    const err = await catchErrAsync(async () =>
      addUser(ctx, {
        handle: 'anna',
        keyFile: (await testKey('anna')).priv,
        operator: 'spw',
      }),
    );
    expect(err).toMatchObject({ code: 'usage' });
  });

  test('list shows kind, operator and admin', async () => {
    await addUser(ctx, { handle: 'bot', keyFile: (await testKey('bot')).priv, agent: true });
    expect(await listUsers(ctx)).toEqual([
      { handle: 'bot', name: 'bot', kind: 'agent', operator: 'spw', admin: false },
      { handle: 'spw', name: expect.any(String), kind: 'human', admin: true },
    ]);
  });

  /** Legt `handle` mit zwei Keys an (der Service kennt nur das Anlegen mit einem). */
  async function userWithTwoKeys(handle: string): Promise<[string, string]> {
    const k1 = await testKey(handle);
    const k2 = await testKey(`${handle}-zweit`);
    await addUser(ctx, { handle, keyFile: k1.priv });
    const file = `users/${handle}.md`;
    const text = await readFile(`${b.root}/${file}`, 'utf8');
    await rawCommit(b.root, {
      files: { [file]: text.replace(`[${k1.line}]`, `[${k1.line}, ${k2.line}]`) },
      key: b.key,
      actor: 'spw',
    });
    return [k1.line, k2.line];
  }

  test('revoke-key matches a fingerprint prefix', async () => {
    const [k1, k2] = await userWithTwoKeys('anna');
    const body = sshFingerprint(k1).slice('SHA256:'.length);
    expect(await catchErrAsync(() => revokeKey(ctx, 'anna', body.slice(0, 7)))).toMatchObject({
      code: 'validation',
    });
    expect(await catchErrAsync(() => revokeKey(ctx, 'anna', 'SHA256:AAAAAAAAAAAA'))).toMatchObject({
      code: 'not_found',
    });
    await revokeKey(ctx, 'anna', body.slice(0, 10));
    const shown = await showUser(ctx, 'anna');
    expect(shown.fingerprints).toEqual([sshFingerprint(k2)]);
    expect(shown.revoked).toHaveLength(1);
    expect(shown.revoked[0]?.fingerprint).toBe(sshFingerprint(k1));
    expect(shown.revoked[0]?.revoked).toBeDefined();
    // Widerrufene Keys zählen nicht mehr.
    expect(await catchErrAsync(() => revokeKey(ctx, 'anna', sshFingerprint(k1)))).toMatchObject({
      code: 'not_found',
    });
  });

  test('revoking the only key leaves a user without active keys', async () => {
    const k = await testKey('anna');
    await addUser(ctx, { handle: 'anna', keyFile: k.priv });
    await revokeKey(ctx, 'anna', sshFingerprint(k.line));
    const shown = await showUser(ctx, 'anna');
    expect(shown.fingerprints).toEqual([]);
    expect(shown.revoked.map((r) => r.fingerprint)).toEqual([sshFingerprint(k.line)]);
    expect((await listUsers(ctx)).map((u) => u.handle)).toContain('anna');
  });

  test('user show me lists fingerprints and revoked keys', async () => {
    const shown = await showUser(ctx, 'me');
    expect(shown.handle).toBe('spw');
    expect(shown.admin).toBe(true);
    expect(shown.fingerprints).toEqual([sshFingerprint(b.key.line)]);
    expect(shown.revoked).toEqual([]);
    expect(await catchErrAsync(() => showUser(ctx, 'nix'))).toMatchObject({ code: 'not_found' });
  });

  test('user rm removes a user, an admin cannot be removed', async () => {
    await addUser(ctx, { handle: 'anna', keyFile: (await testKey('anna')).priv });
    await removeUser(ctx, 'anna');
    expect((await listUsers(ctx)).map((u) => u.handle)).toEqual(['spw']);
    expect(await catchErrAsync(() => removeUser(ctx, 'spw'))).toBeDefined();
  });
});
