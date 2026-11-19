/** `backe init [pfad] --name n --prefix p [--remote url] [--key pfad] [--user-name name]` (backe.md §2.14). */
import { join } from 'node:path';
import type { Command } from 'commander';
import { exists } from '../../context/paths.ts';
import { BackeError } from '../../core/errors.ts';
import { initBacklog } from '../../services/init.ts';
import { absPath, action, type CommandEnv, emit, type Runtime, subcommand } from '../options.ts';

type Opts = { name: string; prefix: string; remote?: string; key?: string; userName?: string };

/** Signing-Key: `--key`, sonst `~/.ssh/id_ed25519.pub`, falls vorhanden. */
async function signingKey(env: CommandEnv, given: string | undefined): Promise<string> {
  if (given !== undefined) return absPath(given, env.io);
  const fallback = join(env.homes.home, '.ssh', 'id_ed25519.pub');
  if (await exists(fallback)) return fallback;
  throw new BackeError('usage', 'Kein Signing-Key angegeben', {
    hint: `--key <pfad> oder einen Key unter ${fallback}`,
  });
}

export function initCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'init [pfad]', 'neuen Backlog mit signiertem Vertrauensanker anlegen')
    .requiredOption('--name <name>', 'Name des Backlogs')
    .requiredOption('--prefix <präfix>', 'Präfix der Issue-IDs (2 bis 6 Kleinbuchstaben)')
    .option('--remote <url>', 'Remote, auf die der Anker gepusht wird')
    .option('--key <pfad>', 'SSH-Signing-Key (Default ~/.ssh/id_ed25519.pub)')
    .option('--user-name <name>', 'Anzeigename des Admin-Users')
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
        emit(env, r, () => `${r.root}\n`);
      }),
    );
}
