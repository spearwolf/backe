/** `backe sprint create | list | show | close` (backe.md §2.10, §2.17, §2.18). */
import type { Command } from 'commander';
import { listSort } from '../../services/issue-list.ts';
import { closeSprint, createSprint, listSprints, showSprint } from '../../services/sprints.ts';
import { sprintShowJson } from '../../services/views.ts';
import {
  action,
  bodyArg,
  collect,
  emit,
  emitOutcome,
  type Runtime,
  subcommand,
  syncOption,
} from '../options.ts';
import { bodyBlock, columns, headerLine, json, lines, paint, safeText } from '../output.ts';
import { issueLines } from '../render-issue.ts';
import { m } from './sprint.messages.ts';

type CreateOpts = {
  title?: string;
  start?: string;
  end?: string;
  description?: string;
  file?: string;
};

type ShowOpts = { project?: string[]; repo?: string[]; all?: boolean; sort?: string };

/** `<start>–<end>`; eine fehlende Seite bleibt leer, ohne beide `-`. */
function range(start: string | undefined, end: string | undefined): string {
  if (start === undefined && end === undefined) return '-';
  return `${start ?? ''}–${end ?? ''}`;
}

type SprintShow = Awaited<ReturnType<typeof showSprint>>;

/** Text von `sprint show`: Kopf, Filterzeile, Beschreibung, dann die Issues je State. */
function renderSprintShow(slug: string, r: SprintShow, color: boolean): string {
  const { title, start, end, closed } = r.sprint;
  const when = range(start, end);
  const head = [
    safeText(slug),
    paint(color, 'bold', title),
    ...(when === '-' ? [] : [safeText(when)]),
    ...(closed === true ? [m.closed] : []),
  ].join('  ');
  const header = headerLine(r.header);
  // Eine Spaltenbreite über alle Gruppen, damit die Gruppen untereinander fluchten.
  const all = issueLines(
    r.groups.flatMap((g) => g.items),
    color,
  );
  const out = [head, ...(header === undefined ? [] : [header]), ...bodyBlock(r.body)];
  let at = 0;
  for (const g of r.groups) {
    out.push('', `${g.state} (${g.items.length})`, ...all.slice(at, at + g.items.length));
    at += g.items.length;
  }
  return lines(out);
}

export function sprintCommands(program: Command, rt: Runtime): void {
  const sprint = subcommand(program, 'sprint', m.description);

  subcommand(sprint, 'create <slug>', m.createDescription)
    .option(m.titleFlags, m.titleOption)
    .option(m.startFlags, m.startOption)
    .option(m.endFlags, m.endOption)
    .option('-d, --description <md|->', m.descriptionOption)
    .option(m.fileFlags, m.fileOption)
    .action(
      action(
        rt,
        async (env, slug: string, opts: CreateOpts) => {
          const body = await bodyArg(env, opts);
          const r = await createSprint(await env.context(), {
            slug,
            ...(opts.title === undefined ? {} : { title: opts.title }),
            ...(opts.start === undefined ? {} : { start: opts.start }),
            ...(opts.end === undefined ? {} : { end: opts.end }),
            ...(body === undefined ? {} : { body }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );

  syncOption(subcommand(sprint, 'list', m.listDescription)).action(
    action(
      rt,
      async (env) => {
        const rows = await listSprints(await env.context());
        emit(env, rows, () =>
          lines(
            columns(
              rows.map((sp) => [
                sp.slug,
                range(sp.start, sp.end),
                String(sp.open),
                sp.closed ? `${sp.title}  ${m.closed}` : sp.title,
              ]),
            ),
          ),
        );
      },
      { read: true },
    ),
  );

  syncOption(subcommand(sprint, 'show <slug>', m.showDescription))
    .option(m.projectFlags, m.projectOption, collect)
    .option('--repo <name>', m.repoOption, collect)
    .option('-A, --all', m.allOption)
    .option('--sort <rank|created>', m.sortOption)
    .action(
      action(
        rt,
        async (env, slug: string, opts: ShowOpts) => {
          const sort = listSort(opts.sort);
          const r = await showSprint(await env.context(), slug, {
            ...(opts.project === undefined ? {} : { projects: opts.project }),
            ...(opts.repo === undefined ? {} : { repos: opts.repo }),
            ...(opts.all === true ? { all: true } : {}),
            ...(sort === undefined ? {} : { sort }),
          });
          if (env.format === 'json') {
            env.out(json(sprintShowJson(slug, r)));
            return;
          }
          env.out(renderSprintShow(slug, r, env.color));
        },
        { read: true },
      ),
    );

  subcommand(sprint, 'close <slug>', m.closeDescription)
    .option('--carry-over <slug>', m.carryOverOption)
    .action(
      action(
        rt,
        async (env, slug: string, opts: { carryOver?: string }) => {
          const r = await closeSprint(await env.context(), slug, {
            ...(opts.carryOver === undefined ? {} : { carryOver: opts.carryOver }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );
}
