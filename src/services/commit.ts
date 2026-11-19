/**
 * `backe commit` (backe.md §2.13 »Hand-Edits«): macht aus den Änderungen der Arbeitskopie Commits.
 * Das Übersetzen, Prüfen und Schreiben besorgt `executeWrite` (`kind: 'edits'`); hier entstehen
 * Ergebnis und Hinweise für die Ausgabe.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { requireWriter } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import type { Notice } from '../ops/notice.ts';
import type { Operation } from '../ops/operation.ts';
import type { Rewritten } from './hand-edits.ts';
import type { UnknownKeys } from './verify.ts';
import { type ChainEntry, executeWrite, type WriteDeps } from './write.ts';

export type CommitOutcome = {
  commits: {
    commit: string;
    kind: ChainEntry['kind'];
    /** Subject des Commits. */
    summary: string;
    recorded: Operation[];
    paths: string[];
  }[];
  /** Hinweise der Operationen. */
  notices: Notice[];
  /** Hand-Edits, die nicht so committet wurden, wie sie dastanden. */
  rewritten: Rewritten[];
  /** `-m` ohne `manual`-Anteil, nicht angeglichene Arbeitskopie, Verify-Gründe eines frischen Klons. */
  warnings: string[];
  /** Hand-Edits mit Keys, die das Schema nicht kennt (wie bei `verify`). */
  unknownKeys: UnknownKeys[];
};

async function subjectOf(wc: string, commit: string): Promise<string> {
  const { stdout } = await git(['log', '-1', '--format=%s', '--end-of-options', commit], {
    cwd: wc,
  });
  return stdout.replace(/\n+$/, '');
}

export async function commitEdits(
  ctx: ResolvedContext,
  input: { message?: string },
  deps?: WriteDeps,
): Promise<CommitOutcome> {
  const r = await executeWrite(
    ctx,
    { kind: 'edits', ...(input.message === undefined ? {} : { subject: input.message }) },
    deps,
  );
  const wc = requireWriter(ctx).workingCopy;
  const commits: CommitOutcome['commits'] = [];
  for (const entry of r.chain) {
    commits.push({
      commit: entry.commit,
      kind: entry.kind,
      summary: await subjectOf(wc, entry.commit),
      recorded: entry.recorded,
      paths: entry.paths,
    });
  }
  const warnings = [...r.verifyNotices];
  if (r.unsettled !== undefined) {
    warnings.push(
      `Arbeitskopie nicht angeglichen (${r.unsettled.paths.join(', ')}): ${r.unsettled.reason}`,
    );
  }
  if (
    input.message !== undefined &&
    r.chain.length > 0 &&
    !r.chain.some((c) => c.kind === 'manual')
  ) {
    warnings.push('-m gilt nur für manuelle Änderungen');
  }
  return {
    commits,
    notices: r.notices,
    rewritten: r.rewritten,
    warnings,
    unknownKeys: r.warnings.map((w) => ({ path: w.path, keys: w.unknownKeys })),
  };
}
