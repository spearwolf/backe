/**
 * `backe commit [-m <text>]` (backe.md §2.13): Hand-Edits der Arbeitskopie als Commits;
 * `backe commit --resign` signiert fremde lokale Commits neu.
 */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { commitEdits } from '../../services/commit.ts';
import { resignCommits } from '../../services/resign.ts';
import { action, type CommandEnv, type Runtime, subcommand } from '../options.ts';
import { json, lines, renderHints, renderNotices, safeText } from '../output.ts';

const REWRITE_NOTICE = {
  canonical: 'kanonisch umgeschrieben',
  no_effect: 'keine wirksame Änderung',
} as const;

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
    env.out(json({ commits: r.commits, rewritten: r.rewritten }));
    return;
  }
  env.out(
    r.rewritten === 0
      ? 'Nichts neu zu signieren\n'
      : lines(r.commits.map((c) => safeText(c.summary))),
  );
}

export function commitCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'commit', 'Hand-Edits der Arbeitskopie committen')
    .option('-m, --message <text>', 'Betreff für Änderungen ohne Operations-Entsprechung')
    .option('--resign', 'fremde lokale Commits (etwa git commit) übersetzen und neu signieren')
    .action(
      action(
        rt,
        async (env, opts: { message?: string; resign?: boolean }) => {
          if (opts.resign === true) {
            if (opts.message !== undefined) {
              throw new BackeError('usage', '--resign passt nicht zu -m');
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
              ? 'Nichts zu committen\n'
              : lines(r.commits.map((c) => safeText(c.summary))),
          );
          env.io.stderr(
            lines(
              r.unknownKeys.map((u) =>
                safeText(
                  `Warnung: ${u.path}: unbekannte Keys ${u.keys.join(', ')} — eigene Daten gehören nach props`,
                ),
              ),
            ) +
              renderHints([
                ...r.notices.map((n) => n.message),
                ...r.rewritten.map((w) => `${w.path}: ${REWRITE_NOTICE[w.reason]}`),
              ]) +
              renderNotices([], r.warnings),
          );
        },
        { write: true },
      ),
    );
}
