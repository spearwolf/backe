/**
 * `backe next [-p <projekt>] [-s <sprint>] [--repo <name>] [--level leaf|top] [-A] [--claim]`
 * (backe.md §2.16.5, §2.22, §2.23).
 */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { nextClaim } from '../../services/claim.ts';
import { type NextQuery, nextIssue } from '../../services/next.ts';
import { NEXT_FIELDS, nextJson } from '../../services/views.ts';
import { action, emitNotices, type Runtime, subcommand, syncOption } from '../options.ts';
import { headerLine, json, lines } from '../output.ts';
import { issueLines } from '../render-issue.ts';
import { m } from './next.messages.ts';

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
  throw new BackeError('validation', m.invalidLevel(value), { hint: m.levelHint });
}

export function nextCommand(program: Command, rt: Runtime): void {
  syncOption(subcommand(program, 'next', m.description))
    .option(m.projectFlags, m.projectOption)
    .option('-s, --sprint <slug>', m.sprintOption)
    .option('--repo <name>', m.repoOption)
    .option('--level <leaf|top>', m.levelOption)
    .option('-A, --all', m.allOption)
    .option('--claim', m.claimOption)
    .action(
      action(
        rt,
        async (env, opts: Opts) => {
          if (opts.claim === true && opts.sync === true) {
            throw new BackeError('usage', m.syncExcludesClaim, {
              hint: m.syncExcludesClaimHint,
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
            env.out(
              json(
                nextJson(r, {
                  ...(claimed === undefined
                    ? {}
                    : { claimed: { commit: claimed.claim.commit, attempts: claimed.attempts } }),
                  notices,
                  warnings,
                  ...(env.fields === undefined ? {} : { fields: env.fields }),
                }),
              ),
            );
            return;
          }
          const header = headerLine(r.header);
          const [line] = issueLines([item], env.color);
          env.out(
            lines([
              ...(header === undefined ? [] : [header]),
              `${line}${r.resumed ? `  ${m.alreadyRunning}` : ''}`,
            ]),
          );
          emitNotices(env, notices, warnings);
        },
        // `--claim` liest nicht, er synct selbst blockierend.
        { fields: NEXT_FIELDS, read: (opts) => opts.claim !== true },
      ),
    );
}
