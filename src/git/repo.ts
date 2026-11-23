import { BackeError } from '../core/errors.ts';
import { applyFileChanges, exists, type FileChange, isIssueDirPath } from '../store/files.ts';
import { forChunks, git, PATH_CHUNK } from './exec.ts';

export type Operation = 'rebase' | 'merge' | 'cherry-pick' | 'revert';

export type HeadState = {
  branch: string | undefined;
  head: string | undefined;
  operation: Operation | undefined;
};

const OPERATION_MARKERS: readonly (readonly [string, Operation])[] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
];

/** Absolute Pfade aller Marker in der Reihenfolge von `OPERATION_MARKERS`, mit einem Git-Aufruf. */
async function markerPaths(wc: string): Promise<string[]> {
  const args = OPERATION_MARKERS.flatMap(([marker]) => ['--git-path', marker]);
  const { stdout } = await git(['rev-parse', '--path-format=absolute', ...args], { cwd: wc });
  return stdout.replace(/\n$/, '').split('\n');
}

export async function headState(wc: string): Promise<HeadState> {
  const sym = await git(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: wc, okExitCodes: [1] });
  const rev = await git(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: wc, okExitCodes: [1] });
  const paths = await markerPaths(wc);
  let operation: Operation | undefined;
  for (const [i, [, op]] of OPERATION_MARKERS.entries()) {
    if (await exists(paths[i] as string)) {
      operation = op;
      break;
    }
  }
  return {
    branch: sym.exitCode === 0 ? sym.stdout.trim() : undefined,
    head: rev.exitCode === 0 ? rev.stdout.trim() : undefined,
    operation,
  };
}

/** Liefert den HEAD-Commit, wenn `wc` auf `branch` steht und keine Operation läuft; sonst `conflict`. */
export async function assertOnBranch(wc: string, branch: string): Promise<string> {
  const state = await headState(wc);
  if (state.operation) {
    throw new BackeError('conflict', `In ${wc} läuft ein ${state.operation}`, {
      hint: `git -C ${wc} ${state.operation} --abort`,
    });
  }
  if (state.branch === undefined) {
    throw new BackeError('conflict', `${wc} steht auf keinem Branch (detached HEAD)`, {
      hint: `git -C ${wc} switch ${branch}`,
    });
  }
  if (state.branch !== branch) {
    throw new BackeError('conflict', `${wc} steht auf ${state.branch}, erwartet ${branch}`, {
      hint: `git -C ${wc} switch ${branch}`,
    });
  }
  if (state.head === undefined) {
    throw new BackeError('conflict', `${wc} hat noch keinen Commit`);
  }
  return state.head;
}

/**
 * Setzt `paths` auf den Stand von HEAD zurück: Pfade, die in HEAD existieren, werden ausgecheckt,
 * alle übrigen aus dem Arbeitsbaum entfernt; danach wird der Index für diese Pfade angeglichen.
 * Lange Listen gehen in Blöcken an git (ARG_MAX).
 */
export async function rollbackPaths(wc: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const env = { GIT_LITERAL_PATHSPECS: '1' };
  const { head } = await headState(wc);
  const inHead = new Set<string>();
  if (head !== undefined) {
    await forChunks(paths, PATH_CHUNK, async (chunk) => {
      const { stdout } = await git(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...chunk], {
        cwd: wc,
        env,
      });
      for (const file of stdout.split('\0')) if (file !== '') inHead.add(file);
    });
    await forChunks([...inHead], PATH_CHUNK, async (chunk) => {
      await git(['checkout', '-q', 'HEAD', '--', ...chunk], { cwd: wc, env });
    });
  }
  // Ein Pfad steht in HEAD, wenn er selbst oder ein Vorfahr einer Datei von dort ist.
  const known = new Set(inHead);
  for (const file of inHead) {
    for (let i = file.lastIndexOf('/'); i > 0; i = file.lastIndexOf('/', i - 1)) {
      known.add(file.slice(0, i));
    }
  }
  const removals = paths
    .filter((p) => !known.has(p))
    .map((path): FileChange => {
      return isIssueDirPath(path)
        ? { path, content: null, recursive: true }
        : { path, content: null };
    });
  await applyFileChanges(wc, removals);
  await forChunks(paths, PATH_CHUNK, async (chunk) => {
    await git(['reset', '-q', '--', ...chunk], { cwd: wc, env });
  });
}

/** Pfade unter `paths` mit Änderungen in Index oder Arbeitsbaum gegenüber HEAD, sortiert. */
export async function dirtyPaths(wc: string, paths: readonly string[]): Promise<string[]> {
  // Ein leerer Pathspec würde den ganzen Baum meinen; `forChunks` ruft für [] nichts auf.
  const out = new Set<string>();
  await forChunks(paths, PATH_CHUNK, async (chunk) => {
    const { stdout } = await git(
      ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', ...chunk],
      { cwd: wc, env: { GIT_LITERAL_PATHSPECS: '1' } },
    );
    for (const entry of stdout.split('\0')) {
      if (entry.length > 3) out.add(entry.slice(3));
    }
  });
  return [...out].sort();
}
