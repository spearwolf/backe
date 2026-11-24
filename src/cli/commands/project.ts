/** `backe project create | list | show | mv | rm` (backe.md §2.9, §2.17). */
import type { Command } from 'commander';
import {
  createProject,
  listProjects,
  moveProject,
  removeProject,
  showProject,
} from '../../services/projects.ts';
import { STATE_ORDER } from '../../services/sprints.ts';
import {
  action,
  bodyArg,
  emit,
  emitOutcome,
  type Runtime,
  subcommand,
  syncOption,
} from '../options.ts';
import { bodyBlock, columns, fieldRows, lines, paint, safeText } from '../output.ts';
import { m } from './project.messages.ts';

type CreateOpts = { title?: string; lead?: string; description?: string; file?: string };

export function projectCommands(program: Command, rt: Runtime): void {
  const project = subcommand(program, 'project', m.description);
  project.addHelpText('after', () => m.guide);

  subcommand(project, m.createCommand, m.createDescription)
    .option(m.titleFlags, m.titleOption)
    .option('--lead <user|me>', m.leadOption)
    .option('-d, --description <md|->', m.descriptionOption)
    .option(m.fileFlags, m.fileOption)
    .action(
      action(
        rt,
        async (env, path: string, opts: CreateOpts) => {
          const body = await bodyArg(env, opts);
          const r = await createProject(await env.context(), {
            path,
            ...(opts.title === undefined ? {} : { title: opts.title }),
            ...(opts.lead === undefined ? {} : { lead: opts.lead }),
            ...(body === undefined ? {} : { body }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );

  syncOption(subcommand(project, 'list', m.listDescription)).action(
    action(
      rt,
      async (env) => {
        const rows = await listProjects(await env.context());
        emit(env, rows, () => lines(columns(rows.map((p) => [p.path, String(p.open), p.title]))));
      },
      { read: true },
    ),
  );

  syncOption(subcommand(project, m.showCommand, m.showDescription)).action(
    action(
      rt,
      async (env, path: string) => {
        const r = await showProject(await env.context(), path);
        // Zählungen in der Reihenfolge des Zustandsmodells, in Text wie JSON.
        const counts = STATE_ORDER.flatMap((st) => {
          const n = r.counts[st];
          return n === undefined ? [] : [[st, n] as const];
        });
        emit(
          env,
          {
            path: r.path,
            ...r.project,
            body: r.body === '' ? undefined : r.body,
            subprojects: r.subprojects.length === 0 ? undefined : r.subprojects,
            counts: Object.fromEntries(counts),
          },
          () =>
            lines([
              `${safeText(r.path)}  ${paint(env.color, 'bold', r.project.title)}`,
              ...fieldRows([
                ['lead', r.project.lead],
                ['subprojects', r.subprojects.join(', ')],
                [
                  'issues',
                  counts.length === 0 ? m.none : counts.map(([st, n]) => `${st} ${n}`).join(', '),
                ],
              ]),
              ...bodyBlock(r.body),
            ]),
        );
      },
      { read: true },
    ),
  );

  subcommand(project, m.mvCommand, m.mvDescription).action(
    action(
      rt,
      async (env, from: string, to: string) => {
        emitOutcome(env, await moveProject(await env.context(), from, to), 'other');
      },
      { write: true },
    ),
  );

  subcommand(project, m.rmCommand, m.rmDescription)
    .option(m.reassignFlags, m.reassignOption)
    .option('--detach', m.detachOption)
    .action(
      action(
        rt,
        async (env, path: string, opts: { reassign?: string; detach?: boolean }) => {
          const r = await removeProject(await env.context(), path, {
            ...(opts.reassign === undefined ? {} : { reassign: opts.reassign }),
            ...(opts.detach === true ? { detach: true } : {}),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );
}
