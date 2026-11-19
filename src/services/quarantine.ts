/**
 * Quarantäne — der Weg zurück (backe.md §2.13): ein Admin trägt einen ungültigen Commit in
 * `.backe/quarantine.jsonc` als hingenommen oder umgekehrt ein; die Umkehr geschieht im selben
 * signierten Commit.
 */
import { applyEdits, modify } from 'jsonc-parser';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import {
  type BacklogConfig,
  BacklogConfigSchema,
  type Quarantine,
  QuarantineSchema,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import {
  isAncestor,
  type RawChange,
  readBlobs,
  removedHandles,
  resolveCommit,
  rootCommits,
  treeChanges,
} from '../git/history.ts';
import { violation } from '../ops/invariants.ts';
import { checkCommitPolicy, type TreeChange } from '../ops/verify-policy.ts';
import type { FileChange } from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, classifyPath, QUARANTINE } from '../store/layout.ts';
import { type BacklogSnapshot, loadSnapshot } from '../store/snapshot.ts';
import { executeWrite, type WriteDeps, type WriteResult } from './write.ts';

export type QuarantineInput = { sha: string; decision: 'accepted' | 'reverted'; reason: string };

const EMPTY = '{\n  "entries": []\n}\n';

function parseQuarantine(text: string): Quarantine {
  const result = QuarantineSchema.safeParse(readJsonc(text, QUARANTINE));
  if (!result.success) {
    throw new BackeError('validation', `${QUARANTINE}: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}

async function headText(wc: string): Promise<string> {
  const spec = `HEAD:${QUARANTINE}`;
  return (await readBlobs(wc, [spec])).get(spec)?.toString('utf8') ?? EMPTY;
}

/**
 * Ausgangstext der Quarantäne-Datei: hat der Commit selbst sie geändert (typisch, denn nur Admins
 * dürfen das), gilt die Datei im Parent, damit weder seine Einträge noch eine kaputte Datei
 * übernommen werden; sonst die Datei in HEAD.
 */
async function baseText(wc: string, parent: string | undefined, changes: RawChange[]) {
  if (parent === undefined || !changes.some((c) => c.path === QUARANTINE)) return headText(wc);
  const spec = `${parent}:${QUARANTINE}`;
  return (await readBlobs(wc, [spec])).get(spec)?.toString('utf8') ?? EMPTY;
}

const manual = (reason: string) => new BackeError('conflict', `Umkehr von Hand nötig: ${reason}`);

const sameBytes = (a: Buffer | null | undefined, b: Buffer | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && a.equals(b));

/** Stand nach dem geplanten Commit: HEAD-Users und -Config, überlagert mit den geplanten Dateien. */
function plannedState(snapshot: BacklogSnapshot, changes: readonly TreeChange[]) {
  const users = new Map<string, User>();
  for (const [handle, u] of snapshot.users) users.set(handle, u.data);
  let config: BacklogConfig = snapshot.config;
  for (const c of changes) {
    const cls = classifyPath(c.path);
    if (cls.kind === 'user') {
      users.delete(cls.key);
      if (c.after === null) continue;
      const { data } = parseEntityFile(c.after, c.path);
      users.set(cls.key, validateEntity('user', data, c.path).data as User);
    } else if (c.path === BACKLOG_CONFIG && c.after !== null) {
      config = BacklogConfigSchema.parse(readJsonc(c.after, BACKLOG_CONFIG));
    }
  }
  return { config, users };
}

/** Änderungen, die den Commit `sha` umkehren: je Pfad der Inhalt im Parent oder `null`. */
async function revertChanges(
  wc: string,
  ctx: { sha: string; parent: string; raw: RawChange[]; admin: string },
  snapshot: BacklogSnapshot,
): Promise<FileChange[]> {
  const { sha, parent, raw, admin } = ctx;
  for (const c of raw) {
    if (['120000', '160000'].some((m) => m === c.oldMode || m === c.newMode)) {
      throw manual(`Symlink oder Submodule ${c.path}`);
    }
  }
  const paths = raw.map((c) => c.path).filter((path) => path !== QUARANTINE);
  const specs = paths.flatMap((path) => [`HEAD:${path}`, `${sha}:${path}`, `${parent}:${path}`]);
  const blobs = await readBlobs(wc, specs);
  const changes: FileChange[] = paths.map((path) => {
    if (!sameBytes(blobs.get(`HEAD:${path}`), blobs.get(`${sha}:${path}`))) {
      throw new BackeError(
        'conflict',
        `${path} wurde nach ${sha.slice(0, 7)} geändert; Umkehr von Hand`,
      );
    }
    return { path, content: blobs.get(`${parent}:${path}`) ?? null };
  });
  const relevant = (path: string) =>
    path === BACKLOG_CONFIG || ['user', 'issue', 'comment'].includes(classifyPath(path).kind);
  const text = (b: Buffer | null | undefined) => b?.toString('utf8') ?? null;
  const planned: TreeChange[] = changes.map((c) => {
    const before = blobs.get(`HEAD:${c.path}`) ?? null;
    const after = c.content === null ? null : Buffer.from(c.content);
    return {
      path: c.path,
      status: before === null ? 'A' : after === null ? 'D' : 'M',
      oldMode: before === null ? '000000' : '100644',
      newMode: after === null ? '000000' : '100644',
      before: relevant(c.path) ? text(before) : null,
      after: relevant(c.path) ? text(after) : null,
    };
  });
  const addsUser = planned.some((c) => c.status === 'A' && classifyPath(c.path).kind === 'user');
  const reasons = checkCommitPolicy({
    actor: admin,
    parent: {
      config: snapshot.config,
      users: new Map([...snapshot.users].map(([h, u]) => [h, u.data])),
    },
    after: plannedState(snapshot, planned),
    changes: planned,
    removedHandles: addsUser ? await removedHandles(wc, 'HEAD') : new Set(),
  });
  if (reasons.length > 0) throw manual(reasons.join('; '));
  return changes;
}

export async function quarantineCommit(
  ctx: ResolvedContext,
  input: QuarantineInput,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const { handle, workingCopy: wc } = requireWriter(ctx);
  const snapshot = await loadSnapshot(wc);
  if (
    !snapshot.config.admins.includes(handle) ||
    snapshot.users.get(handle)?.data.kind !== 'human'
  ) {
    throw violation('policy', 'Quarantäne ändern nur Admins');
  }
  const sha = await resolveCommit(wc, input.sha);
  if (!(await isAncestor(wc, sha, 'HEAD'))) {
    throw new BackeError('not_found', `Commit ${input.sha} liegt nicht in der Historie von HEAD`);
  }
  const isRoot = (await rootCommits(wc, 'HEAD')).includes(sha);
  const parent = isRoot ? undefined : await resolveCommit(wc, `${sha}^`);
  const raw = parent === undefined ? [] : await treeChanges(wc, parent, sha);
  const text = await baseText(wc, parent, raw);
  if (parseQuarantine(text).entries.some((e) => e.sha === sha)) {
    throw new BackeError('conflict', `Commit ${sha.slice(0, 7)} steht schon in der Quarantäne`);
  }
  const edits = modify(
    text,
    ['entries', -1],
    { sha, decision: input.decision, reason: input.reason },
    { isArrayInsertion: true, formattingOptions: { insertSpaces: true, tabSize: 2 } },
  );
  const next = applyEdits(text, edits);
  parseQuarantine(next);
  const changes: FileChange[] = [{ path: QUARANTINE, content: next }];
  if (input.decision === 'reverted') {
    if (parent === undefined) {
      throw new BackeError('conflict', 'Der Vertrauensanker lässt sich nicht umkehren');
    }
    changes.push(...(await revertChanges(wc, { sha, parent, raw, admin: handle }, snapshot)));
  }
  const verb = input.decision === 'accepted' ? 'accept' : 'revert';
  return executeWrite(
    ctx,
    { kind: 'manual', subject: `verify ${verb} ${sha.slice(0, 7)}`, changes },
    deps,
  );
}
