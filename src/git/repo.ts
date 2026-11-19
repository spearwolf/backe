import { stat } from 'node:fs/promises';
import { BackeError } from '../core/errors.ts';
import { applyFileChanges, type FileChange } from '../store/files.ts';
import { git } from './exec.ts';

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

async function gitPath(wc: string, name: string): Promise<string> {
  const { stdout } = await git(['rev-parse', '--path-format=absolute', '--git-path', name], {
    cwd: wc,
  });
  return stdout.replace(/\n$/, '');
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function headState(wc: string): Promise<HeadState> {
  const sym = await git(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: wc, okExitCodes: [1] });
  const rev = await git(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: wc, okExitCodes: [1] });
  let operation: Operation | undefined;
  for (const [marker, op] of OPERATION_MARKERS) {
    if (await exists(await gitPath(wc, marker))) {
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

const ISSUE_DIR = /^issues\/[^/]+\/[^/]+$/;

/**
 * Setzt `paths` auf den Stand von HEAD zurück: Pfade, die in HEAD existieren, werden ausgecheckt,
 * alle übrigen aus dem Arbeitsbaum entfernt; danach wird der Index für diese Pfade angeglichen.
 */
export async function rollbackPaths(wc: string, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const env = { GIT_LITERAL_PATHSPECS: '1' };
  const { head } = await headState(wc);
  let inHead: string[] = [];
  if (head !== undefined) {
    const { stdout } = await git(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...paths], {
      cwd: wc,
      env,
    });
    inHead = stdout.split('\0').filter((f) => f !== '');
    if (inHead.length > 0) {
      await git(['checkout', '-q', 'HEAD', '--', ...inHead], { cwd: wc, env });
    }
  }
  const removals = paths
    .filter((p) => !inHead.some((f) => f === p || f.startsWith(`${p}/`)))
    .map((path): FileChange => {
      return ISSUE_DIR.test(path)
        ? { path, content: null, recursive: true }
        : { path, content: null };
    });
  await applyFileChanges(wc, removals);
  await git(['reset', '-q', '--', ...paths], { cwd: wc, env });
}

/** Pfade unter `paths` mit Änderungen in Index oder Arbeitsbaum gegenüber HEAD, sortiert. */
export async function dirtyPaths(wc: string, paths: readonly string[]): Promise<string[]> {
  // Ein leerer Pathspec würde den ganzen Baum meinen.
  if (paths.length === 0) return [];
  const { stdout } = await git(
    ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', ...paths],
    { cwd: wc, env: { GIT_LITERAL_PATHSPECS: '1' } },
  );
  const out: string[] = [];
  for (const entry of stdout.split('\0')) {
    if (entry.length > 3) out.push(entry.slice(3));
  }
  return out.sort();
}
