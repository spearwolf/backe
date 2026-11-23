/** `backe init [pfad] --name n --prefix p [--remote url] [--key pfad] [--user-name name]` (backe.md §2.14). */
import { join } from 'node:path';
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { initBacklog } from '../../services/init.ts';
import { exists } from '../../store/files.ts';
import { absPath, action, type CommandEnv, emit, type Runtime, subcommand } from '../options.ts';
import { safeText } from '../output.ts';
import { m } from './init.messages.ts';

type Opts = { name: string; prefix: string; remote?: string; key?: string; userName?: string };

/** Signing-Key: `--key`, sonst `~/.ssh/id_ed25519.pub`, falls vorhanden. */
async function signingKey(env: CommandEnv, given: string | undefined): Promise<string> {
  if (given !== undefined) return absPath(given, env.io);
  const fallback = join(env.homes.home, '.ssh', 'id_ed25519.pub');
  if (await exists(fallback)) return fallback;
  throw new BackeError('usage', m.noSigningKey, {
    hint: m.noSigningKeyHint(fallback),
  });
}

export function initCommand(program: Command, rt: Runtime): void {
  subcommand(program, m.command, m.description)
    .requiredOption('--name <name>', m.nameOption)
    .requiredOption(m.prefixFlags, m.prefixOption)
    .option('--remote <url>', m.remoteOption)
    .option(m.keyFlags, m.keyOption)
    .option('--user-name <name>', m.userNameOption)
    .action(
      action(rt, async (env, dir: string | undefined, opts: Opts) => {
        const handle = env.handle();
        const key = await signingKey(env, opts.key);
        const r = await initBacklog({
          homes: env.homes,
          env: env.io.env,
          ...(dir === undefined ? {} : { dir: absPath(dir, env.io) }),
          name: opts.name,
          prefix: opts.prefix,
          ...(opts.remote === undefined ? {} : { remote: opts.remote }),
          handle,
          key,
          ...(opts.userName === undefined ? {} : { userName: opts.userName }),
        });
        emit(env, r, () => safeText(`${r.root}\n`));
      }),
    );
}
