/**
 * Quarantäne — der Weg zurück (backe.md §2.13): ein Admin trägt einen ungültigen Commit in
 * `.backe/quarantine.jsonc` als hingenommen oder umgekehrt ein; die Umkehr geschieht im selben
 * signierten Commit.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEdits, modify } from 'jsonc-parser';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { type Quarantine, QuarantineSchema } from '../core/schemas.ts';
import { isAncestor, readBlobs, resolveCommit, rootCommits, treeChanges } from '../git/history.ts';
import { violation } from '../ops/invariants.ts';
import type { FileChange } from '../store/files.ts';
import { readJsonc } from '../store/jsonc.ts';
import { QUARANTINE } from '../store/layout.ts';
import { loadSnapshot } from '../store/snapshot.ts';
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

async function currentText(wc: string): Promise<string> {
  try {
    return await readFile(join(wc, QUARANTINE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw error;
  }
}

const sameBytes = (a: Buffer | null | undefined, b: Buffer | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && a.equals(b));

/** Änderungen, die den Commit `sha` umkehren: je Pfad der Inhalt im Parent oder `null`. */
async function revertChanges(wc: string, sha: string): Promise<FileChange[]> {
  if ((await rootCommits(wc, 'HEAD')).includes(sha)) {
    throw new BackeError('conflict', 'Der Vertrauensanker lässt sich nicht umkehren');
  }
  const parent = await resolveCommit(wc, `${sha}^`);
  const changes = await treeChanges(wc, parent, sha);
  const specs = changes.flatMap((c) => [
    `HEAD:${c.path}`,
    `${sha}:${c.path}`,
    `${parent}:${c.path}`,
  ]);
  const blobs = await readBlobs(wc, specs);
  return changes.map((c) => {
    if (!sameBytes(blobs.get(`HEAD:${c.path}`), blobs.get(`${sha}:${c.path}`))) {
      throw new BackeError(
        'conflict',
        `${c.path} wurde nach ${sha.slice(0, 7)} geändert; Umkehr von Hand`,
      );
    }
    return { path: c.path, content: blobs.get(`${parent}:${c.path}`) ?? null };
  });
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
  const text = await currentText(wc);
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
  if (input.decision === 'reverted') changes.push(...(await revertChanges(wc, sha)));
  const verb = input.decision === 'accepted' ? 'accept' : 'revert';
  return executeWrite(
    ctx,
    { kind: 'manual', subject: `verify ${verb} ${sha.slice(0, 7)}`, changes },
    deps,
  );
}
