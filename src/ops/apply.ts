/**
 * Eine Operation rein gegen einen Snapshot anwenden (backe.md §2.16.4): Vorprüfungen, Dispatch
 * auf die Operation und Übersetzung des Endstands in Dateiänderungen. Kein I/O, Zeit und Zufall
 * kommen aus dem `ApplyContext`.
 */
import { BackeError } from '../core/errors.ts';
import { type Comment, IssueSchema } from '../core/schemas.ts';
import type { FileChange } from '../store/files.ts';
import type { BacklogSnapshot, StoredEntity } from '../store/snapshot.ts';
import { attachAdd, attachRm, commentAdd, commentDelete, commentEdit } from './comment-ops.ts';
import { issueDelete } from './delete-op.ts';
import { Draft } from './draft.ts';
import {
  entityEdit,
  projectCreate,
  projectMv,
  projectRm,
  repoAdd,
  repoRm,
  sprintClose,
  sprintCreate,
  userAdd,
  userRevokeKey,
  userRm,
} from './entity-ops.ts';
import { violation } from './invariants.ts';
import { issueCreate, issueEdit, issueLink, issueRank, issueUnlink } from './issue-ops.ts';
import type { Notice } from './notice.ts';
import { type Operation, PLACEHOLDER_RE, referencedIds } from './operation.ts';
import { issueClaim, issueMove, issueReopen, issueResume } from './state-ops.ts';

export type ApplyContext = {
  /** Handle des Akteurs; muss ein User im Snapshot sein. */
  actor: string;
  /** UTC-Zeitstempel `YYYY-MM-DDTHH:MM:SSZ`. */
  now: string;
  randomBytes?: (n: number) => Uint8Array;
  /** Kommentare je Issue-ID, soweit `commentsNeeded` sie verlangt. */
  comments?: ReadonlyMap<string, readonly StoredEntity<Comment>[]>;
};

export type ApplyResult = {
  snapshot: BacklogSnapshot;
  changes: FileChange[];
  /** Die Operation mit allen ergänzten Feldern, so wie sie aufgezeichnet wird. */
  recorded: Operation;
  notices: Notice[];
  noop: boolean;
};

const Timestamp = IssueSchema.shape.created;

/** Issue-IDs, deren Kommentare der Aufrufer vorab in `ctx.comments` laden muss. */
export function commentsNeeded(op: Operation): string[] {
  return op.op === 'comment.edit' || op.op === 'comment.delete' ? [op.id] : [];
}

function dispatch(d: Draft, op: Operation): Operation {
  switch (op.op) {
    case 'issue.create':
      return issueCreate(d, op);
    case 'issue.edit':
      return issueEdit(d, op);
    case 'issue.move':
      return issueMove(d, op);
    case 'issue.resume':
      return issueResume(d, op);
    case 'issue.reopen':
      return issueReopen(d, op);
    case 'issue.claim':
      return issueClaim(d, op);
    case 'issue.rank':
      return issueRank(d, op);
    case 'issue.link':
      return issueLink(d, op);
    case 'issue.unlink':
      return issueUnlink(d, op);
    case 'issue.delete':
      return issueDelete(d, op);
    case 'comment.add':
      return commentAdd(d, op);
    case 'comment.edit':
      return commentEdit(d, op);
    case 'comment.delete':
      return commentDelete(d, op);
    case 'attach.add':
      return attachAdd(d, op);
    case 'attach.rm':
      return attachRm(d, op);
    case 'project.create':
      return projectCreate(d, op);
    case 'project.mv':
      return projectMv(d, op);
    case 'project.rm':
      return projectRm(d, op);
    case 'sprint.create':
      return sprintCreate(d, op);
    case 'sprint.close':
      return sprintClose(d, op);
    case 'repo.add':
      return repoAdd(d, op);
    case 'repo.rm':
      return repoRm(d, op);
    case 'user.add':
      return userAdd(d, op);
    case 'user.revoke_key':
      return userRevokeKey(d, op);
    case 'user.rm':
      return userRm(d, op);
    case 'entity.edit':
      return entityEdit(d, op);
  }
}

/**
 * Ein Operationsschritt auf einem bestehenden Draft, gemeinsam für `applyOperation` und den
 * Batch: Vorab ist der Akteur ein User (`policy`), `now` ein gültiger Zeitstempel und die
 * Operation nennt keinen Batch-Platzhalter mehr (`schema`); danach Dispatch. Gibt die Operation
 * so zurück, wie sie aufgezeichnet wird.
 */
export function applyStep(d: Draft, op: Operation): Operation {
  const { ctx } = d;
  if (!d.snapshot.users.has(ctx.actor)) {
    throw violation('policy', `Akteur "${ctx.actor}" ist kein User dieses Backlogs`);
  }
  if (!Timestamp.safeParse(ctx.now).success) {
    throw new BackeError('unexpected', `Ungültiger Zeitstempel im ApplyContext: "${ctx.now}"`);
  }
  const placeholders = referencedIds(op).filter((id) => PLACEHOLDER_RE.test(id));
  if (placeholders.length > 0) {
    throw violation('schema', `Unaufgelöste Platzhalter: ${placeholders.join(', ')}`, {
      hint: 'Platzhalter gibt es nur im Batch; dort werden sie vor dem Anwenden ersetzt.',
    });
  }
  return dispatch(d, op);
}

/**
 * Wendet `op` auf `s` an, ohne `s` zu verändern (ein Schritt auf einem frischen Draft, siehe
 * `applyStep`). `noop` heißt: Der Endstand unterscheidet sich nicht vom Basis-Snapshot (`changes`
 * ist leer); eine Operation, die schreibt und im selben Draft zurückschreibt, ist also ein No-op.
 */
export function applyOperation(s: BacklogSnapshot, op: Operation, ctx: ApplyContext): ApplyResult {
  const d = new Draft(s, ctx);
  const recorded = applyStep(d, op);
  const { snapshot, changes, notices } = d.finish();
  return { snapshot, changes, recorded, notices, noop: changes.length === 0 };
}
