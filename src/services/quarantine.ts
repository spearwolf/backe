/**
 * Quarantäne — der Weg zurück (backe.md §2.13): ein Admin trägt einen ungültigen Commit in
 * `.backe/quarantine.jsonc` als hingenommen oder umgekehrt ein; die Umkehr geschieht im selben
 * signierten Commit.
 */
import { applyEdits, modify } from 'jsonc-parser';
import { ZodError } from 'zod';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { sshFingerprint } from '../core/fingerprint.ts';
import { shortSha } from '../core/ids.ts';
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
import { readPublicKey } from '../git/ssh.ts';
import { isAdmin } from '../ops/admin.ts';
import { violation } from '../ops/invariants.ts';
import { checkCommitPolicy, type PolicyState, type TreeChange } from '../ops/verify-policy.ts';
import type { FileChange } from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, classifyPath, QUARANTINE } from '../store/layout.ts';
import { type BacklogSnapshot, loadSnapshot } from '../store/snapshot.ts';
import { m } from './quarantine.messages.ts';
import { blobsAt, nextCommitBasis, treeChangesWithContent } from './verify.ts';
import { activeFingerprints, zodMessage } from './verify-state.ts';
import { executeWrite, type WriteDeps, type WriteResult } from './write.ts';

export type QuarantineInput = { sha: string; decision: 'accepted' | 'reverted'; reason: string };

const EMPTY = '{\n  "entries": []\n}\n';

const parseQuarantine = (text: string): Quarantine =>
  QuarantineSchema.parse(readJsonc(text, QUARANTINE));

const manual = (reason: string) => new BackeError('conflict', m.manualRevertNeeded(reason));

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
    if (err instanceof BackeError) throw manual(err.message);
    // Nur das Config-Schema wirft hier einen ZodError.
    if (err instanceof ZodError) throw manual(`${BACKLOG_CONFIG}: ${zodMessage(err)}`);
    throw err;
  }
  return { config, users };
}

/**
 * Änderungen, die den Commit `sha` umkehren: je Pfad der Inhalt im Parent oder `null`. Geprüft
 * wird der geplante Commit wie von `verify`: gegen `basis`, den Stand für den nächsten Commit.
 */
async function revertChanges(
  wc: string,
  ctx: {
    sha: string;
    parent: string;
    raw: RawChange[];
    admin: string;
    basis: PolicyState;
    checked: string;
  },
  snapshot: BacklogSnapshot,
): Promise<FileChange[]> {
  const { sha, parent, raw, admin, basis, checked } = ctx;
  for (const c of raw) {
    if (['120000', '160000'].some((mode) => mode === c.oldMode || mode === c.newMode)) {
      throw manual(m.symlinkOrSubmodule(c.path));
    }
  }
  const paths = raw.map((c) => c.path).filter((path) => path !== QUARANTINE);
  const specs = paths.flatMap((path) => [
    `${checked}:${path}`,
    `${sha}:${path}`,
    `${parent}:${path}`,
  ]);
  const blobs = await readBlobs(wc, specs);
  const parentMode = new Map(raw.map((c) => [c.path, c.oldMode]));
  const changes: FileChange[] = paths.map((path) => {
    if (!sameBytes(blobs.get(`${checked}:${path}`), blobs.get(`${sha}:${path}`))) {
      throw new BackeError('conflict', m.changedSince(path, shortSha(sha)));
    }
    const content = blobs.get(`${parent}:${path}`) ?? null;
    // Auch der Modus kehrt um: Ein Commit, der nur 100644 → 100755 ändert, hat gleiche Bytes.
    return content === null
      ? { path, content }
      : { path, content, executable: parentMode.get(path) === '100755' };
  });
  const planned = await treeChangesWithContent(
    changes.map((c) => {
      const before = blobs.get(`${checked}:${c.path}`) ?? null;
      const gone = c.content === null;
      return {
        path: c.path,
        status: before === null ? 'A' : gone ? 'D' : 'M',
        oldMode: before === null ? '000000' : '100644',
        newMode: gone ? '000000' : c.executable === true ? '100755' : '100644',
      } satisfies RawChange;
    }),
    blobsAt(wc, checked),
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
    removedHandles: addsUser ? await removedHandles(wc, checked) : new Set(),
  });
  if (reasons.length > 0) throw manual(reasons.join('; '));
  return changes;
}

export async function quarantineCommit(
  ctx: ResolvedContext,
  input: QuarantineInput,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  if (input.reason.trim() === '') throw new BackeError('validation', m.reasonEmpty);
  const { handle, key, workingCopy: wc } = requireWriter(ctx);
  // Der Stand, gegen den geprüft wird; bewegt sich HEAD bis zum Write, scheitert er (`expectHead`).
  const checked = await resolveCommit(wc, 'HEAD');
  const snapshot = await loadSnapshot(wc);
  // `verify` beurteilt den Quarantäne-Commit gegen diesen Stand, nicht gegen HEAD: Solange
  // ungültige Commits ungedeckt sind, ist er der Stand vor dem ersten davon.
  const { state, quarantineText } = await nextCommitBasis(wc);
  const config = state.config;
  if (typeof config === 'string' || !isAdmin(config, handle, state.users.get(handle))) {
    throw violation('policy', m.adminsOnly);
  }
  const pub = sshFingerprint(await readPublicKey(key));
  if (!activeFingerprints(state.users.get(handle)).has(pub)) {
    throw manual(m.signingKeyNotValid(handle));
  }
  const sha = await resolveCommit(wc, input.sha);
  if (!(await isAncestor(wc, sha, checked))) {
    throw new BackeError('not_found', m.commitNotInHistory(input.sha));
  }
  const isRoot = (await rootCommits(wc, checked)).includes(sha);
  const parent = isRoot ? undefined : await resolveCommit(wc, `${sha}^`);
  const raw = parent === undefined ? [] : await treeChanges(wc, parent, sha);
  const text = quarantineText ?? EMPTY;
  if (parseQuarantine(text).entries.some((e) => e.sha === sha)) {
    throw new BackeError('conflict', m.alreadyQuarantined(shortSha(sha)));
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
      throw new BackeError('conflict', m.anchorNotRevertible);
    }
    const basis = { config, users: state.users };
    changes.push(
      ...(await revertChanges(wc, { sha, parent, raw, admin: handle, basis, checked }, snapshot)),
    );
  }
  const verb = input.decision === 'accepted' ? 'accept' : 'revert';
  return executeWrite(
    ctx,
    {
      kind: 'manual',
      subject: `verify ${verb} ${shortSha(sha)}`,
      changes,
      signers: state.users,
      expectHead: checked,
    },
    deps,
  );
}
