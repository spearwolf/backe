/** `backe backlog list | use | clone | add | remove | show` (backe.md §2.14). */
import type { Command } from 'commander';
import { listBacklogs, useBacklog } from '../../context/registry.ts';
import {
  addBacklog,
  cloneBacklog,
  removeBacklog,
  showBacklog,
  type WorkingCopyInfo,
} from '../../services/working-copy.ts';
import { absPath, action, type CommandEnv, emit, type Runtime, subcommand } from '../options.ts';
import { columns, lines, paint, renderHints } from '../output.ts';

const short = (sha: string) => sha.slice(0, 7);

/** Lokale Pfade (`./…`, `../…`, `~/…`) werden wie bei `add` expandiert; URLs bleiben, wie sie sind. */
const PATH_LIKE = /^(?:\.\.?(?:\/|$)|~(?:\/|$))/;

/** Hinweise eines Clones oder `add` (etwa Verify-Gründe im Modus `warn`) im Text-Modus nach stderr. */
function hints(env: CommandEnv, notices: readonly string[]): void {
  if (env.format !== 'json' && notices.length > 0) env.io.stderr(renderHints(notices));
}

function workingCopyRow(wc: WorkingCopyInfo): string[] {
  const kind = wc.managed ? 'verwaltet' : 'gebunden';
  if (!wc.exists) return [wc.handle, wc.path, kind, 'fehlt'];
  const parts = [
    `Identität ${wc.identity ?? '-'}`,
    `Anker ${wc.anchor === undefined ? '-' : short(wc.anchor)}`,
  ];
  return [wc.handle, wc.path, kind, parts.join(', ')];
}

export function backlogCommands(program: Command, rt: Runtime): void {
  const backlog = subcommand(program, 'backlog', 'registrierte Backlogs verwalten');

  subcommand(backlog, 'list', 'registrierte Backlogs, der aktuelle mit *').action(
    action(rt, async (env) => {
      const entries = listBacklogs(env.userConfig);
      if (env.format === 'json') return emit(env, entries, () => '');
      if (entries.length === 0) {
        env.io.stderr(
          renderHints(['Noch kein Backlog registriert: backe init oder backe backlog clone <url>']),
        );
        return;
      }
      // `* ` vor dem aktuellen, zwei Leerzeichen vor den anderen; dann Name und Remote.
      const rows = columns(entries.map((e) => [e.name, e.remote ?? ''])).map((row, i) =>
        entries[i]?.current ? paint(env.color, 'bold', `* ${row}`) : `  ${row}`,
      );
      env.out(lines(rows));
    }),
  );

  subcommand(backlog, 'use <name>', 'aktuellen Backlog setzen').action(
    action(rt, async (env, name: string) => {
      await useBacklog(env.homes, name);
      emit(env, { current: name }, () => `aktuell: ${name}\n`);
    }),
  );

  subcommand(backlog, 'clone <url>', 'Backlog registrieren und die eigene Arbeitskopie klonen')
    .option('--name <name>', 'erwarteter Name des Backlogs')
    .action(
      action(rt, async (env, url: string, opts: { name?: string }) => {
        const r = await cloneBacklog({
          homes: env.homes,
          env: env.io.env,
          url: PATH_LIKE.test(url) ? absPath(url, env.io) : url,
          handle: env.handle(),
          ...(opts.name === undefined ? {} : { name: opts.name }),
        });
        emit(env, r, () => `${r.root}\n`);
        hints(env, r.notices);
      }),
    );

  subcommand(backlog, 'add <name> <pfad>', 'vorhandenen Clone an eine Identität binden').action(
    action(rt, async (env, name: string, path: string) => {
      const r = await addBacklog({
        homes: env.homes,
        env: env.io.env,
        name,
        path: absPath(path, env.io),
        handle: env.handle(),
      });
      emit(env, r, () => `${r.root}\n`);
      hints(env, r.notices);
    }),
  );

  subcommand(backlog, 'remove <name>', 'Backlog deregistrieren')
    .option('--purge', 'verwaltete Clones löschen')
    .action(
      action(rt, async (env, name: string, opts: { purge?: boolean }) => {
        const { purged } = await removeBacklog({
          homes: env.homes,
          name,
          purge: opts.purge === true,
        });
        emit(env, { removed: name, purged }, () =>
          lines([`entfernt: ${name}`, ...(purged === undefined ? [] : [`gelöscht: ${purged}`])]),
        );
      }),
    );

  subcommand(
    backlog,
    'show [name]',
    'Eintrag und Arbeitskopien eines Backlogs (Default: Kontext)',
  ).action(
    action(rt, async (env, given: string | undefined) => {
      const name = given ?? (await env.context()).backlog.value;
      const r = await showBacklog(env.homes, env.userConfig, name);
      emit(env, r, () => {
        const { entry, workingCopies } = r;
        const out = [`name: ${entry.name}`];
        if (entry.remote !== undefined) out.push(`remote: ${entry.remote}`);
        if (entry.user !== undefined) out.push(`user: ${entry.user}`);
        out.push(`aktuell: ${entry.current ? 'ja' : 'nein'}`);
        if (workingCopies.length === 0) out.push('arbeitskopien: keine');
        else
          out.push(
            'arbeitskopien:',
            ...columns(workingCopies.map(workingCopyRow)).map((l) => `  ${l}`),
          );
        return lines(out);
      });
    }),
  );
}
