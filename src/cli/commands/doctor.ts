/** `backe doctor [--fix]` (backe.md §2.20). */
import type { Command } from 'commander';
import { type DoctorCheck, doctorFailure, runDoctor } from '../../services/doctor.ts';
import { action, emit, type Runtime, subcommand } from '../options.ts';
import { lines, safeText } from '../output.ts';

function checkLines(checks: readonly DoctorCheck[]): string[] {
  const out = checks.map((c) => safeText(`${c.status}  ${c.id}  ${c.detail}`));
  const hints = checks
    .filter((c) => c.status !== 'ok' && c.hint !== undefined)
    .map((c) => safeText(`  → ${c.hint}`));
  return [...out, ...hints];
}

export function doctorCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'doctor', 'Umgebung, Arbeitskopien und Backlog prüfen')
    .option('--fix', 'Temp-Reste entfernen')
    .action(
      action(
        rt,
        async (env, opts: { fix?: boolean }) => {
          let ctx: Awaited<ReturnType<typeof env.context>> | undefined;
          let contextError: string | undefined;
          try {
            ctx = await env.context();
          } catch (error) {
            contextError = error instanceof Error ? error.message : String(error);
          }
          const checks = await runDoctor({
            env: env.io.env,
            cwd: env.io.cwd,
            ...(ctx === undefined ? {} : { ctx }),
            ...(contextError === undefined ? {} : { contextError }),
            ...(opts.fix === true ? { fix: true } : {}),
          });
          emit(
            env,
            {
              checks: checks.map(({ id, status, detail, hint }) => ({ id, status, detail, hint })),
            },
            () => lines(checkLines(checks)),
          );
          const failure = doctorFailure(checks);
          if (failure !== undefined) throw failure;
        },
        { lenientConfig: true },
      ),
    );
}
