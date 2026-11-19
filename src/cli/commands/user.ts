/** `backe user add | create-agent | list | show | revoke-key | rm` (backe.md §2.12, §2.17). */
import type { Command } from 'commander';
import { createAgent } from '../../services/agent.ts';
import { addUser, listUsers, removeUser, revokeKey, showUser } from '../../services/users.ts';
import { absPath, action, emit, emitOutcome, type Runtime, subcommand } from '../options.ts';
import { bodyBlock, columns, fieldRows, lines, paint, safeText } from '../output.ts';

type AddOpts = { key: string; name?: string; agent?: boolean; operator?: string };

/** Erste Zeile mit Label, jede weitere eingerückt darunter; ohne Werte `keine`. */
function listField(label: string, values: readonly string[]): [string, string][] {
  if (values.length === 0) return [[label, 'keine']];
  return values.map((v, i) => [i === 0 ? label : '', v]);
}

export function userCommands(program: Command, rt: Runtime): void {
  const user = subcommand(program, 'user', 'Users und ihre Keys');

  subcommand(user, 'add <handle>', 'User mit vorhandenem Public Key registrieren')
    .requiredOption('--key <pubfile>', 'Datei mit dem SSH-Public-Key (ssh-ed25519)')
    .option('--name <name>', 'Anzeigename (Default: Handle)')
    .option('--agent', 'als Agent registrieren')
    .option('--operator <handle>', 'verantwortlicher Mensch eines Agents (Default: ich)')
    .action(
      action(rt, async (env, handle: string, opts: AddOpts) => {
        const r = await addUser(await env.context(), {
          handle,
          keyFile: absPath(opts.key, env.io),
          ...(opts.name === undefined ? {} : { name: opts.name }),
          ...(opts.agent === true ? { agent: true } : {}),
          ...(opts.operator === undefined ? {} : { operator: opts.operator }),
        });
        emitOutcome(env, r, 'other');
      }),
    );

  subcommand(
    user,
    'create-agent <handle>',
    'Agent mit eigenem Keypair anlegen und als Identität eintragen; druckt den Key-Pfad',
  )
    .option('--name <name>', 'Anzeigename (Default: Handle)')
    .action(
      action(rt, async (env, handle: string, opts: { name?: string }) => {
        const r = await createAgent(await env.context(), {
          handle,
          ...(opts.name === undefined ? {} : { name: opts.name }),
        });
        emit(env, { handle, key_path: r.keyPath, commit: r.commit }, () =>
          safeText(`${r.keyPath}\n`),
        );
      }),
    );

  subcommand(user, 'list', 'Users mit Art, Admin-Rolle und Operator').action(
    action(rt, async (env) => {
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
    }),
  );

  subcommand(user, 'show <handle|me>', 'User mit aktiven und widerrufenen Keys').action(
    action(rt, async (env, who: string) => {
      const r = await showUser(await env.context(), who);
      const revoked = r.revoked.map((k) => `${k.fingerprint} (widerrufen ${k.revoked ?? '?'})`);
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
              ['admin', r.admin ? 'ja' : 'nein'],
              ...listField('keys', r.fingerprints),
              ...(revoked.length === 0 ? [] : listField('revoked', revoked)),
            ]),
            ...bodyBlock(r.body),
          ]),
      );
    }),
  );

  subcommand(
    user,
    'revoke-key <handle|me> <fingerprint>',
    'aktiven Key widerrufen (Fingerprint oder eindeutiger Präfix ab 8 Zeichen)',
  ).action(
    action(rt, async (env, who: string, fingerprint: string) => {
      emitOutcome(env, await revokeKey(await env.context(), who, fingerprint), 'other');
    }),
  );

  subcommand(user, 'rm <handle>', 'User entfernen (Admins nicht)').action(
    action(rt, async (env, handle: string) => {
      emitOutcome(env, await removeUser(await env.context(), handle), 'other');
    }),
  );
}
