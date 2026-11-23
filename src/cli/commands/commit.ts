/**
 * `backe commit [-m <text>]` (backe.md §2.13): Hand-Edits der Arbeitskopie als Commits;
 * `backe commit --resign` signiert fremde lokale Commits neu.
 */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { commitEdits } from '../../services/commit.ts';
import { resignCommits } from '../../services/resign.ts';
import { action, type CommandEnv, type Runtime, subcommand } from '../options.ts';
import { m as outputMessages } from '../output.messages.ts';
import { json, lines, renderHints, renderNotices, safeText } from '../output.ts';
import { m } from './commit.messages.ts';

/** `[]` wird zu `undefined`: JSON trägt nur gesetzte Felder. */
const some = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length === 0 ? undefined : list;

/**
 * `--resign`: fremde lokale Commits (etwa ein nacktes `git commit`) übersetzt und neu signiert.
 * Text je neu gebautem Commit seine Zusammenfassung, ohne Fremdes `Nichts neu zu signieren`.
 */
async function resign(env: CommandEnv): Promise<void> {
  const r = await resignCommits(await env.context());
  env.committed(r.commits.at(-1)?.commit);
  if (env.format === 'json') {
    env.out(json({ commits: r.commits, rewritten: r.rewritten, notices: r.notices }));
    return;
  }
  env.out(
    r.rewritten === 0 ? `${m.nothingToResign}\n` : lines(r.commits.map((c) => safeText(c.summary))),
  );
  env.io.stderr(renderNotices(r.notices ?? [], []));
}

export function commitCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'commit', m.description)
    .option('-m, --message <text>', m.messageOption)
    .option('--resign', m.resignOption)
    .action(
      action(
        rt,
        async (env, opts: { message?: string; resign?: boolean }) => {
          if (opts.resign === true) {
            if (opts.message !== undefined) {
              throw new BackeError('usage', m.resignExcludesMessage);
            }
            return resign(env);
          }
          const r = await commitEdits(await env.context(), {
            ...(opts.message === undefined ? {} : { message: opts.message }),
          });
          env.committed(r.commits.at(-1)?.commit);
          if (env.format === 'json') {
            env.out(
              json({
                commits: r.commits.map((c) => ({
                  commit: c.commit,
                  kind: c.kind,
                  summary: c.summary,
                  ops: c.recorded,
                  paths: c.paths,
                })),
                notices: some(r.notices),
                rewritten: some(r.rewritten),
                warnings: some(r.warnings),
                unknown_keys: some(r.unknownKeys),
              }),
            );
            return;
          }
          env.out(
            r.commits.length === 0
              ? `${m.nothingToCommit}\n`
              : lines(r.commits.map((c) => safeText(c.summary))),
          );
          env.io.stderr(
            lines(
              r.unknownKeys.map((u) =>
                safeText(
                  `${outputMessages.warningPrefix} ${m.unknownKeys(u.path, u.keys.join(', '))}`,
                ),
              ),
            ) +
              renderHints([
                ...r.notices.map((n) => n.message),
                ...r.rewritten.map((w) => `${w.path}: ${m.rewriteNotice(w.reason)}`),
              ]) +
              renderNotices([], r.warnings),
          );
        },
        { write: true },
      ),
    );
}
