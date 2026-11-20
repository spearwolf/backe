/**
 * Der synchrone Claim (backe.md §2.16.5): `issue claim` und `next --claim` sind die einzigen
 * Writes, die aufs Netz warten. Erst eine blockierende Sync-Runde, dann der Claim als gewöhnlicher
 * Write gegen den frischen Stand, dann eine Runde, die ihn als letzten Commit pusht. Geht er dabei
 * an einen Schnelleren verloren, fällt nur er weg; die übrigen lokalen Commits bleiben.
 */
import { join } from 'node:path';
import { exists } from '../context/paths.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Notice } from '../ops/notice.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { type BacklogSnapshot, loadSnapshot } from '../store/snapshot.ts';
import { type NextOutcome, type NextQuery, nextActor, pickNext } from './next.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { resolveIssueRef } from './read.ts';
import { effectiveMode, type SyncDeps, type SyncOutcome, syncNow, syncRemote } from './sync.ts';
import { ensureWorkingCopy } from './working-copy.ts';
import { requireHeadConfig, type WriteDeps } from './write.ts';

export type ClaimOutcome = WriteOutcome & { local?: 'no_remote' | 'manual'; pushed?: string };

type ClaimDeps = SyncDeps & WriteDeps;

/** Versuche von `next --claim`, bis es aufgibt. */
const MAX_ATTEMPTS = 5;

const LOCAL_NOTICE = {
  no_remote: 'Claim nur lokal: kein Remote',
  manual: 'Claim nur lokal: sync.mode manual',
} as const;

/** Grund in `details.reason`, wenn ein Claim beim Push an einen Schnelleren verloren ging. */
const CLAIM_LOST = 'claim_lost';

/**
 * Arbeitskopie (bei Bedarf geklont) und ob der Claim nur lokal geht: ohne Git-Remote
 * `sync.remote` oder im wirksamen Modus `manual`. Die Hinweise eines frischen Klons kommen mit.
 */
async function claimSetup(
  ctx: ResolvedContext,
): Promise<{ wc: string; handle: string; local?: 'no_remote' | 'manual'; warnings: string[] }> {
  const { handle, workingCopy } = requireWriter(ctx);
  const cloned = (await exists(join(workingCopy, BACKLOG_CONFIG)))
    ? undefined
    : await ensureWorkingCopy(ctx, handle);
  const wc = cloned?.root ?? workingCopy;
  const warnings = cloned?.notices ?? [];
  const config = await requireHeadConfig(wc);
  if ((await syncRemote(wc, config.sync.remote)) === undefined) {
    return { wc, handle, local: 'no_remote', warnings };
  }
  if (effectiveMode(ctx, config) === 'manual') return { wc, handle, local: 'manual', warnings };
  return { wc, handle, warnings };
}

/**
 * Der Fehler eines verlorenen Claims (Exit 4): `<id> wurde inzwischen von <assignee> übernommen`,
 * wenn jetzt jemand anderes das Issue hat, sonst die Meldung der Verletzung.
 */
async function lostClaim(
  wc: string,
  handle: string,
  lost: NonNullable<SyncOutcome['claimLost']>,
): Promise<BackeError> {
  // Der Stand nach der Runde: der Remote-Stand samt der übrigen lokalen Commits.
  const assignee = (await loadSnapshot(wc)).issues.get(lost.id)?.data.assignee;
  const taken = assignee !== undefined && assignee !== handle;
  return new BackeError(
    'conflict',
    taken ? `${lost.id} wurde inzwischen von ${assignee} übernommen` : lost.error.message,
    { details: { reason: CLAIM_LOST, id: lost.id, ...(taken ? { assignee } : {}) } },
  );
}

/**
 * Ein Claim nach backe.md §2.16.5; `select` wählt das Issue unter dem Write-Lock auf dem Stand
 * nach der blockierenden Runde. Nur lokal (kein Remote, `manual`): nur der Write samt Hinweis.
 */
async function claimWith(
  ctx: ResolvedContext,
  select: (s: BacklogSnapshot, actor: string) => string,
  deps: ClaimDeps,
): Promise<ClaimOutcome> {
  const setup = await claimSetup(ctx);
  const warnings = [...setup.warnings];
  // Ein Fehler der blockierenden Runde (etwa kein Netz) lässt den Claim ganz ausfallen.
  if (setup.local === undefined) warnings.push(...(await syncNow(ctx, deps)).notices);
  const written = await writeOp(
    ctx,
    (s, actor) => ({ op: 'issue.claim', id: select(s, actor) }),
    deps,
  );
  const out: ClaimOutcome = { ...written, warnings: [...warnings, ...written.warnings] };
  if (setup.local !== undefined) {
    const notice: Notice = {
      code: 'claim_local',
      message: LOCAL_NOTICE[setup.local],
      ids: [written.id as string],
    };
    return { ...out, local: setup.local, notices: [...out.notices, notice] };
  }
  // Schon `in_progress` mit mir: unverändert, und es gibt nichts zu pushen.
  if (written.commit === undefined) return out;
  const pushed = await syncNow(ctx, deps, { claimSha: written.commit });
  if (pushed.claimLost !== undefined)
    throw await lostClaim(setup.wc, setup.handle, pushed.claimLost);
  out.warnings.push(...pushed.notices);
  if (pushed.pushed === undefined) return out;
  // Der Claim ist der letzte lokale Commit; nach einem Replay trägt er einen neuen SHA.
  return { ...out, commit: pushed.pushed, pushed: pushed.pushed };
}

/**
 * `backe issue claim <ref>` (backe.md §2.16.5): blockierende Sync-Runde, `issue.claim` gegen den
 * frischen Stand (nicht claimbar → Exit 4; schon `in_progress` mit mir → unverändert, ohne Push),
 * Push mit dem Claim zuletzt. Hat ihn inzwischen jemand anderes → `conflict`.
 */
export async function claimIssue(
  ctx: ResolvedContext,
  ref: string,
  deps: ClaimDeps = {},
): Promise<ClaimOutcome> {
  return claimWith(ctx, (s) => resolveIssueRef(s, ref), deps);
}

function isLost(err: unknown): boolean {
  const details = err instanceof BackeError ? err.details : undefined;
  return (details as { reason?: unknown } | undefined)?.reason === CLAIM_LOST;
}

/**
 * `backe next --claim` (backe.md §2.16.5): Auswahl wie `next`, aber auf dem Stand nach der
 * blockierenden Runde; geht der Claim verloren, wird ohne die verlorenen Kandidaten neu gewählt,
 * höchstens fünfmal. `attempts` nennt alle versuchten Issues, das geclaimte zuletzt.
 */
export async function nextClaim(
  ctx: ResolvedContext,
  q: NextQuery,
  deps: ClaimDeps = {},
): Promise<NextOutcome & { claim: ClaimOutcome; attempts: string[] }> {
  nextActor(ctx);
  const attempts: string[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const picked: { next?: NextOutcome } = {};
    const select = (s: BacklogSnapshot, actor: string) => {
      picked.next = pickNext(ctx, s, actor, { ...q, exclude: [...(q.exclude ?? []), ...attempts] });
      return picked.next.issue.id;
    };
    try {
      const claim = await claimWith(ctx, select, deps);
      const next = picked.next as NextOutcome;
      attempts.push(next.issue.id);
      return { ...next, claim, attempts };
    } catch (err) {
      if (picked.next === undefined || !isLost(err)) throw err;
      attempts.push(picked.next.issue.id);
    }
  }
  throw new BackeError('conflict', `Claim fünfmal verloren: ${attempts.join(', ')}`, {
    details: { reason: CLAIM_LOST, ids: attempts },
  });
}
