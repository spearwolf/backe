/** `backe repo add | list | rm` (backe.md §2.11, §2.17). */
import type { Command } from 'commander';
import { addRepo, listRepos, removeRepo } from '../../services/repos.ts';
import { action, bodyArg, emit, emitOutcome, type Runtime, subcommand } from '../options.ts';
import { columns, lines } from '../output.ts';

type AddOpts = { name?: string; ref?: string; description?: string };

export function repoCommands(program: Command, rt: Runtime): void {
  const repo = subcommand(program, 'repo', 'Repo-Registry des Backlogs');

  subcommand(repo, 'add <url>', 'Repo registrieren; der Name folgt sonst aus der URL')
    .option('--name <name>', 'Name im Backlog')
    .option('--ref <ref>', 'Default-Ref (etwa main)')
    .option(
      '-d, --description <md|->',
      "Beschreibung; »-« liest stdin, das nicht leer sein darf (ohne Text: -d '')",
    )
    .action(
      action(rt, async (env, url: string, opts: AddOpts) => {
        const body = await bodyArg(env, opts);
        const r = await addRepo(await env.context(), {
          url,
          ...(opts.name === undefined ? {} : { name: opts.name }),
          ...(opts.ref === undefined ? {} : { defaultRef: opts.ref }),
          ...(body === undefined ? {} : { body }),
        });
        emitOutcome(env, r, 'other');
      }),
    );

  subcommand(repo, 'list', 'registrierte Repos mit der Zahl verknüpfter Issues').action(
    action(rt, async (env) => {
      const rows = await listRepos(await env.context());
      // JSON mit den Feldnamen der Repo-Datei (`default_ref`).
      const out = rows.map(({ defaultRef, ...r }) => ({
        name: r.name,
        url: r.url,
        canonical: r.canonical,
        default_ref: defaultRef,
        issues: r.issues,
      }));
      emit(env, out, () =>
        lines(columns(rows.map((r) => [r.name, r.url, r.defaultRef ?? '-', String(r.issues)]))),
      );
    }),
  );

  subcommand(repo, 'rm <name>', 'Repo austragen (nur ohne verknüpfte Issues)').action(
    action(rt, async (env, name: string) => {
      emitOutcome(env, await removeRepo(await env.context(), name), 'other');
    }),
  );
}
