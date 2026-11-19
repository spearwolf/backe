import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
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
  /** Mit `attachments.lfs` (backe.md §2.8): `git add` läuft mit dem LFS-Filter aus `-c`-Werten. */
  lfs?: boolean;
};

/** Der LFS-Filter nur für `git add`; die globale Git-Config bleibt unberührt. */
const LFS_FILTER = [
  '-c',
  'filter.lfs.clean=git-lfs clean -- %f',
  '-c',
  'filter.lfs.smudge=git-lfs smudge -- %f',
  '-c',
  'filter.lfs.process=git-lfs filter-process',
  '-c',
  'filter.lfs.required=true',
];

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
    await git([...(input.lfs ? LFS_FILTER : []), 'add', '-A', '-f', ...pathspec], {
      cwd: wc,
      env,
      input: pathList(input.paths),
    });
    const tree = (await git(['write-tree'], { cwd: wc, env })).stdout.trim();
    const parentTree =
      parent === undefined
        ? (await git(['hash-object', '-t', 'tree', '--stdin'], { cwd: wc })).stdout.trim()
        : (await git(['rev-parse', `${parent}^{tree}`], { cwd: wc })).stdout.trim();
    if (tree === parentTree) {
      throw new BackeError('unexpected', 'Write ohne Änderung am Baum');
    }

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
        throw new BackeError('usage', `Signieren mit ${input.key} fehlgeschlagen: ${first}`, {
          hint: 'Key-Pfad in identities prüfen; ein Public Key braucht einen laufenden ssh-agent.',
          details: failure,
        });
      }
      throw error;
    });
    const sha = created.stdout.trim();
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
          throw new BackeError('conflict', 'HEAD hat sich während des Writes bewegt', {
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
