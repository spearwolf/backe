/** Users und Keys (backe.md §2.12): anlegen, listen, zeigen, Key widerrufen, entfernen. */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { User } from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { readPublicKey } from '../git/ssh.ts';
import type { OpOf } from '../ops/operation.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { openSnapshot, resolveHandle } from './read.ts';
import type { WriteDeps } from './write.ts';

const MIN_FINGERPRINT_PREFIX = 8;
const FINGERPRINT_SCHEME = 'SHA256:';

export async function addUser(
  ctx: ResolvedContext,
  input: { handle: string; keyFile: string; name?: string; agent?: boolean; operator?: string },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  if (input.operator !== undefined && input.agent !== true) {
    throw new BackeError('usage', '--operator gilt nur zusammen mit --agent');
  }
  const handle = resolveHandle(ctx, input.handle);
  const key = await readPublicKey(input.keyFile);
  return writeOp(
    ctx,
    (_s, actor) => {
      const op: OpOf<'user.add'> = {
        op: 'user.add',
        handle,
        name: input.name ?? handle,
        kind: input.agent === true ? 'agent' : 'human',
        keys: [key],
      };
      if (input.agent === true) op.operator = input.operator ?? actor;
      return op;
    },
    deps,
  );
}

export async function listUsers(
  ctx: ResolvedContext,
): Promise<
  { handle: string; name: string; kind: 'human' | 'agent'; operator?: string; admin: boolean }[]
> {
  const { snapshot: s } = await openSnapshot(ctx);
  return [...s.users.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([handle, { data }]) => ({
      handle,
      name: data.name,
      kind: data.kind,
      ...(data.operator === undefined ? {} : { operator: data.operator }),
      admin: s.config.admins.includes(handle),
    }));
}

export async function showUser(
  ctx: ResolvedContext,
  who: string,
): Promise<{
  handle: string;
  user: User;
  body: string;
  admin: boolean;
  fingerprints: string[];
  revoked: { fingerprint: string; revoked?: string }[];
}> {
  const handle = resolveHandle(ctx, who);
  const { snapshot: s } = await openSnapshot(ctx);
  const stored = s.users.get(handle);
  if (stored === undefined) throw new BackeError('not_found', `User »${handle}« nicht gefunden`);
  return {
    handle,
    user: stored.data,
    body: stored.body,
    admin: s.config.admins.includes(handle),
    fingerprints: (stored.data.keys ?? []).map(sshFingerprint),
    revoked: (stored.data.revoked_keys ?? []).map((r) => ({
      fingerprint: sshFingerprint(r.key),
      revoked: r.revoked,
    })),
  };
}

/** Widerruft den aktiven Key, auf den der Fingerprint (voll oder Präfix ab 8 Zeichen) passt. */
export function revokeKey(
  ctx: ResolvedContext,
  who: string,
  fingerprint: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const handle = resolveHandle(ctx, who);
  const body = fingerprint.startsWith(FINGERPRINT_SCHEME)
    ? fingerprint.slice(FINGERPRINT_SCHEME.length)
    : fingerprint;
  if (body.length < MIN_FINGERPRINT_PREFIX) {
    throw new BackeError(
      'validation',
      `Der Fingerprint »${fingerprint}« ist zu kurz, mindestens ${MIN_FINGERPRINT_PREFIX} Zeichen nötig`,
    );
  }
  return writeOp(
    ctx,
    (s) => {
      const user = s.users.get(handle);
      if (user === undefined) throw new BackeError('not_found', `User »${handle}« nicht gefunden`);
      const hits = (user.data.keys ?? []).filter((k) =>
        sshFingerprint(k).slice(FINGERPRINT_SCHEME.length).startsWith(body),
      );
      if (hits.length === 0) {
        throw new BackeError(
          'not_found',
          `Kein aktiver Key von »${handle}« passt auf »${fingerprint}«`,
        );
      }
      const [key] = hits;
      if (hits.length > 1 || key === undefined) {
        throw new BackeError(
          'ambiguous',
          `»${fingerprint}« passt auf mehrere Keys von »${handle}«`,
          { details: { candidates: hits.map(sshFingerprint) } },
        );
      }
      return { op: 'user.revoke_key', handle, key };
    },
    deps,
  );
}

export function removeUser(
  ctx: ResolvedContext,
  handle: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const h = resolveHandle(ctx, handle);
  return writeOp(ctx, () => ({ op: 'user.rm', handle: h }), deps);
}
