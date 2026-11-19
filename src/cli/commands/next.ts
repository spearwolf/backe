/** `backe next [-p <projekt>] [-s <sprint>] [--repo <name>] [--level leaf|top] [-A]` (backe.md §2.22, §2.23). */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { type NextQuery, nextIssue } from '../../services/next.ts';
import { action, emitNotices, type Runtime, subcommand } from '../options.ts';
import { headerLine, json, lines, pickFields } from '../output.ts';
import { ISSUE_FIELDS, issueLines, issueListJson } from '../render-issue.ts';

/** Erlaubte Felder für `next --fields`: Issue-Felder plus `open_deps`. */
const NEXT_FIELDS: readonly string[] = [...ISSUE_FIELDS, 'open_deps'];

type Opts = { project?: string; sprint?: string; repo?: string; level?: string; all?: boolean };

function levelArg(value: string | undefined): NextQuery['level'] {
  if (value === undefined || value === 'leaf' || value === 'top') return value;
  throw new BackeError('validation', `Ungültige Ebene: »${value}«`, { hint: 'leaf oder top' });
}

export function nextCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'next', 'nächstes Issue für mich zeigen, ohne es zu übernehmen')
    .option('-p, --project <pfad>', 'nur in diesem Projekt')
    .option('-s, --sprint <slug>', 'nur in diesem Sprint')
    .option('--repo <name>', 'nur mit diesem Repo')
    .option('--level <leaf|top>', 'Arbeitseinheit: Blatt (Default) oder ganzer Teilbaum')
    .option('-A, --all', 'Kontextfilter (Projekt, Sprint, Repo) ignorieren')
    .action(
      action(
        rt,
        async (env, opts: Opts) => {
          const level = levelArg(opts.level);
          const r = await nextIssue(await env.context(), {
            ...(level === undefined ? {} : { level }),
            ...(opts.project === undefined ? {} : { project: opts.project }),
            ...(opts.sprint === undefined ? {} : { sprint: opts.sprint }),
            ...(opts.repo === undefined ? {} : { repo: opts.repo }),
            ...(opts.all === true ? { all: true } : {}),
          });
          const item = { issue: r.issue, openDeps: r.openDeps };
          if (env.format === 'json') {
            const issue = issueListJson(item);
            env.out(
              json({
                context: Object.keys(r.header).length === 0 ? undefined : r.header,
                issue:
                  env.fields === undefined ? issue : pickFields(issue, env.fields, NEXT_FIELDS),
                resumed: r.resumed,
                notices: r.notices.length === 0 ? undefined : r.notices,
              }),
            );
            return;
          }
          const header = headerLine(r.header);
          const [line] = issueLines([item], env.color);
          env.out(
            lines([
              ...(header === undefined ? [] : [header]),
              `${line}${r.resumed ? '  (läuft schon)' : ''}`,
            ]),
          );
          emitNotices(env, r.notices);
        },
        { fields: NEXT_FIELDS },
      ),
    );
}
