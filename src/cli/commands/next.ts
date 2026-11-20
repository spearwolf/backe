/**
 * `backe next [-p <projekt>] [-s <sprint>] [--repo <name>] [--level leaf|top] [-A] [--claim]`
 * (backe.md §2.16.5, §2.22, §2.23).
 */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { nextClaim } from '../../services/claim.ts';
import { type NextQuery, nextIssue } from '../../services/next.ts';
import { action, emitNotices, type Runtime, subcommand, syncOption } from '../options.ts';
import { headerLine, json, lines, pickFields } from '../output.ts';
import { ISSUE_FIELDS, issueLines, issueListJson } from '../render-issue.ts';

/** Erlaubte Felder für `next --fields`: Issue-Felder plus `open_deps`. */
const NEXT_FIELDS: readonly string[] = [...ISSUE_FIELDS, 'open_deps'];

type Opts = {
  project?: string;
  sprint?: string;
  repo?: string;
  level?: string;
  all?: boolean;
  claim?: boolean;
  sync?: boolean;
};

function levelArg(value: string | undefined): NextQuery['level'] {
  if (value === undefined || value === 'leaf' || value === 'top') return value;
  throw new BackeError('validation', `Ungültige Ebene: »${value}«`, { hint: 'leaf oder top' });
}

export function nextCommand(program: Command, rt: Runtime): void {
  syncOption(
    subcommand(program, 'next', 'nächstes Issue für mich zeigen; mit --claim gleich übernehmen'),
  )
    .option('-p, --project <pfad>', 'nur in diesem Projekt')
    .option('-s, --sprint <slug>', 'nur in diesem Sprint')
    .option('--repo <name>', 'nur mit diesem Repo')
    .option('--level <leaf|top>', 'Arbeitseinheit: Blatt (Default) oder ganzer Teilbaum')
    .option('-A, --all', 'Kontextfilter (Projekt, Sprint, Repo) ignorieren')
    .option('--claim', 'das Issue gleich übernehmen, synchron mit dem Remote')
    .action(
      action(
        rt,
        async (env, opts: Opts) => {
          if (opts.claim === true && opts.sync === true) {
            throw new BackeError('usage', '--sync passt nicht zu --claim', {
              hint: 'der Claim synchronisiert selbst',
            });
          }
          const level = levelArg(opts.level);
          const q: NextQuery = {
            ...(level === undefined ? {} : { level }),
            ...(opts.project === undefined ? {} : { project: opts.project }),
            ...(opts.sprint === undefined ? {} : { sprint: opts.sprint }),
            ...(opts.repo === undefined ? {} : { repo: opts.repo }),
            ...(opts.all === true ? { all: true } : {}),
          };
          const ctx = await env.context();
          // Mit `--claim` wie ein Write dahinter: Commit, Versuche, Hinweise des Claims.
          const claimed = opts.claim === true ? await nextClaim(ctx, q) : undefined;
          const r = claimed ?? (await nextIssue(ctx, q));
          const notices = [...r.notices, ...(claimed?.claim.notices ?? [])];
          const warnings = claimed?.claim.warnings ?? [];
          const item = { issue: r.issue, openDeps: r.openDeps };
          if (env.format === 'json') {
            const issue = issueListJson(item);
            env.out(
              json({
                context: Object.keys(r.header).length === 0 ? undefined : r.header,
                issue:
                  env.fields === undefined ? issue : pickFields(issue, env.fields, NEXT_FIELDS),
                resumed: r.resumed,
                ...(claimed === undefined
                  ? {}
                  : { commit: claimed.claim.commit ?? null, attempts: claimed.attempts }),
                notices: notices.length === 0 ? undefined : notices,
                warnings: warnings.length === 0 ? undefined : warnings,
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
          emitNotices(env, notices, warnings);
        },
        // `--claim` liest nicht, er synct selbst blockierend.
        { fields: NEXT_FIELDS, read: (opts) => opts.claim !== true },
      ),
    );
}
