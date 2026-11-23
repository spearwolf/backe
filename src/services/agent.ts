/**
 * Agents anlegen (backe.md §2.12): eigenes Keypair, User-Eintrag mit dem ausführenden Menschen als
 * Operator (der Commit wird von ihm signiert) und die Identität in der User-Config.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setIdentity } from '../context/registry.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { userConfigPath } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { shortSha } from '../core/ids.ts';
import { isHandle } from '../core/names.ts';
import { generateKeypair } from '../git/ssh.ts';
import { m } from './agent.messages.ts';
import { executeWrite, type WriteDeps } from './write.ts';

export type CreateAgentInput = { handle: string; name?: string; body?: string };

export async function createAgent(
  ctx: ResolvedContext,
  input: CreateAgentInput,
  deps?: WriteDeps,
): Promise<{ keyPath: string; commit: string }> {
  const { handle } = input;
  if (!isHandle(handle)) throw new BackeError('validation', m.invalidHandle(handle));
  const { handle: actor } = requireWriter(ctx);
  const backlog = ctx.backlog.value;
  if (ctx.userConfig.identities?.[backlog]?.[handle] !== undefined) {
    throw new BackeError('conflict', m.identityExists(handle), {
      hint: m.identityExistsHint(backlog, handle),
    });
  }
  const keyPath = join(ctx.homes.backeHome, 'keys', backlog, handle);
  const pub = await generateKeypair(keyPath, `${handle}@backe`);
  let commit: string | undefined;
  try {
    const result = await executeWrite(
      ctx,
      {
        kind: 'op',
        op: {
          op: 'user.add',
          handle,
          name: input.name ?? handle,
          kind: 'agent',
          operator: actor,
          keys: [pub],
          ...(input.body === undefined ? {} : { body: input.body }),
        },
      },
      deps,
    );
    commit = result.commit;
  } catch (error) {
    // Ein Fehler beim Aufräumen darf den ursprünglichen Fehler nicht verdecken.
    await Promise.allSettled([rm(keyPath, { force: true }), rm(`${keyPath}.pub`, { force: true })]);
    throw error;
  }
  if (commit === undefined) {
    throw new BackeError('unexpected', m.writeProducedNoCommit(handle));
  }
  try {
    await setIdentity(ctx.homes, backlog, handle, keyPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BackeError('unexpected', m.identityNotSaved(handle, shortSha(commit), reason), {
      hint: m.identityNotSavedHint(backlog, handle, keyPath, userConfigPath(ctx.homes.backeHome)),
      details: error,
    });
  }
  return { keyPath, commit };
}
