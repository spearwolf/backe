/** `backe verify [--since rev] [--accept sha | --revert sha] [--reason text]` (backe.md §2.13, §2.24). */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { shortSha } from '../../core/ids.ts';
import { quarantineCommit } from '../../services/quarantine.ts';
import { assertVerified, type BacklogVerifyReport, verifyBacklog } from '../../services/verify.ts';
import {
  action,
  type CommandEnv,
  emit,
  emitNotices,
  type Runtime,
  subcommand,
  text,
} from '../options.ts';
import { json, lines, paint, renderHints, renderNotices, safeText } from '../output.ts';

type Opts = { since?: string; accept?: string; revert?: string; reason?: string };

/**
 * `geprüft: <n> Commits seit <anker kurz | --since>`, je ungültigem Commit
 * `<kurz> <subject>: <gründe; …>`, je Quarantäne `<kurz> <decision>: <note>`.
 */
function render(report: BacklogVerifyReport, since: string | undefined, color: boolean): string {
  return lines([
    safeText(`geprüft: ${report.checked} Commits seit ${since ?? shortSha(report.anchor)}`),
    ...report.invalid.map((f) =>
      paint(color, 'red', `${shortSha(f.sha)} ${f.subject}: ${f.reasons.join('; ')}`),
    ),
    ...report.quarantined.map((q) =>
      paint(color, 'yellow', `${shortSha(q.sha)} ${q.decision}: ${q.note}`),
    ),
  ]);
}

/** Bericht als JSON mit snake_case-Keys; `prop_notices` und `unknown_keys` fehlen, wenn leer. */
function verifyJson(report: BacklogVerifyReport): Record<string, unknown> {
  const { propNotices, unknownKeys, ...rest } = report;
  return {
    ...rest,
    ...(propNotices.length === 0 ? {} : { prop_notices: propNotices }),
    ...(unknownKeys.length === 0 ? {} : { unknown_keys: unknownKeys }),
  };
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
  // Fehlt die Begründung, passt der Aufruf nicht (`usage`); ist sie leer, prüft der Service
  // (`validation`).
  if (opts.reason === undefined) {
    throw new BackeError('usage', `${flag} braucht --reason mit einer Begründung`, {
      hint: `backe verify ${flag} <sha> --reason <text>`,
    });
  }
  const reason = (await text(opts.reason, env.io, env.stdin)).trim();
  const r = await quarantineCommit(await env.context(), { sha, decision, reason });
  env.committed(r.commit);
  const notices = r.notices.length === 0 ? undefined : r.notices;
  const warnings = r.verifyNotices.length === 0 ? undefined : r.verifyNotices;
  emit(env, { commit: r.commit ?? null, sha, decision, reason, notices, warnings }, () =>
    lines([safeText(`${shortSha(sha)} ${decision}: ${reason}`)]),
  );
  emitNotices(env, r.notices, r.verifyNotices);
}

export function verifyCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'verify', 'Signaturen und Rechte jedes Commits seit dem Anker prüfen')
    .option('--since <rev>', 'nur Commits nach <rev> prüfen')
    .option('--accept <sha>', 'ungültigen Commit als hingenommen in die Quarantäne eintragen')
    .option('--revert <sha>', 'ungültigen Commit umkehren und in die Quarantäne eintragen')
    .option('--reason <text>', 'Begründung für --accept/--revert (»-« liest stdin)')
    .action(
      action(
        rt,
        async (env, opts: Opts) => {
          if (opts.accept !== undefined || opts.revert !== undefined) return quarantine(env, opts);
          if (opts.reason !== undefined) {
            throw new BackeError('usage', '--reason gehört zu --accept oder --revert');
          }
          const report = await verifyBacklog(await env.context(), {
            ...(opts.since === undefined ? { record: true } : { since: opts.since }),
          });
          // Im JSON-Modus bleibt stdout bei einem Fehler leer; der Bericht steht in dessen Details.
          const reportJson = verifyJson(report);
          if (env.format === 'json') {
            if (report.invalid.length === 0) env.out(json(reportJson));
          } else {
            env.out(render(report, opts.since, env.color));
            const hints = [...report.notices, ...report.propNotices];
            if (hints.length > 0) env.io.stderr(renderHints(hints));
            const warnings = report.unknownKeys.map(
              (u) =>
                `${u.path}: unbekannte Keys ${u.keys.join(', ')} — eigene Daten gehören nach props`,
            );
            if (warnings.length > 0) env.io.stderr(renderNotices([], warnings));
          }
          assertVerified(report, reportJson);
        },
        { write: true },
      ),
    );
}
