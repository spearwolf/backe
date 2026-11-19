/** `backe next [-p <projekt>] [-s <sprint>] [--repo <name>] [--level leaf|top] [-A]` (backe.md §2.22, §2.23). */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { type NextQuery, nextIssue } from '../../services/next.ts';
import { action, type Runtime, subcommand } from '../options.ts';
import { headerLine, json, lines, pickFields, renderNotices } from '../output.ts';
import { ISSUE_FIELDS, issueLines } from '../render-issue.ts';

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
          if (env.format === 'json') {
            env.out(
              json({
                context: Object.keys(r.header).length === 0 ? undefined : r.header,
                issue:
                  env.fields === undefined
                    ? r.issue
                    : pickFields(r.issue, env.fields, ISSUE_FIELDS),
                resumed: r.resumed,
                notices: r.notices.length === 0 ? undefined : r.notices,
              }),
            );
            return;
          }
          const header = headerLine(r.header);
          const [line] = issueLines([{ issue: r.issue, openDeps: false }], env.color);
          env.out(
            lines([
              ...(header === undefined ? [] : [header]),
              `${line}${r.resumed ? '  (läuft schon)' : ''}`,
            ]),
          );
          const notices = renderNotices(r.notices, []);
          if (notices !== '') env.io.stderr(notices);
        },
        { fields: ISSUE_FIELDS },
      ),
    );
}
