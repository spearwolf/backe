import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { assertRecursiveAllowed, assertRelative, type FileChange } from '../store/files.ts';
import { signedCommit, treeOf } from './commit.ts';
import { m } from './commit-changes.messages.ts';
import { type GitEnv, git } from './exec.ts';
import { stateDir } from './local-state.ts';

export type CommitChangesInput = {
  parent: string | undefined;
  changes: readonly FileChange[];
  message: string;
  key: string;
  author: { name: string; email: string };
  env: GitEnv;
};

type Step =
  | {
      kind: 'write';
      entries: { path: string; content: string | Uint8Array; executable?: boolean }[];
    }
  | { kind: 'remove'; paths: string[] }
  | { kind: 'remove-tree'; path: string };

/** Fasst benachbarte Schreibvorgänge und Löschungen zusammen; die Reihenfolge bleibt erhalten. */
function stepsOf(changes: readonly FileChange[]): Step[] {
  const steps: Step[] = [];
  for (const { path, content, recursive, executable } of changes) {
    if (recursive === true) {
      steps.push({ kind: 'remove-tree', path });
      continue;
    }
    const last = steps.at(-1);
    if (content === null) {
      if (last?.kind === 'remove') last.paths.push(path);
      else steps.push({ kind: 'remove', paths: [path] });
    } else {
      const entry = executable === undefined ? { path, content } : { path, content, executable };
      if (last?.kind === 'write') last.entries.push(entry);
      else steps.push({ kind: 'write', entries: [entry] });
    }
  }
  return steps;
}

/**
 * Baut aus `parent` und `changes` einen signierten Commit rein aus Git-Objekten: temporärer
 * Index, Blobs per `hash-object -w` ohne `--path` (Bytes bleiben unverändert, auch LFS-Pointer),
 * kein Ref, kein Index und kein Arbeitsbaum des Aufrufers wird angefasst. Ohne Wirkung auf den
 * Baum wirft er `unexpected`.
 */
export async function commitChanges(wc: string, input: CommitChangesInput): Promise<string> {
  for (const change of input.changes) {
    assertRelative(change.path);
    assertRecursiveAllowed(change);
  }
  const rnd = randomBytes(6).toString('hex');
  const indexFile = join(await stateDir(wc), `index-${process.pid}-${rnd}`);
  const env = { GIT_INDEX_FILE: indexFile, GIT_LITERAL_PATHSPECS: '1' };
  const { parent } = input;
  try {
    await git(parent === undefined ? ['read-tree', '--empty'] : ['read-tree', parent], {
      cwd: wc,
      env,
    });
    for (const step of stepsOf(input.changes)) {
      if (step.kind === 'write') {
        let info = '';
        for (const { path, content, executable } of step.entries) {
          const oid = (
            await git(['hash-object', '-w', '--stdin'], { cwd: wc, input: content })
          ).stdout.trim();
          info += `${executable === true ? '100755' : '100644'} ${oid}\t${path}\0`;
        }
        await git(['update-index', '-z', '--index-info'], { cwd: wc, env, input: info });
      } else if (step.kind === 'remove') {
        await git(['update-index', '--force-remove', '-z', '--stdin'], {
          cwd: wc,
          env,
          input: step.paths.map((p) => `${p}\0`).join(''),
        });
      } else {
        await git(['rm', '--cached', '-r', '-q', '-f', '--ignore-unmatch', '--', step.path], {
          cwd: wc,
          env,
        });
      }
    }
    const tree = (await git(['write-tree'], { cwd: wc, env })).stdout.trim();
    if (tree === (await treeOf(wc, parent))) {
      throw new BackeError('unexpected', m.noTreeChange);
    }
    return await signedCommit(wc, { ...input, tree });
  } finally {
    await rm(indexFile, { force: true });
  }
}
