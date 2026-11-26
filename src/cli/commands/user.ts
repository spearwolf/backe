/** `backe user add | create-agent | list | show | revoke-key | rm` (backe.md §2.12, §2.17). */
import type { Command } from 'commander';
import { readPublicKey } from '../../git/ssh.ts';
import { createAgent } from '../../services/agent.ts';
import { addUser, listUsers, removeUser, revokeKey, showUser } from '../../services/users.ts';
import {
  absPath,
  action,
  emit,
  emitOutcome,
  type Runtime,
  subcommand,
  syncOption,
} from '../options.ts';
import { bodyBlock, columns, fieldRows, lines, paint, safeText } from '../output.ts';
import { m } from './user.messages.ts';

type AddOpts = { key: string; name?: string; agent?: boolean; operator?: string };

/** Erste Zeile mit Label, jede weitere eingerückt darunter; ohne Werte `keine`. */
function listField(label: string, values: readonly string[]): [string, string][] {
  if (values.length === 0) return [[label, m.none]];
  return values.map((v, i) => [i === 0 ? label : '', v]);
}

export function userCommands(program: Command, rt: Runtime): void {
  const user = subcommand(program, 'user', m.description);

  subcommand(user, 'add <handle>', m.addDescription)
    .requiredOption('--key <pubfile>', m.keyOption)
    .option('--name <name>', m.nameOption)
    .option('--agent', m.agentOption)
    .option('--operator <handle>', m.operatorOption)
    .action(
      action(
        rt,
        async (env, handle: string, opts: AddOpts) => {
          const r = await addUser(await env.context(), {
            handle,
            key: await readPublicKey(absPath(opts.key, env.io)),
            ...(opts.name === undefined ? {} : { name: opts.name }),
            ...(opts.agent === true ? { agent: true } : {}),
            ...(opts.operator === undefined ? {} : { operator: opts.operator }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );

  subcommand(user, 'create-agent <handle>', m.createAgentDescription)
    .option('--name <name>', m.nameOption)
    .action(
      action(
        rt,
        async (env, handle: string, opts: { name?: string }) => {
          const r = await createAgent(await env.context(), {
            handle,
            ...(opts.name === undefined ? {} : { name: opts.name }),
          });
          env.committed(r.commit);
          emit(env, { handle, key_path: r.keyPath, commit: r.commit }, () =>
            safeText(`${r.keyPath}\n`),
          );
        },
        { write: true },
      ),
    );

  syncOption(subcommand(user, 'list', m.listDescription)).action(
    action(
      rt,
      async (env) => {
        const rows = await listUsers(await env.context());
        emit(env, rows, () =>
          lines(
            columns(
              rows.map((u) => [
                u.handle,
                u.kind,
                [
                  u.name,
                  ...(u.admin ? ['(admin)'] : []),
                  ...(u.operator === undefined ? [] : [`operator=${u.operator}`]),
                ].join('  '),
              ]),
            ),
          ),
        );
      },
      { read: true },
    ),
  );

  syncOption(subcommand(user, 'show <handle|me>', m.showDescription)).action(
    action(
      rt,
      async (env, who: string) => {
        const r = await showUser(await env.context(), who);
        const revoked = r.revoked.map((k) => m.revokedKey(k.fingerprint, k.revoked));
        emit(
          env,
          {
            handle: r.handle,
            name: r.user.name,
            kind: r.user.kind,
            operator: r.user.operator,
            admin: r.admin,
            fingerprints: r.fingerprints.length === 0 ? undefined : r.fingerprints,
            revoked: r.revoked.length === 0 ? undefined : r.revoked,
            body: r.body === '' ? undefined : r.body,
          },
          () =>
            lines([
              `${safeText(r.handle)}  ${paint(env.color, 'bold', r.user.name)}`,
              ...fieldRows([
                ['kind', r.user.kind],
                ['operator', r.user.operator],
                ['admin', r.admin ? m.yes : m.no],
                ...listField('keys', r.fingerprints),
                ...(revoked.length === 0 ? [] : listField('revoked', revoked)),
              ]),
              ...bodyBlock(r.body),
            ]),
        );
      },
      { read: true },
    ),
  );

  subcommand(user, 'revoke-key <handle|me> <fingerprint>', m.revokeDescription).action(
    action(
      rt,
      async (env, who: string, fingerprint: string) => {
        emitOutcome(env, await revokeKey(await env.context(), who, fingerprint), 'other');
      },
      { write: true },
    ),
  );

  subcommand(user, 'rm <handle>', m.rmDescription).action(
    action(
      rt,
      async (env, handle: string) => {
        emitOutcome(env, await removeUser(await env.context(), handle), 'other');
      },
      { write: true },
    ),
  );
}
