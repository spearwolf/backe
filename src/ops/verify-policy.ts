/**
 * Identitätsschutz eines einzelnen Commits (backe.md §2.13 Punkt 4, §3.10): rein, ohne I/O.
 * `verify` ruft `checkCommitPolicy` für jeden Commit mit den Tree-Änderungen gegenüber dem Parent.
 */
import { BackeError } from '../core/errors.ts';
import { type BacklogConfig, type Issue, type User, validateEntity } from '../core/schemas.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { classifyPath, issueFile, userFile } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { checkUserChange } from './policy.ts';

/** Eine Änderung im Tree; `before`/`after` sind nur für Users, Issues, Kommentare und die Config gefüllt. */
export type TreeChange = {
  path: string;
  status: 'A' | 'M' | 'D' | 'T';
  oldMode: string;
  newMode: string;
  before: string | null;
  after: string | null;
};

export type PolicyState = { config: BacklogConfig; users: ReadonlyMap<string, User> };

export type CommitPolicyInput = {
  actor: string;
  parent: PolicyState;
  after: PolicyState;
  changes: readonly TreeChange[];
  removedHandles: ReadonlySet<string>;
};

/** Gründe, aus denen der Commit gegen den Identitätsschutz verstößt; leer heißt gültig. */
export function checkCommitPolicy(input: CommitPolicyInput): string[] {
  const { actor, parent, changes } = input;
  const admin = parent.config.admins.includes(actor) && parent.users.get(actor)?.kind === 'human';
  const deletedIssues = new Set(changes.filter((c) => c.status === 'D').map((c) => c.path));
  const reasons: string[] = [];
  for (const change of changes) {
    const found = checkChange(input, change, admin, deletedIssues);
    for (const reason of found) if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

function checkChange(
  input: CommitPolicyInput,
  change: TreeChange,
  admin: boolean,
  deletedFiles: ReadonlySet<string>,
): string[] {
  const { path } = change;
  const reasons: string[] = [];
  if (change.newMode === '120000') reasons.push(`Symlink: ${path}`);
  if (change.newMode === '160000') reasons.push(`Submodule: ${path}`);
  if (path.startsWith('.backe/') && !admin) reasons.push(`nur Admins ändern ${path}`);

  const cls = classifyPath(path);
  if (cls.kind === 'user') reasons.push(...checkUserFile(input, change, cls.key));
  else if (cls.kind === 'issue') reasons.push(...checkIssueFile(input.actor, change, cls.id));
  else if (cls.kind === 'comment') {
    const issueDeleted = deletedFiles.has(issueFile(cls.id));
    reasons.push(...checkCommentFile(input.actor, change, cls.file, issueDeleted));
  }
  return reasons;
}

/** Parst und validiert eine Entitätsdatei; der Fehler ist die Meldung für `nicht prüfbar`. */
function parseAs<T>(kind: 'user' | 'issue' | 'comment', text: string, path: string): T {
  const { data } = parseEntityFile(text, path);
  return validateEntity(kind, data, path).data as T;
}

function unverifiable(path: string, err: unknown): string {
  if (err instanceof BackeError) {
    const message = err.message.startsWith(`${path}: `)
      ? err.message.slice(path.length + 2)
      : err.message;
    return `nicht prüfbar: ${path}: ${message}`;
  }
  throw err;
}

function checkUserFile(input: CommitPolicyInput, change: TreeChange, handle: string): string[] {
  const { path } = change;
  let before: User | undefined;
  let after: User | undefined;
  try {
    if (change.before !== null) before = parseAs<User>('user', change.before, path);
    if (change.status !== 'D' && change.after !== null) {
      after = parseAs<User>('user', change.after, path);
    }
  } catch (err) {
    return [unverifiable(path, err)];
  }
  const s: BacklogSnapshot = {
    config: input.after.config,
    users: new Map(
      [...input.after.users].map(([h, data]) => [
        h,
        { data, extra: [], body: '', path: userFile(h) },
      ]),
    ),
    projects: new Map(),
    sprints: new Map(),
    repos: new Map(),
    issues: new Map(),
    problems: [],
  };
  try {
    checkUserChange(s, input.actor, handle, before, after, {
      removedBefore: input.removedHandles.has(handle),
    });
  } catch (err) {
    if (err instanceof BackeError) return [err.message];
    throw err;
  }
  return [];
}

function checkIssueFile(actor: string, change: TreeChange, id: string): string[] {
  if (change.status === 'D' || change.after === null) return [];
  const { path } = change;
  let after: Issue;
  let before: Issue | undefined;
  try {
    after = parseAs<Issue>('issue', change.after, path);
    if (change.status !== 'A' && change.before !== null) {
      before = parseAs<Issue>('issue', change.before, path);
    }
  } catch (err) {
    return [unverifiable(path, err)];
  }
  const reasons: string[] = [];
  if (before === undefined) {
    if (after.creator !== actor) {
      reasons.push(`creator von ${id} ist ${after.creator}, Akteur ist ${actor}`);
    }
    if (after.id !== id) reasons.push(`id von ${path} ist ${after.id}`);
  } else {
    for (const field of ['creator', 'id', 'created'] as const) {
      if (before[field] !== after[field]) reasons.push(`${field} von ${id} geändert`);
    }
  }
  return reasons;
}

function checkCommentFile(
  actor: string,
  change: TreeChange,
  file: string,
  issueDeleted: boolean,
): string[] {
  const { path } = change;
  const foreign = (author: string) => `Kommentar ${file} von ${author}, Akteur ist ${actor}`;
  try {
    if (change.status === 'A') {
      if (change.after === null) return [];
      const { author } = parseAs<{ author: string }>('comment', change.after, path);
      return author === actor ? [] : [foreign(author)];
    }
    if (issueDeleted || change.before === null) return [];
    const { author } = parseAs<{ author: string }>('comment', change.before, path);
    return author === actor ? [] : [foreign(author)];
  } catch (err) {
    return [unverifiable(path, err)];
  }
}
