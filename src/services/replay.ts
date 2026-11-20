/**
 * Semantisches Replay (backe.md §2.16.4): Die lokalen Commits werden zu Einheiten und auf einen
 * Remote-Stand neu angewendet — Operationen mit voller Prüfung, `manual`-Commits per
 * Dreiwege-Merge je Pfad. Jede Einheit mit Wirkung wird ein neuer, mit der eigenen Identität
 * signierter Commit, gebaut rein aus Git-Objekten: Arbeitsbaum, Index und Refs bleiben, wie sie
 * sind, und in die Konfliktablage schreibt erst der Aufrufer.
 */
import { BackeError } from '../core/errors.ts';
import { defaultRandomBytes } from '../core/ids.ts';
import type { Comment } from '../core/schemas.ts';
import { commitChanges } from '../git/commit-changes.ts';
import type { GitEnv } from '../git/exec.ts';
import {
  type CommitInfo,
  listCommits,
  objectInfo,
  readBlobs,
  removedHandles,
  treeChanges,
} from '../git/history.ts';
import { parseCommitMessage, TRAILER_ACTOR, TRAILER_OP } from '../git/message.ts';
import { gitTreeSource } from '../git/tree-source.ts';
import { type ApplyContext, applyOperation, commentsNeeded } from '../ops/apply.ts';
import { applyBatch } from '../ops/batch.ts';
import type { Notice } from '../ops/notice.ts';
import {
  decodeBatchBody,
  type Operation,
  parseOpTrailer,
  substituteIds,
} from '../ops/operation.ts';
import { isViolation, rewriteCollisions, taintKeys } from '../ops/replay.ts';
import type { FileChange } from '../store/files.ts';
import { attachmentsDir, GITATTRIBUTES, hasLfsRule, isLfsPath } from '../store/layout.ts';
import {
  type BacklogSnapshot,
  listCommentsFrom,
  loadSnapshotFrom,
  type StoredEntity,
} from '../store/snapshot.ts';
import { overlaySource, type TreeSource } from '../store/source.ts';
import { isoNow } from './env.ts';
import { type ManualResolver, manualChanges } from './manual-merge.ts';
import type { ConflictEntry, ConflictUnit } from './sync-state.ts';
import { loadStates, signatureCache, signatureReasons } from './verify-state.ts';
import { manualMessage, opMessage, touches } from './write.ts';

export type ReplayUnit = {
  sha: string;
  subject: string;
  kind: 'op' | 'batch' | 'manual';
  ops: Operation[];
};

export type { ManualConflictPath, ManualResolver } from './manual-merge.ts';

export type ReplayResult = {
  /** Der letzte gebaute Commit; ohne einen ist es `onto`. */
  head: string;
  /** Einheiten, die einen Commit ergaben. */
  replayed: number;
  /** Abgelegte Einheiten samt Folgeeinheiten; geschrieben werden sie erst vom Aufrufer. */
  conflicts: ConflictEntry[];
  /** Die Claim-Einheit scheiterte an einer Verletzung; sie geht nicht in die Konfliktablage. */
  claimLost?: { id: string; error: BackeError };
  /**
   * Der neu signierte Commit der Claim-Einheit; ohne Claim, ohne Wirkung oder bei `claimLost`
   * `undefined`. Eine weitere Runde erkennt den Claim nur an diesem SHA.
   */
  claimSha?: string;
  notices: Notice[];
};

export type ReplayInput = {
  onto: string;
  units: readonly ReplayUnit[];
  actor: string;
  key: string;
  author: { name: string; email: string };
  env: GitEnv;
  now: () => Date;
  randomBytes?: (n: number) => Uint8Array;
  /** Commit der Claim-Einheit (backe.md §2.16.5). */
  claimSha?: string;
  resolveManual?: ManualResolver;
};

const short = (sha: string) => sha.slice(0, 7);

// --- Einheiten lesen ------------------------------------------------------------------------

function foreign(sha: string): BackeError {
  return new BackeError('verify', `Lokaler Commit ${short(sha)} ist nicht von backe signiert`, {
    hint: 'backe commit --resign',
  });
}

/** Die Einheit aus der Message; `undefined`, wenn Akteur oder Operation nicht lesbar passen. */
function unitOf(commit: CommitInfo, handle: string): ReplayUnit | undefined {
  const { subject, body, trailers } = parseCommitMessage(commit.message);
  const actor = trailers.get(TRAILER_ACTOR) ?? [];
  const op = trailers.get(TRAILER_OP) ?? [];
  if (actor.length !== 1 || actor[0] !== handle || op.length !== 1) return undefined;
  try {
    const trailer = parseOpTrailer(op[0] as string);
    const base = { sha: commit.sha, subject };
    switch (trailer.kind) {
      case 'op':
        return { ...base, kind: 'op', ops: [trailer.op] };
      case 'manual':
        return { ...base, kind: 'manual', ops: [] };
      case 'batch': {
        const ops = decodeBatchBody(body ?? '');
        return ops.length === 0 ? undefined : { ...base, kind: 'batch', ops };
      }
      default:
        return undefined;
    }
  } catch (err) {
    if (err instanceof BackeError) return undefined;
    throw err;
  }
}

function isInitRoot(commit: CommitInfo): boolean {
  if (commit.parents.length > 0) return false;
  return parseCommitMessage(commit.message).trailers.get(TRAILER_OP)?.[0] === 'init';
}

/**
 * Die Commits `base..head` als Einheiten, älteste zuerst (ohne `base`: ab der Wurzel; der
 * `init`-Commit an der Wurzel ist nie eine Einheit). Jeder Commit muss ein backe-Commit von
 * `handle` sein: gültig signiert mit einem aktiven Key von `handle` im Users-Stand seines Parents,
 * `Backe-Actor` ist `handle`, `Backe-Op` lesbar. Sonst `verify`; ein Merge-Commit ebenso.
 */
export async function readUnits(
  wc: string,
  range: { base: string | undefined; head: string },
  handle: string,
): Promise<ReplayUnit[]> {
  const commits = (await listCommits(wc, { from: range.base, to: range.head })).filter(
    (c) => !isInitRoot(c),
  );
  const merge = commits.find((c) => c.parents.length > 1);
  if (merge !== undefined) {
    throw new BackeError('verify', `Lokaler Commit ${short(merge.sha)} ist ein Merge-Commit`);
  }
  const parents = [...new Set(commits.flatMap((c) => c.parents))];
  const states = await loadStates(wc, parents);
  const stateOf = (c: CommitInfo) =>
    c.parents[0] === undefined ? undefined : states.get(c.parents[0]);
  const sigs = signatureCache(wc);
  await sigs.prefetch(
    commits.flatMap((commit) => {
      const state = stateOf(commit);
      return state === undefined ? [] : [{ commit, state }];
    }),
  );
  const units: ReplayUnit[] = [];
  for (const commit of commits) {
    const state = stateOf(commit);
    const unit = unitOf(commit, handle);
    if (state === undefined || unit === undefined) throw foreign(commit.sha);
    const sig = await sigs.of(commit, state);
    const reasons = signatureReasons(sig, commit.gpgsig, state.users);
    if (reasons.length > 0 || sig?.principal !== handle) throw foreign(commit.sha);
    units.push(unit);
  }
  return units;
}

// --- Bausteine des Replays ------------------------------------------------------------------

/** Erster Parent von `sha`; beim Wurzel-Commit `undefined`. */
async function parentOf(wc: string, sha: string): Promise<string | undefined> {
  const spec = `${sha}^`;
  return (await objectInfo(wc, [spec])).get(spec)?.oid;
}

/** `<sha>:<pfad>` des Anhangs einer `attach.add` im Ursprungs-Commit, aus ihrer ursprünglichen ID. */
const attachmentSource = (sha: string, op: Extract<Operation, { op: 'attach.add' }>) =>
  `${sha}:${attachmentsDir(op.id)}/${op.file}`;

/**
 * `attach.add` ist ohne Inhalt aufgezeichnet (backe.md §2.8); er kommt als Blob unverändert aus dem
 * Ursprungs-Commit, unter dem Pfad aus der ursprünglichen ID — auch ein LFS-Pointer. Fehlt die
 * Datei dort, hat eine spätere Operation derselben Einheit sie wieder entfernt; dann zählt ihr
 * Inhalt nicht, und ein leerer steht für ihn.
 */
async function withAttachmentContent(wc: string, unit: ReplayUnit): Promise<Operation[]> {
  const spec = (op: Extract<Operation, { op: 'attach.add' }>) => attachmentSource(unit.sha, op);
  const wanted = unit.ops.flatMap((op) =>
    op.op === 'attach.add' && op.file !== undefined && op.content === undefined ? [spec(op)] : [],
  );
  if (wanted.length === 0) return [...unit.ops];
  const blobs = await readBlobs(wc, wanted);
  return unit.ops.map((op) =>
    op.op === 'attach.add' && op.file !== undefined && op.content === undefined
      ? { ...op, content: new Uint8Array(blobs.get(spec(op)) ?? []) }
      : op,
  );
}

/**
 * Führt die Einheit die LFS-Regel ein (backe.md §2.8), übernimmt der neue Commit jeden Anhang,
 * den der Ursprungs-Commit über seine Operationen hinaus als Pointer neu abgelegt hat — aber nur,
 * wenn der Blob im aktuellen Stand noch der aus dem Parent des Ursprungs-Commits ist.
 */
async function renormalized(
  wc: string,
  unit: ReplayUnit,
  head: string,
  before: BacklogSnapshot,
  changes: readonly FileChange[],
): Promise<FileChange[]> {
  const attributes = changes.findLast((c) => c.path === GITATTRIBUTES);
  if (attributes === undefined || hasLfsRule(before.attributes)) return [];
  if (attributes.content === null) return [];
  if (!hasLfsRule(Buffer.from(attributes.content).toString('utf8'))) return [];
  const parent = await parentOf(wc, unit.sha);
  if (parent === undefined) return [];
  const own = (await treeChanges(wc, parent, unit.sha))
    .map((c) => c.path)
    .filter((p) => isLfsPath(p) && !changes.some((c) => touches(c, p)));
  const info = await objectInfo(
    wc,
    own.flatMap((p) => [`${head}:${p}`, `${parent}:${p}`]),
  );
  const keep = own.filter((p) => {
    const current = info.get(`${head}:${p}`);
    return current !== undefined && current.oid === info.get(`${parent}:${p}`)?.oid;
  });
  const blobs = await readBlobs(
    wc,
    keep.map((p) => `${unit.sha}:${p}`),
  );
  return keep.flatMap((p) => {
    const content = blobs.get(`${unit.sha}:${p}`);
    return content == null ? [] : [{ path: p, content }];
  });
}

/** Kommentare, die die Operationen brauchen, aus dem aktuellen Stand. */
async function commentsFor(
  src: () => TreeSource,
  ops: readonly Operation[],
): Promise<Map<string, StoredEntity<Comment>[]>> {
  const comments = new Map<string, StoredEntity<Comment>[]>();
  for (const id of new Set(ops.flatMap(commentsNeeded))) {
    comments.set(id, await listCommentsFrom(src(), id));
  }
  return comments;
}

/** IDs, die die `issue.create`s der Operationen vergeben. */
const createdIds = (ops: readonly Operation[]) =>
  ops.flatMap((op) => (op.op === 'issue.create' && op.id !== undefined ? [op.id] : []));

/** Die Operation, wie sie in der Ablage steht: ohne den Inhalt eines Anhangs. */
function withoutContent(op: Operation): Operation {
  if (op.op !== 'attach.add') return op;
  const { content: _, ...rest } = op;
  return rest;
}

/**
 * Eine Einheit für die Ablage: `ops` mit den umgeschriebenen IDs, `sources` je `attach.add` mit
 * Datei die Herkunft ihres Inhalts aus den ursprünglichen Operationen (Index → `<sha>:<pfad>`).
 */
function conflictUnit(unit: ReplayUnit, ops: readonly Operation[]): ConflictUnit {
  const sources: Record<number, string> = {};
  for (const [i, op] of unit.ops.entries()) {
    if (op.op === 'attach.add' && op.file !== undefined)
      sources[i] = attachmentSource(unit.sha, op);
  }
  return {
    sha: unit.sha,
    subject: unit.subject,
    kind: unit.kind,
    ops: ops.map(withoutContent),
    ...(Object.keys(sources).length === 0 ? {} : { sources }),
  };
}

function reasonOf(err: BackeError): ConflictEntry['reason'] {
  const details = err.details as { reason: string; ids?: unknown };
  const ids = Array.isArray(details.ids) ? (details.ids as string[]) : undefined;
  return {
    code: err.code,
    message: err.message,
    reason: details.reason,
    ...(ids === undefined ? {} : { ids }),
  };
}

// --- Replay ---------------------------------------------------------------------------------

/**
 * Wendet `units` der Reihe nach auf `onto` an (backe.md §2.16.4) und baut je Einheit mit Wirkung
 * einen neuen signierten Commit. `op`/`batch`: Kollisionen umschreiben, dann voll geprüft
 * anwenden; eine Verletzung legt die Einheit samt ihrer Folgeeinheiten ab (die Claim-Einheit
 * endet stattdessen als `claimLost` und wird ohne Folgeprüfung versucht). `manual`: Dreiwege je
 * Pfad. Jeder andere Fehler bricht ab; dann ist nichts geschehen außer losen Git-Objekten.
 */
export async function replayOnto(wc: string, input: ReplayInput): Promise<ReplayResult> {
  const now = isoNow(input.now());
  const random = input.randomBytes ?? defaultRandomBytes;
  let head = input.onto;
  let base = await gitTreeSource(wc, head);
  let pending: FileChange[] = [];
  let snapshot = await loadSnapshotFrom(base, `Commit ${short(head)}`);
  const ids = new Map<string, string>();
  const tainted = new Map<string, ConflictEntry>();
  const conflicts: ConflictEntry[] = [];
  const notices: Notice[] = [];
  let replayed = 0;
  let claimLost: ReplayResult['claimLost'];
  let claimSha: string | undefined;

  const commit = async (changes: readonly FileChange[], message: string) => {
    const { key, author, env } = input;
    head = await commitChanges(wc, { parent: head, changes, message, key, author, env });
    replayed++;
  };
  const taint = (entry: ConflictEntry, ops: readonly Operation[]) => {
    for (const k of taintKeys(ops, createdIds(ops))) if (!tainted.has(k)) tainted.set(k, entry);
  };
  /** `<YYYYMMDDTHHMMSSZ>-<6 hex>`; ist die ID in dieser Runde schon vergeben, zählt sie weiter. */
  const entryId = () => {
    const stamp = now.replace(/[-:]/g, '');
    let n = Buffer.from(random(3)).readUIntBE(0, 3);
    const idOf = () => `${stamp}-${n.toString(16).padStart(6, '0')}`;
    while (conflicts.some((e) => e.id === idOf())) n = (n + 1) % 0x1000000;
    return idOf();
  };

  for (const unit of input.units) {
    if (unit.kind === 'manual') {
      const parent = await parentOf(wc, unit.sha);
      const changes = await manualChanges(wc, { ...unit, parent }, head, input.resolveManual);
      if (changes.length === 0) continue;
      await commit(changes, manualMessage(unit.subject, input.actor));
      base = await gitTreeSource(wc, head);
      pending = [];
      snapshot = await loadSnapshotFrom(base, `Commit ${short(head)}`);
      continue;
    }
    const isClaim = unit.sha === input.claimSha;
    if (!isClaim) {
      const named = unit.ops.map((op) => substituteIds(op, ids));
      const followed = taintKeys(named, createdIds(named))
        .map((k) => tainted.get(k))
        .find((e) => e !== undefined);
      if (followed !== undefined) {
        followed.units.push(conflictUnit(unit, named));
        taint(followed, named);
        continue;
      }
    }
    const rewrite = rewriteCollisions(snapshot, await withAttachmentContent(wc, unit), ids, {
      randomBytes: random,
    });
    const { ops } = rewrite;
    const ctx: ApplyContext = {
      actor: input.actor,
      now,
      randomBytes: random,
      comments: await commentsFor(() => overlaySource(base, pending), ops),
      removedHandles: ops.some((op) => op.op === 'user.add')
        ? await removedHandles(wc, head)
        : undefined,
    };
    let applied: { snapshot: BacklogSnapshot; changes: FileChange[]; recorded: Operation[] };
    try {
      if (unit.kind === 'batch') {
        applied = applyBatch(snapshot, ops, ctx);
      } else {
        const r = applyOperation(snapshot, ops[0] as Operation, ctx);
        applied = { ...r, recorded: [r.recorded] };
      }
    } catch (err) {
      if (!isViolation(err)) throw err;
      if (isClaim) {
        const claim = ops.find((op) => op.op === 'issue.claim');
        if (claim === undefined) {
          throw new BackeError(
            'unexpected',
            `Claim-Einheit ${short(unit.sha)} enthält kein issue.claim`,
          );
        }
        claimLost = { id: claim.id, error: err };
        continue;
      }
      const entry: ConflictEntry = {
        version: 1,
        id: entryId(),
        created: now,
        onto: input.onto,
        reason: reasonOf(err),
        units: [conflictUnit(unit, ops)],
      };
      conflicts.push(entry);
      taint(entry, ops);
      continue;
    }
    // Umbenennungen einer abgelegten Einheit stehen in ihren Ops, nicht in den Hinweisen.
    notices.push(...rewrite.notices);
    if (applied.changes.length === 0) continue;
    const extra = await renormalized(wc, unit, head, snapshot, applied.changes);
    const changes = [...applied.changes, ...extra];
    await commit(changes, opMessage(unit.kind, applied.recorded, input.actor));
    if (isClaim) claimSha = head;
    pending = [...pending, ...changes];
    snapshot = applied.snapshot;
  }
  return {
    head,
    replayed,
    conflicts,
    ...(claimLost === undefined ? {} : { claimLost }),
    ...(claimSha === undefined ? {} : { claimSha }),
    notices,
  };
}
