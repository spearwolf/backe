/** `backe commit` (backe.md §2.13): Hand-Edits der Arbeitskopie als Commits. */
import type { Command } from 'commander';
import { commitEdits } from '../../services/commit.ts';
import { action, type Runtime, subcommand } from '../options.ts';
import { json, lines, renderHints, safeText } from '../output.ts';

export function commitCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'commit', 'Hand-Edits der Arbeitskopie committen')
    .option('-m, --message <text>', 'Betreff für Änderungen ohne Operations-Entsprechung')
    .action(
      action(rt, async (env, opts: { message?: string }) => {
        const r = await commitEdits(await env.context(), {
          ...(opts.message === undefined ? {} : { message: opts.message }),
        });
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
              warnings:
                r.warnings.length === 0
                  ? undefined
                  : r.warnings.map((w) => ({ path: w.path, unknown_keys: w.unknownKeys })),
              notices: r.notices.length === 0 ? undefined : r.notices,
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
            r.warnings.map((w) =>
              safeText(
                `Warnung: ${w.path}: unbekannte Keys ${w.unknownKeys.join(', ')} — eigene Daten gehören nach props`,
              ),
            ),
          ) + renderHints(r.notices),
        );
      }),
    );
}
