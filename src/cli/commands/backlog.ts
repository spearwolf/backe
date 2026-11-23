/** `backe backlog list | use | clone | add | remove | show` (backe.md §2.14). */
import type { Command } from 'commander';
import { listBacklogs, useBacklog } from '../../context/registry.ts';
import { BackeError } from '../../core/errors.ts';
import { shortSha } from '../../core/ids.ts';
import {
  addBacklog,
  cloneBacklog,
  removeBacklog,
  showBacklog,
  type WorkingCopyInfo,
} from '../../services/working-copy.ts';
import { absPath, action, type CommandEnv, emit, type Runtime, subcommand } from '../options.ts';
import { columns, lines, paint, renderHints, safeText } from '../output.ts';
import { m } from './backlog.messages.ts';

/** Lokale Pfade (`./…`, `../…`, `~/…`) werden wie bei `add` expandiert; URLs bleiben, wie sie sind. */
const PATH_LIKE = /^(?:\.\.?(?:\/|$)|~(?:\/|$))/;

/** Hinweise eines Clones oder `add` (etwa Verify-Gründe im Modus `warn`) im Text-Modus nach stderr. */
function hints(env: CommandEnv, notices: readonly string[]): void {
  if (env.format !== 'json' && notices.length > 0) env.io.stderr(renderHints(notices));
}

function workingCopyRow(wc: WorkingCopyInfo): string[] {
  const kind = wc.managed ? m.kindManaged : m.kindBound;
  if (!wc.exists) return [wc.handle, wc.path, kind, m.missing];
  const parts = [
    m.identity(wc.identity ?? '-'),
    m.anchor(wc.anchor === undefined ? '-' : shortSha(wc.anchor)),
  ];
  return [wc.handle, wc.path, kind, parts.join(', ')];
}

export function backlogCommands(program: Command, rt: Runtime): void {
  const backlog = subcommand(program, 'backlog', m.description);

  subcommand(backlog, 'list', m.listDescription).action(
    action(rt, async (env) => {
      const entries = listBacklogs(env.userConfig);
      if (env.format === 'json') return emit(env, entries, () => '');
      if (entries.length === 0) {
        env.io.stderr(renderHints([m.noBacklogYet]));
        return;
      }
      // `* ` vor dem aktuellen, zwei Leerzeichen vor den anderen; dann Name und Remote.
      const rows = columns(entries.map((e) => [e.name, e.remote ?? ''])).map((row, i) =>
        entries[i]?.current ? paint(env.color, 'bold', `* ${row}`) : `  ${row}`,
      );
      env.out(lines(rows));
    }),
  );

  subcommand(backlog, 'use <name>', m.useDescription).action(
    action(rt, async (env, name: string) => {
      await useBacklog(env.homes, name);
      emit(env, { current: name }, () => safeText(`${m.current(name)}\n`));
    }),
  );

  subcommand(backlog, 'clone <url>', m.cloneDescription)
    .option('--name <name>', m.nameOption)
    .action(
      action(rt, async (env, url: string, opts: { name?: string }) => {
        const r = await cloneBacklog({
          homes: env.homes,
          env: env.io.env,
          url: PATH_LIKE.test(url) ? absPath(url, env.io) : url,
          handle: env.handle(),
          ...(opts.name === undefined ? {} : { name: opts.name }),
        });
        emit(env, r, () => safeText(`${r.root}\n`));
        hints(env, r.notices);
      }),
    );

  subcommand(backlog, m.addCommand, m.addDescription).action(
    action(rt, async (env, name: string, path: string) => {
      const r = await addBacklog({
        homes: env.homes,
        env: env.io.env,
        name,
        path: absPath(path, env.io),
        handle: env.handle(),
      });
      emit(env, r, () => safeText(`${r.root}\n`));
      hints(env, r.notices);
    }),
  );

  subcommand(backlog, 'remove <name>', m.removeDescription)
    .option('--purge', m.purgeOption)
    .option('--force', m.forceOption)
    .action(
      action(rt, async (env, name: string, opts: { purge?: boolean; force?: boolean }) => {
        if (opts.force === true && opts.purge !== true) {
          throw new BackeError('usage', m.forceNeedsPurge);
        }
        const { purged } = await removeBacklog({
          homes: env.homes,
          name,
          purge: opts.purge === true,
          force: opts.force === true,
        });
        emit(env, { removed: name, purged }, () =>
          safeText(lines([m.removed(name), ...(purged === undefined ? [] : [m.purged(purged)])])),
        );
      }),
    );

  subcommand(backlog, 'show [name]', m.showDescription).action(
    action(rt, async (env, given: string | undefined) => {
      const name = given ?? (await env.context()).backlog.value;
      const r = await showBacklog(env.homes, env.userConfig, name);
      // JSON mit snake_case-Keys (`working_copies`).
      emit(env, { entry: r.entry, working_copies: r.workingCopies }, () => {
        const { entry, workingCopies } = r;
        const out = [`name: ${entry.name}`];
        if (entry.remote !== undefined) out.push(`remote: ${entry.remote}`);
        if (entry.user !== undefined) out.push(`user: ${entry.user}`);
        out.push(m.currentFlag(entry.current));
        if (workingCopies.length === 0) out.push(m.workingCopiesNone);
        else
          out.push(
            m.workingCopiesLabel,
            ...columns(workingCopies.map(workingCopyRow)).map((l) => `  ${l}`),
          );
        return safeText(lines(out));
      });
    }),
  );
}
