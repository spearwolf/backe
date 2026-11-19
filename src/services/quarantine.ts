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
import { sshFingerprint } from '../core/ssh.ts';
import {
  isAncestor,
  type RawChange,
  readBlobs,
  removedHandles,
  resolveCommit,
  rootCommits,
  treeChanges,
} from '../git/history.ts';
import { readPublicKey } from '../git/ssh.ts';
import { violation } from '../ops/invariants.ts';
import { checkCommitPolicy, type PolicyState, type TreeChange } from '../ops/verify-policy.ts';
import type { FileChange } from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, classifyPath, QUARANTINE } from '../store/layout.ts';
import { type BacklogSnapshot, loadSnapshot } from '../store/snapshot.ts';
import { blobsAt, nextCommitBasis, treeChangesWithContent } from './verify.ts';
import { activeFingerprints } from './verify-state.ts';
import { executeWrite, type WriteDeps, type WriteResult } from './write.ts';

export type QuarantineInput = { sha: string; decision: 'accepted' | 'reverted'; reason: string };

const EMPTY = '{\n  "entries": []\n}\n';

const parseQuarantine = (text: string): Quarantine =>
  QuarantineSchema.parse(readJsonc(text, QUARANTINE));

const manual = (reason: string) => new BackeError('conflict', `Umkehr von Hand nötig: ${reason}`);

const sameBytes = (a: Buffer | null | undefined, b: Buffer | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && a.equals(b));

/** Stand nach dem geplanten Commit: HEAD-Users und -Config, überlagert mit den geplanten Dateien. */
function plannedState(snapshot: BacklogSnapshot, changes: readonly TreeChange[]) {
  const users = new Map<string, User>();
  for (const [handle, u] of snapshot.users) users.set(handle, u.data);
  let config: BacklogConfig = snapshot.config;
  try {
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
  } catch (err) {
    throw manual(err instanceof Error ? err.message : String(err));
  }
  return { config, users };
}

/**
 * Änderungen, die den Commit `sha` umkehren: je Pfad der Inhalt im Parent oder `null`. Geprüft
 * wird der geplante Commit wie von `verify`: gegen `basis`, den Stand für den nächsten Commit.
 */
async function revertChanges(
  wc: string,
  ctx: { sha: string; parent: string; raw: RawChange[]; admin: string; basis: PolicyState },
  snapshot: BacklogSnapshot,
): Promise<FileChange[]> {
  const { sha, parent, raw, admin, basis } = ctx;
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
  const planned = await treeChangesWithContent(
    changes.map((c) => {
      const before = blobs.get(`HEAD:${c.path}`) ?? null;
      const gone = c.content === null;
      return {
        path: c.path,
        status: before === null ? 'A' : gone ? 'D' : 'M',
        oldMode: before === null ? '000000' : '100644',
        newMode: gone ? '000000' : '100644',
      } satisfies RawChange;
    }),
    blobsAt(wc, 'HEAD'),
    async (paths) =>
      new Map(
        paths.map((path) => {
          const content = changes.find((c) => c.path === path)?.content ?? null;
          return [path, content === null ? null : Buffer.from(content)];
        }),
      ),
  );
  const addsUser = planned.some((c) => c.status === 'A' && classifyPath(c.path).kind === 'user');
  const reasons = checkCommitPolicy({
    actor: admin,
    parent: basis,
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
  const { handle, key, workingCopy: wc } = requireWriter(ctx);
  const snapshot = await loadSnapshot(wc);
  // `verify` beurteilt den Quarantäne-Commit gegen diesen Stand, nicht gegen HEAD: Solange
  // ungültige Commits ungedeckt sind, ist er der Stand vor dem ersten davon.
  const { state, quarantineText } = await nextCommitBasis(wc);
  const config = state.config;
  if (
    typeof config === 'string' ||
    !config.admins.includes(handle) ||
    state.users.get(handle)?.kind !== 'human'
  ) {
    throw violation('policy', 'Quarantäne ändern nur Admins');
  }
  const pub = sshFingerprint(await readPublicKey(key));
  if (!activeFingerprints(state.users.get(handle)).has(pub)) {
    throw manual(`der Signier-Key von ${handle} gilt im maßgeblichen Stand nicht`);
  }
  const sha = await resolveCommit(wc, input.sha);
  if (!(await isAncestor(wc, sha, 'HEAD'))) {
    throw new BackeError('not_found', `Commit ${input.sha} liegt nicht in der Historie von HEAD`);
  }
  const isRoot = (await rootCommits(wc, 'HEAD')).includes(sha);
  const parent = isRoot ? undefined : await resolveCommit(wc, `${sha}^`);
  const raw = parent === undefined ? [] : await treeChanges(wc, parent, sha);
  const text = quarantineText ?? EMPTY;
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
    const basis = { config, users: state.users };
    changes.push(
      ...(await revertChanges(wc, { sha, parent, raw, admin: handle, basis }, snapshot)),
    );
  }
  const verb = input.decision === 'accepted' ? 'accept' : 'revert';
  return executeWrite(
    ctx,
    {
      kind: 'manual',
      subject: `verify ${verb} ${sha.slice(0, 7)}`,
      changes,
      signers: state.users,
    },
    deps,
  );
}
