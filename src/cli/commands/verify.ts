/** `backe verify [--since rev] [--accept sha | --revert sha] [--reason text]` (backe.md §2.13, §2.24). */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { quarantineCommit } from '../../services/quarantine.ts';
import { assertVerified, type BacklogVerifyReport, verifyBacklog } from '../../services/verify.ts';
import { action, type CommandEnv, emit, type Runtime, subcommand, text } from '../options.ts';
import { json, lines, paint, renderHints } from '../output.ts';

type Opts = { since?: string; accept?: string; revert?: string; reason?: string };

const short = (sha: string) =>
  /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha) ? sha.slice(0, 7) : sha;

/**
 * `geprüft: <n> Commits seit <anker kurz | --since>`, je ungültigem Commit
 * `<kurz> <subject>: <gründe; …>`, je Quarantäne `<kurz> <decision>: <note>`.
 */
function render(report: BacklogVerifyReport, since: string | undefined, color: boolean): string {
  return lines([
    `geprüft: ${report.checked} Commits seit ${since ?? short(report.anchor)}`,
    ...report.invalid.map((f) =>
      paint(color, 'red', `${short(f.sha)} ${f.subject}: ${f.reasons.join('; ')}`),
    ),
    ...report.quarantined.map((q) =>
      paint(color, 'yellow', `${short(q.sha)} ${q.decision}: ${q.note}`),
    ),
  ]);
}

async function quarantine(env: CommandEnv, opts: Opts): Promise<void> {
  if (opts.accept !== undefined && opts.revert !== undefined) {
    throw new BackeError('usage', '--accept und --revert schließen sich aus');
  }
  if (opts.since !== undefined) {
    throw new BackeError('usage', '--since passt nicht zu --accept oder --revert');
  }
  const [flag, sha, decision] =
    opts.accept !== undefined
      ? (['--accept', opts.accept, 'accepted'] as const)
      : (['--revert', opts.revert as string, 'reverted'] as const);
  const reason =
    opts.reason === undefined ? '' : (await text(opts.reason, env.io, env.stdin)).trim();
  if (reason === '') {
    throw new BackeError('usage', `${flag} braucht --reason mit einer Begründung`, {
      hint: `backe verify ${flag} <sha> --reason <text>`,
    });
  }
  const r = await quarantineCommit(await env.context(), { sha, decision, reason });
  emit(env, { commit: r.commit ?? null, sha, decision, reason }, () =>
    lines([`${short(sha)} ${decision}: ${reason}`]),
  );
}

export function verifyCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'verify', 'Signaturen und Rechte jedes Commits seit dem Anker prüfen')
    .option('--since <rev>', 'nur Commits nach <rev> prüfen')
    .option('--accept <sha>', 'ungültigen Commit als hingenommen in die Quarantäne eintragen')
    .option('--revert <sha>', 'ungültigen Commit umkehren und in die Quarantäne eintragen')
    .option('--reason <text>', 'Begründung für --accept/--revert (»-« liest stdin)')
    .action(
      action(rt, async (env, opts: Opts) => {
        if (opts.accept !== undefined || opts.revert !== undefined) return quarantine(env, opts);
        if (opts.reason !== undefined) {
          throw new BackeError('usage', '--reason gehört zu --accept oder --revert');
        }
        const report = await verifyBacklog(await env.context(), {
          ...(opts.since === undefined ? { record: true } : { since: opts.since }),
        });
        // Im JSON-Modus bleibt stdout bei einem Fehler leer; der Bericht steht in dessen Details.
        if (env.format === 'json') {
          if (report.invalid.length === 0) env.out(json(report));
        } else {
          env.out(render(report, opts.since, env.color));
          const hints = [...report.notices, ...report.propNotices];
          if (hints.length > 0) env.io.stderr(renderHints(hints));
        }
        assertVerified(report);
      }),
    );
}
