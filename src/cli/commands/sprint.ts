/** `backe sprint create | list | show | close` (backe.md §2.10, §2.17, §2.18). */
import type { Command } from 'commander';
import { closeSprint, createSprint, listSprints, showSprint } from '../../services/sprints.ts';
import {
  action,
  bodyArg,
  collect,
  emit,
  emitOutcome,
  type Runtime,
  subcommand,
} from '../options.ts';
import { bodyBlock, columns, headerLine, json, lines, paint, safeText } from '../output.ts';
import { issueLines, issueListJson } from '../render-issue.ts';
import { listSort } from './issue.ts';

type CreateOpts = {
  title: string;
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

const CLOSED = '(geschlossen)';

export function sprintCommands(program: Command, rt: Runtime): void {
  const sprint = subcommand(program, 'sprint', 'Sprints anlegen, listen, zeigen und abschließen');

  subcommand(sprint, 'create <slug>', 'Sprint anlegen')
    .requiredOption('-t, --title <titel>', 'Titel')
    .option('--start <datum>', 'Beginn (JJJJ-MM-TT)')
    .option('--end <datum>', 'Ende (JJJJ-MM-TT)')
    .option(
      '-d, --description <md|->',
      "Sprint-Ziel; »-« liest stdin, das nicht leer sein darf (ohne Text: -d '')",
    )
    .option('-F, --file <pfad>', 'Sprint-Ziel aus Datei (darf leer sein)')
    .action(
      action(rt, async (env, slug: string, opts: CreateOpts) => {
        const body = await bodyArg(env, opts);
        const r = await createSprint(await env.context(), {
          slug,
          title: opts.title,
          ...(opts.start === undefined ? {} : { start: opts.start }),
          ...(opts.end === undefined ? {} : { end: opts.end }),
          ...(body === undefined ? {} : { body }),
        });
        emitOutcome(env, r, 'other');
      }),
    );

  subcommand(sprint, 'list', 'Sprints, offene zuerst, mit der Zahl offener Issues').action(
    action(rt, async (env) => {
      const rows = await listSprints(await env.context());
      emit(env, rows, () =>
        lines(
          columns(
            rows.map((sp) => [
              sp.slug,
              range(sp.start, sp.end),
              String(sp.open),
              sp.closed ? `${sp.title}  ${CLOSED}` : sp.title,
            ]),
          ),
        ),
      );
    }),
  );

  subcommand(sprint, 'show <slug>', 'Issues eines Sprints, gruppiert nach State')
    .option(
      '-p, --project <pfad>',
      'nur Issues dieses Projekts samt Unterprojekten (wiederholbar)',
      collect,
    )
    .option('--repo <name>', 'nur Issues mit diesem Repo (wiederholbar)', collect)
    .option('-A, --all', 'Kontextfilter (Projekt, Repo) ignorieren')
    .option('--sort <rank|created>', 'Sortierung in den Gruppen (Default rank)')
    .action(
      action(rt, async (env, slug: string, opts: ShowOpts) => {
        const sort = listSort(opts.sort);
        const r = await showSprint(await env.context(), slug, {
          ...(opts.project === undefined ? {} : { projects: opts.project }),
          ...(opts.repo === undefined ? {} : { repos: opts.repo }),
          ...(opts.all === true ? { all: true } : {}),
          ...(sort === undefined ? {} : { sort }),
        });
        if (env.format === 'json') {
          env.out(
            json({
              context: Object.keys(r.header).length === 0 ? undefined : r.header,
              slug,
              ...r.sprint,
              body: r.body === '' ? undefined : r.body,
              groups: r.groups.map((g) => ({ state: g.state, issues: g.items.map(issueListJson) })),
            }),
          );
          return;
        }
        const { title, start, end, closed } = r.sprint;
        const when = range(start, end);
        const head = [
          safeText(slug),
          paint(env.color, 'bold', title),
          ...(when === '-' ? [] : [safeText(when)]),
          ...(closed === true ? [CLOSED] : []),
        ].join('  ');
        const header = headerLine(r.header);
        // Eine Spaltenbreite über alle Gruppen, damit die Gruppen untereinander fluchten.
        const all = issueLines(
          r.groups.flatMap((g) => g.items),
          env.color,
        );
        const out = [head, ...(header === undefined ? [] : [header]), ...bodyBlock(r.body)];
        let at = 0;
        for (const g of r.groups) {
          out.push('', `${g.state} (${g.items.length})`, ...all.slice(at, at + g.items.length));
          at += g.items.length;
        }
        env.out(lines(out));
      }),
    );

  subcommand(sprint, 'close <slug>', 'Sprint abschließen; offene Issues bleiben zugeordnet')
    .option('--carry-over <slug>', 'offene Issues zusätzlich diesem Sprint zuordnen')
    .action(
      action(rt, async (env, slug: string, opts: { carryOver?: string }) => {
        const r = await closeSprint(await env.context(), slug, {
          ...(opts.carryOver === undefined ? {} : { carryOver: opts.carryOver }),
        });
        emitOutcome(env, r, 'other');
      }),
    );
}
