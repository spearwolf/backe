import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { m } from './commit.messages.ts';
import { type GitEnv, git, transportEnv } from './exec.ts';
import { stateDir } from './local-state.ts';

export type CommitInput = {
  paths: readonly string[];
  message: string;
  key: string;
  author: { name: string; email: string };
  env: GitEnv;
  parent: string | undefined;
  /**
   * Wohin HEAD springt: `{ from }` setzt HEAD per `update-ref` von `from` (Default `{ from: parent }`)
   * auf den neuen Commit und gleicht danach den Index der Pfade an; `false` erzeugt nur das
   * Commit-Objekt (Glied einer Kette), ohne `update-ref` und ohne Index-Reset.
   */
  updateRef?: { from: string | undefined } | false;
};

type FailureDetails = { exitCode?: number; stderr?: string };

/** Pfade als NUL-getrennte Liste für `--pathspec-from-file=- --pathspec-file-nul`. */
function pathList(paths: readonly string[]): string {
  return paths.map((p) => `${p}\0`).join('');
}

/** Details eines fehlgeschlagenen git-Aufrufs (`unexpected` aus `git()`), sonst `undefined`. */
function gitFailure(error: unknown): FailureDetails | undefined {
  if (error instanceof BackeError && error.code === 'unexpected') {
    return (error.details ?? {}) as FailureDetails;
  }
  return undefined;
}

/** Baum von `parent`; ohne Parent der leere Baum. */
export async function treeOf(wc: string, parent: string | undefined): Promise<string> {
  const { stdout } =
    parent === undefined
      ? await git(['hash-object', '-t', 'tree', '--stdin'], { cwd: wc })
      : await git(['rev-parse', `${parent}^{tree}`], { cwd: wc });
  return stdout.trim();
}

export type SignedCommitInput = {
  tree: string;
  parent: string | undefined;
  message: string;
  key: string;
  author: { name: string; email: string };
  env: GitEnv;
};

/**
 * Erzeugt ein signiertes Commit-Objekt über `commit-tree -S` (SSH-Signatur mit `key`); weder Refs
 * noch Index noch Arbeitsbaum ändern sich. Autor und Committer sind `author`.
 */
export async function signedCommit(wc: string, input: SignedCommitInput): Promise<string> {
  const { tree, parent } = input;
  const commitEnv = {
    ...transportEnv(input.env),
    GIT_AUTHOR_NAME: input.author.name,
    GIT_AUTHOR_EMAIL: input.author.email,
    GIT_COMMITTER_NAME: input.author.name,
    GIT_COMMITTER_EMAIL: input.author.email,
  };
  const created = await git(
    [
      '-c',
      'gpg.format=ssh',
      '-c',
      `user.signingkey=${input.key}`,
      'commit-tree',
      '-S',
      tree,
      ...(parent === undefined ? [] : ['-p', parent]),
      '-F',
      '-',
    ],
    { cwd: wc, env: commitEnv, input: input.message },
  ).catch((error: unknown) => {
    const failure = gitFailure(error);
    if (failure) {
      const first = (failure.stderr ?? '').split('\n')[0] ?? '';
      throw new BackeError('usage', m.signingFailed(input.key, first), {
        hint: m.signingFailedHint,
        details: failure,
      });
    }
    throw error;
  });
  return created.stdout.trim();
}

/**
 * Committet genau `input.paths` (Löschungen inklusive) signiert über einen temporären Index;
 * Index und Arbeitsbaum des Aufrufers bleiben für alle anderen Pfade unberührt. Eine Kette
 * entsteht mit `updateRef: false` für die ersten Glieder und `updateRef: { from: <alter HEAD> }`
 * für das letzte: HEAD springt einmal vom alten Stand auf das Ende der Kette.
 */
export async function commitPaths(wc: string, input: CommitInput): Promise<string> {
  const rnd = randomBytes(6).toString('hex');
  const indexFile = join(await stateDir(wc), `index-${process.pid}-${rnd}`);
  const env = { GIT_INDEX_FILE: indexFile, GIT_LITERAL_PATHSPECS: '1' };
  const pathspec = ['--pathspec-from-file=-', '--pathspec-file-nul'];
  const { parent } = input;
  try {
    await git(parent === undefined ? ['read-tree', '--empty'] : ['read-tree', parent], {
      cwd: wc,
      env,
    });
    // `-f`: Die Pfade gehören backe; eine `.gitignore` im Backlog darf sie nicht aussperren.
    await git(['add', '-A', '-f', ...pathspec], { cwd: wc, env, input: pathList(input.paths) });
    const tree = (await git(['write-tree'], { cwd: wc, env })).stdout.trim();
    if (tree === (await treeOf(wc, parent))) {
      throw new BackeError('unexpected', m.noTreeChange);
    }

    const sha = await signedCommit(wc, { ...input, tree });
    const target = input.updateRef ?? { from: parent };
    if (target === false) return sha;

    const subject = input.message.split('\n')[0] ?? '';
    await git(['update-ref', '-m', subject, 'HEAD', sha, target.from ?? ''], { cwd: wc }).catch(
      (error: unknown) => {
        const failure = gitFailure(error);
        const stderr = failure?.stderr ?? '';
        if (
          failure?.exitCode === 128 &&
          (stderr.includes('but expected') || stderr.includes('cannot lock ref'))
        ) {
          throw new BackeError('conflict', m.headMoved, {
            details: failure,
          });
        }
        throw error;
      },
    );

    // Der Commit ist gelandet; den Index nachzuziehen ist Kosmetik. Scheitert es (index.lock
    // gehalten, Signal an den git-Prozess), zeigt `git status` die Pfade eben als geändert.
    await git(['reset', '-q', ...pathspec], {
      cwd: wc,
      env: { GIT_LITERAL_PATHSPECS: '1' },
      input: pathList(input.paths),
    }).catch(() => undefined);
    return sha;
  } finally {
    await rm(indexFile, { force: true });
  }
}
