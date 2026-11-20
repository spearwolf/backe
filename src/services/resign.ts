/**
 * `backe commit --resign` (backe.md §2.13 »Hand-Edits«): Lokale, noch nicht gepushte Commits, die
 * keine gültigen backe-Commits der eigenen Identität sind (etwa nacktes `git commit`), werden
 * nachträglich übersetzt und neu signiert. Die Kette entsteht rein aus Git-Objekten; die
 * Arbeitskopie springt danach einmal per `reset --keep`, unter dem Write-Lock.
 */
import { join } from 'node:path';
import { exists } from '../context/paths.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { defaultRandomBytes } from '../core/ids.ts';
import type { Comment, User } from '../core/schemas.ts';
import { commitChanges } from '../git/commit-changes.ts';
import {
  type CommitInfo,
  listCommits,
  mergeBase,
  readBlobs,
  removedHandles,
  treeChanges,
} from '../git/history.ts';
import { readLocalState } from '../git/local-state.ts';
import { parseCommitMessage, TRAILER_OP } from '../git/message.ts';
import { assertOnBranch } from '../git/repo.ts';
import { changedEntries } from '../git/status.ts';
import { gitTreeSource } from '../git/tree-source.ts';
import { type ApplyContext, assertActorIsUser, commentsNeeded } from '../ops/apply.ts';
import { applyBatch } from '../ops/batch.ts';
import type { Operation } from '../ops/operation.ts';
import { translateEdits } from '../ops/translate.ts';
import type { FileChange } from '../store/files.ts';
import { BACKLOG_CONFIG, classifyPath } from '../store/layout.ts';
import {
  type BacklogSnapshot,
  listCommentsFrom,
  loadSnapshotFrom,
  type StoredEntity,
} from '../store/snapshot.ts';
import { authorOf, isoNow } from './env.ts';
import { canonicalEdit } from './hand-edits.ts';
import { type LocalCommit, localCommits, type ReplayUnit, replayOnto } from './replay.ts';
import { resetKeep, underWriteLock } from './sync.ts';
import { verifyRange } from './verify.ts';
import {
  type ChainEntry,
  manualMessage,
  opMessage,
  requireHeadConfig,
  type WriteDeps,
} from './write.ts';

export type ResignOutcome = {
  /** Die neu gebauten Commits ab dem ersten fremden, älteste zuerst. */
  commits: { commit: string; kind: ChainEntry['kind']; summary: string }[];
  /** Wie viele fremde Commits übersetzt wurden; `0` heißt: nichts neu zu signieren. */
  rewritten: number;
};

const short = (sha: string) => sha.slice(0, 7);

/** Wie `git` den Modus einer regulären Datei schreibt; `000000` steht für »gelöscht«. */
const REGULAR = new Set(['000000', '100644', '100755']);

const ENTITY_KINDS: ReadonlySet<string> = new Set([
  'issue',
  'comment',
  'user',
  'project',
  'sprint',
  'repo',
]);

/**
 * Bytes als Text für `translateEdits` wie bei Hand-Edits: Entitätsdateien als UTF-8, alle anderen
 * Dateien latin1 (eins zu eins, nur auf Gleichheit verglichen).
 */
function asText(path: string, b: Buffer | null): string | null {
  if (b === null) return null;
  return b.toString(ENTITY_KINDS.has(classifyPath(path).kind) ? 'utf8' : 'latin1');
}

const sameBytes = (a: string | Uint8Array | null, b: Buffer | null) =>
  a === null || b === null ? a === b : b.equals(Buffer.from(a));

/** Was der Bau der neuen Kette braucht. */
type Build = {
  wc: string;
  handle: string;
  key: string;
  author: { name: string; email: string };
  ctx: ResolvedContext;
  now: string;
  randomBytes: (n: number) => Uint8Array;
};

async function snapshotOf(wc: string, rev: string): Promise<BacklogSnapshot> {
  return loadSnapshotFrom(await gitTreeSource(wc, rev), `Commit ${short(rev)}`);
}

/** Kommentare, die die Operationen brauchen, im Stand `rev`. */
async function commentsAt(
  wc: string,
  rev: string,
  ops: readonly Operation[],
): Promise<Map<string, StoredEntity<Comment>[]>> {
  const src = await gitTreeSource(wc, rev);
  const out = new Map<string, StoredEntity<Comment>[]>();
  for (const id of new Set(ops.flatMap(commentsNeeded))) {
    out.set(id, await listCommentsFrom(src, id));
  }
  return out;
}

/** Ein Fehler beim Übersetzen eines fremden Commits nennt den Commit vor seiner Meldung. */
function inCommit(sha: string, err: unknown): unknown {
  if (err instanceof BackeError) err.message = `Commit ${short(sha)}: ${err.message}`;
  return err;
}

/**
 * Übersetzt einen fremden Commit auf `current` wie `backe commit` seine Hand-Edits: die Änderungen
 * gegenüber seinem Parent per `translateEdits` gegen den Snapshot dieses Parents, dann zuerst der
 * `manual`-Anteil (kanonisch, ohne Pfade, die in `current` schon so stehen), dann die Operationen
 * als ein Commit gegen den Stand danach. Liefert den neuen Kopf.
 */
async function translateCommit(b: Build, c: CommitInfo, current: string): Promise<string> {
  const { wc, handle } = b;
  // Lokale Commits liegen über der Basis, nie an der Wurzel (`localCommits` lässt `init` aus).
  const parent = c.parents[0] as string;
  const raw = await treeChanges(wc, parent, c.sha);
  const odd = raw.find((r) => !REGULAR.has(r.newMode));
  if (odd !== undefined) {
    throw new BackeError(
      'validation',
      `Commit ${short(c.sha)}: ${odd.path} ist keine reguläre Datei`,
    );
  }
  const paths = raw.map((r) => r.path);
  const blobs = await readBlobs(
    wc,
    paths.flatMap((p) => [`${parent}:${p}`, `${c.sha}:${p}`, `${current}:${p}`]),
  );
  const at = (rev: string, p: string) => blobs.get(`${rev}:${p}`) ?? null;
  let head = current;
  try {
    const translated = translateEdits(
      await snapshotOf(wc, parent),
      paths.map((p) => ({
        path: p,
        before: asText(p, at(parent, p)),
        after: asText(p, at(c.sha, p)),
      })),
      { actor: handle },
    );
    const manual: FileChange[] = [];
    for (const path of translated.manual) {
      const content = canonicalEdit(path, at(c.sha, path));
      if (!sameBytes(content, at(current, path))) manual.push({ path, content });
    }
    if (manual.length > 0) {
      const subject = parseCommitMessage(c.message).subject.trim();
      const message = manualMessage(
        subject === '' ? `manual: ${manual.length} Dateien` : subject,
        handle,
      );
      head = await commitChanges(wc, { parent: head, changes: manual, message, ...signing(b) });
    }
    const { ops } = translated;
    if (ops.length === 0) return head;
    const applyCtx: ApplyContext = {
      actor: handle,
      now: b.now,
      randomBytes: b.randomBytes,
      comments: await commentsAt(wc, head, ops),
      removedHandles: ops.some((op) => op.op === 'user.add')
        ? await removedHandles(wc, head)
        : undefined,
    };
    const r = applyBatch(await snapshotOf(wc, head), ops, applyCtx);
    if (r.changes.length === 0) return head;
    const message = opMessage(r.recorded.length === 1 ? 'op' : 'batch', r.recorded, handle);
    return await commitChanges(wc, { parent: head, changes: r.changes, message, ...signing(b) });
  } catch (err) {
    throw inCommit(c.sha, err);
  }
}

const signing = (b: Build) => ({ key: b.key, author: b.author, env: b.ctx.env });

/**
 * Ein gültiger backe-Commit nach einem übersetzten: als Einheit wie im Replay auf `current`.
 * Lässt er sich dort nicht mehr anwenden, bricht `--resign` ab; nichts ist geschehen.
 */
async function replayCommit(b: Build, unit: ReplayUnit, current: string): Promise<string> {
  const r = await replayOnto(b.wc, {
    onto: current,
    units: [unit],
    actor: b.handle,
    key: b.key,
    author: b.author,
    env: b.ctx.env,
    now: () => new Date(b.now),
    randomBytes: b.randomBytes,
  });
  const [conflict] = r.conflicts;
  if (conflict !== undefined) {
    throw new BackeError(
      'conflict',
      `Lokaler Commit ${short(unit.sha)} lässt sich nach dem Neusignieren nicht mehr anwenden: ${conflict.reason.message}`,
    );
  }
  return r.head;
}

/**
 * Wogegen lokale Commits zählen: `upstream`, ohne ihn `verified`, ohne den der Anker — eins davon
 * hat jede Arbeitskopie seit `init` bzw. `clone`.
 */
async function localBase(wc: string): Promise<string> {
  for (const name of ['upstream', 'verified'] as const) {
    const ref = await readLocalState(wc, name);
    if (ref !== undefined) return ref;
  }
  const anchor = await readLocalState(wc, 'anchor');
  if (anchor === undefined) throw new BackeError('verify', `Kein Vertrauensanker in ${wc}`);
  return anchor;
}

const kindOf = (message: string): ChainEntry['kind'] => {
  const op = parseCommitMessage(message).trailers.get(TRAILER_OP)?.[0];
  return op === 'manual' ? 'manual' : op === 'batch' ? 'batch' : 'op';
};

/**
 * `backe commit --resign` (backe.md §2.13): Lokale Commits sind `upstream..HEAD` (ohne
 * `upstream`: ab `verified`, ohne den: ab dem Anker). Gebaut wird auf ihrer Basis im eigenen
 * Verlauf — dem gemeinsamen Vorfahren mit `upstream` —, damit `--resign` keinen Remote-Stand
 * einarbeitet; das bleibt Sache des nächsten Syncs. Die gültigen Commits vor dem ersten fremden
 * bleiben, wie sie sind; jeder fremde wird übersetzt (`translateCommit`), jeder gültige danach als
 * Einheit wie im Replay neu signiert. Die neue Kette muss `verify` bestehen, sonst `validation`.
 * Mit Hand-Edits im Arbeitsbaum → `usage`; nichts Fremdes → `rewritten: 0`, nichts geändert.
 */
export async function resignCommits(
  ctx: ResolvedContext,
  deps: WriteDeps = {},
): Promise<ResignOutcome> {
  const { handle, key, workingCopy: wc } = requireWriter(ctx);
  const none: ResignOutcome = { commits: [], rewritten: 0 };
  if (!(await exists(join(wc, BACKLOG_CONFIG)))) return none;
  return underWriteLock(
    wc,
    async () => {
      if ((await changedEntries(wc)).length > 0) {
        throw new BackeError('usage', '--resign geht nicht zusammen mit Hand-Edits', {
          hint: 'erst backe commit',
        });
      }
      const config = await requireHeadConfig(wc);
      const head = await assertOnBranch(wc, config.sync.branch);
      const ref = await localBase(wc);
      const base = await mergeBase(wc, ref, head);
      const local = await localCommits(wc, { base, head }, handle);
      const first = local.findIndex((l) => l.unit === undefined);
      if (first < 0) return none;
      const start = (local[first] as LocalCommit).commit.parents[0] as string;
      const startSnapshot = await snapshotOf(wc, start);
      assertActorIsUser(startSnapshot, handle);
      const user = startSnapshot.users.get(handle) as StoredEntity<User>;
      const b: Build = {
        wc,
        handle,
        key,
        author: authorOf(handle, user.data.name),
        ctx,
        now: isoNow((deps.now ?? (() => new Date()))()),
        randomBytes: deps.randomBytes ?? defaultRandomBytes,
      };
      let current = start;
      let rewritten = 0;
      for (const { commit, unit } of local.slice(first)) {
        if (unit === undefined) {
          current = await translateCommit(b, commit, current);
          rewritten++;
        } else {
          current = await replayCommit(b, unit, current);
        }
      }
      const built = current === start ? [] : await listCommits(wc, { from: start, to: current });
      if (built.length > 0) {
        const report = await verifyRange(wc, { since: start, to: current, ancestor: start });
        const reasons = [...new Set(report.invalid.flatMap((f) => f.reasons))];
        if (reasons.length > 0) {
          throw new BackeError(
            'validation',
            `verify würde den Commit ablehnen: ${reasons.join('; ')}`,
            { details: { reasons } },
          );
        }
      }
      await resetKeep(wc, head, current);
      return {
        commits: built.map((c) => ({
          commit: c.sha,
          kind: kindOf(c.message),
          summary: parseCommitMessage(c.message).subject,
        })),
        rewritten,
      };
    },
    deps.lock,
  );
}
