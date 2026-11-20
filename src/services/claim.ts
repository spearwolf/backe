/**
 * Der synchrone Claim (backe.md §2.16.5): `issue claim` und `next --claim` sind die einzigen
 * Writes, die aufs Netz warten. Erst eine blockierende Sync-Runde, dann der Claim als gewöhnlicher
 * Write gegen den frischen Stand, dann eine Runde, die ihn als letzten Commit pusht. Geht er dabei
 * an einen Schnelleren verloren, fällt nur er weg; die übrigen lokalen Commits bleiben. Alles drei
 * läuft unter einem `sync.lock`, damit kein Hintergrund-Sync den Claim dazwischen ohne
 * Claim-Kennung replayt.
 */
import { join } from 'node:path';
import { withFileLock } from '../context/lock.ts';
import { exists } from '../context/paths.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { readLocalState } from '../git/local-state.ts';
import { gitTreeSource } from '../git/tree-source.ts';
import type { Notice } from '../ops/notice.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { type BacklogSnapshot, loadSnapshot, loadSnapshotFrom } from '../store/snapshot.ts';
import { type NextOutcome, type NextQuery, nextActor, pickNext } from './next.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { resolveIssueRef } from './read.ts';
import { scheduleDeferred } from './schedule.ts';
import { effectiveMode, type SyncDeps, syncHeld, syncRemote } from './sync.ts';
import { syncFile } from './sync-state.ts';
import { ensureWorkingCopy, hubNotices } from './working-copy.ts';
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

type Setup = {
  wc: string;
  handle: string;
  local?: 'no_remote' | 'manual';
  /** Warnungen eines frischen Klons (Gründe ungültiger Commits im Modus `warn`). */
  warnings: string[];
  /** Hinweis auf einen dabei neu angelegten Hub. */
  notices: Notice[];
};

/**
 * Arbeitskopie (bei Bedarf geklont) und ob der Claim nur lokal geht: ohne Git-Remote
 * `sync.remote` oder im wirksamen Modus `manual`. Warnungen und Hinweise eines frischen Klons
 * kommen mit.
 */
async function claimSetup(ctx: ResolvedContext): Promise<Setup> {
  const { handle, workingCopy } = requireWriter(ctx);
  const cloned = (await exists(join(workingCopy, BACKLOG_CONFIG)))
    ? undefined
    : await ensureWorkingCopy(ctx, handle);
  const wc = cloned?.root ?? workingCopy;
  const base = { wc, handle, warnings: cloned?.notices ?? [], notices: hubNotices(cloned?.hub) };
  const config = await requireHeadConfig(wc);
  if ((await syncRemote(wc, config.sync.remote)) === undefined) {
    return { ...base, local: 'no_remote' };
  }
  if (effectiveMode(ctx, config) === 'manual') return { ...base, local: 'manual' };
  return base;
}

/** Das Issue im zuletzt bekannten Remote-Stand (`upstream`); ohne ihn oder ohne Issue `undefined`. */
async function remoteIssue(wc: string, id: string) {
  const upstream = await readLocalState(wc, 'upstream');
  if (upstream === undefined) return undefined;
  const s = await loadSnapshotFrom(await gitTreeSource(wc, upstream), `Commit ${upstream}`);
  return s.issues.get(id)?.data;
}

/**
 * Der Fehler eines verlorenen Claims (Exit 4): `<id> wurde inzwischen von <assignee> übernommen`,
 * wenn auf dem Remote jetzt jemand anderes das Issue hat, sonst `fallback`.
 */
async function lostClaim(
  wc: string,
  handle: string,
  id: string,
  fallback: string,
): Promise<BackeError> {
  const assignee = (await remoteIssue(wc, id))?.assignee;
  const taken = assignee !== undefined && assignee !== handle;
  return new BackeError(
    'conflict',
    taken ? `${id} wurde inzwischen von ${assignee} übernommen` : fallback,
    { details: { reason: CLAIM_LOST, id, ...(taken ? { assignee } : {}) } },
  );
}

/**
 * Hat die Push-Runde den Claim weder gepusht noch als verloren gemeldet, lag er schon auf dem
 * Remote. Das Netz dahinter: Der Remote-Stand muss das Issue `in_progress` mit mir zeigen.
 */
async function assertClaimed(wc: string, handle: string, id: string): Promise<void> {
  const issue = await remoteIssue(wc, id);
  if (issue?.state === 'in_progress' && issue.assignee === handle) return;
  throw await lostClaim(wc, handle, id, `Claim ${id} ist nicht auf dem Remote angekommen`);
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
  const claim = (s: BacklogSnapshot, actor: string) => ({
    op: 'issue.claim' as const,
    id: select(s, actor),
  });
  if (setup.local !== undefined) {
    const written = await writeOp(ctx, claim, deps);
    const notice: Notice = {
      code: 'claim_local',
      message: LOCAL_NOTICE[setup.local],
      ids: [written.id as string],
    };
    const warnings = [...setup.warnings, ...written.warnings];
    const notices = [...setup.notices, ...written.notices, notice];
    return { ...written, warnings, local: setup.local, notices };
  }
  // Reihenfolge der Locks wie beim Hintergrund-Sync: `sync.lock`, darin kurz der Write-Lock.
  try {
    return await claimHeld(ctx, setup, claim, deps);
  } finally {
    // Ein Hintergrund-Lauf, der währenddessen nur `sync.dirty` setzen konnte, startet jetzt.
    await scheduleDeferred(ctx, setup.wc, deps);
  }
}

/** Der Claim mit Remote: blockierende Runde, Write und Push-Runde unter einem `sync.lock`. */
async function claimHeld(
  ctx: ResolvedContext,
  setup: Setup,
  claim: (s: BacklogSnapshot, actor: string) => { op: 'issue.claim'; id: string },
  deps: ClaimDeps,
): Promise<ClaimOutcome> {
  return withFileLock(
    await syncFile(setup.wc, 'sync.lock'),
    async () => {
      // Ein Fehler der blockierenden Runde (etwa kein Netz) lässt den Claim ganz ausfallen.
      const warnings = [...setup.warnings, ...(await syncHeld(ctx, deps)).notices];
      const written = await writeOp(ctx, claim, deps);
      const out: ClaimOutcome = {
        ...written,
        notices: [...setup.notices, ...written.notices],
        warnings: [...warnings, ...written.warnings],
      };
      // Schon `in_progress` mit mir: unverändert, und es gibt nichts zu pushen.
      if (written.commit === undefined) return out;
      const id = written.id as string;
      const round = await syncHeld(ctx, deps, { claimSha: written.commit });
      if (round.claimLost !== undefined) {
        throw await lostClaim(setup.wc, setup.handle, id, round.claimLost.error.message);
      }
      out.warnings.push(...round.notices);
      if (round.pushed === undefined) await assertClaimed(setup.wc, setup.handle, id);
      // Nach einem Replay trägt der Claim einen neuen SHA.
      return {
        ...out,
        commit: round.claimSha ?? written.commit,
        ...(round.pushed === undefined ? {} : { pushed: round.pushed }),
      };
    },
    deps.lock,
  );
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
 * höchstens fünfmal. `attempts` nennt alle versuchten Issues, das geclaimte zuletzt; `issue` steht
 * im Stand nach dem Claim.
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
      // Gewählt wurde vor dem Claim; ausgegeben wird das Issue, wie es jetzt dasteht.
      const now = await loadSnapshot(requireWriter(ctx).workingCopy);
      const issue = now.issues.get(next.issue.id)?.data as NextOutcome['issue'];
      return { ...next, issue, claim, attempts };
    } catch (err) {
      if (picked.next === undefined || !isLost(err)) throw err;
      attempts.push(picked.next.issue.id);
    }
  }
  throw new BackeError('conflict', `Claim fünfmal verloren: ${attempts.join(', ')}`, {
    details: { reason: CLAIM_LOST, ids: attempts },
  });
}
