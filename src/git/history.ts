/**
 * Lesende Primitive über die Historie für `verify` (backe.md §2.13). Revisionen stehen hinter
 * `--end-of-options`, Objekte werden NUL-getrennt über `cat-file -Z` gelesen.
 */
import { BackeError } from '../core/errors.ts';
import { git, gitBytes } from './exec.ts';

const USER_FILE = /^users\/([^/]+)\.md$/;
const OBJECT_HEADER = /^([0-9a-f]+) ([a-z]+) (\d+)$/;

/** Für jeden Aufruf hier: Replace-Refs (`git replace`) schieben verify keine anderen Objekte unter. */
const ENV = { GIT_NO_REPLACE_OBJECTS: '1' } as const;

/** `git log` ohne `log.showSignature` aus der User-Config, das die Ausgabe verändern würde. */
const LOG = ['-c', 'log.showSignature=false', 'log'] as const;

/** `gpgsig` ist die erste Zeile des Signatur-Headers (`gpgsig-sha256` bei SHA-256), sonst fehlt er. */
export type CommitInfo = {
  sha: string;
  parents: string[];
  message: string;
  gpgsig: string | undefined;
};
export type Signature = { status: string; fingerprint: string; principal: string };
export type RawChange = {
  path: string;
  status: 'A' | 'M' | 'D' | 'T';
  oldMode: string;
  newMode: string;
};
export type TreeEntry = { mode: string; type: string; oid: string; name: string };

/** Handles, deren `users/<handle>.md` in der Historie bis `rev` irgendwann gelöscht wurde. */
export async function removedHandles(wc: string, rev: string): Promise<Set<string>> {
  const { stdout } = await git(
    [
      ...LOG,
      '--format=',
      '--name-only',
      '-z',
      '--diff-filter=D',
      '--end-of-options',
      rev,
      '--',
      'users/',
    ],
    { cwd: wc, env: { ...ENV, GIT_LITERAL_PATHSPECS: '1' } },
  );
  const handles = new Set<string>();
  for (const entry of stdout.split('\0')) {
    const handle = USER_FILE.exec(entry.trim())?.[1];
    if (handle !== undefined) handles.add(handle);
  }
  return handles;
}

type CatObject = { oid: string; type: string; content: Buffer | undefined };

const truncated = () => new BackeError('unexpected', 'Ausgabe von git cat-file ist abgeschnitten');

/**
 * Zerlegt die Ausgabe von `cat-file --batch[-check] -Z` zu `specs`; fehlende oder mehrdeutige
 * Spezifikationen fehlen in der Map. Endet die Ausgabe vor dem letzten Eintrag → `unexpected`.
 */
export function parseCatFile(
  stdout: Buffer,
  specs: readonly string[],
  withContent: boolean,
): Map<string, CatObject> {
  const found = new Map<string, CatObject>();
  let pos = 0;
  for (const spec of specs) {
    const end = stdout.indexOf(0, pos);
    if (end < 0) throw truncated();
    const header = OBJECT_HEADER.exec(stdout.toString('utf8', pos, end));
    pos = end + 1;
    if (header === null) continue;
    const [, oid = '', type = '', size = '0'] = header;
    let content: Buffer | undefined;
    if (withContent) {
      if (pos + Number(size) + 1 > stdout.length) throw truncated();
      content = stdout.subarray(pos, pos + Number(size));
      pos += Number(size) + 1;
    }
    found.set(spec, { oid, type, content });
  }
  return found;
}

/** `cat-file --batch[-check] -Z` über `specs`. */
async function catFile(
  wc: string,
  specs: readonly string[],
  withContent: boolean,
): Promise<Map<string, CatObject>> {
  if (specs.length === 0) return new Map();
  const { stdout } = await gitBytes(['cat-file', withContent ? '--batch' : '--batch-check', '-Z'], {
    cwd: wc,
    env: ENV,
    input: specs.map((s) => `${s}\0`).join(''),
  });
  return parseCatFile(stdout, specs, withContent);
}

/**
 * Commits von `to` aus, älteste zuerst (`from` exklusiv). Die Reihenfolge kommt aus `rev-list
 * --topo-order` und hängt nicht an Commit-Daten; die Nachricht aus dem Commit-Objekt, damit kein
 * Zeichen darin die Zerlegung stört.
 */
export async function listCommits(
  wc: string,
  range: { from: string | undefined; to: string },
): Promise<CommitInfo[]> {
  const revs = range.from === undefined ? [range.to] : [range.to, `^${range.from}`];
  const { stdout } = await git(
    ['rev-list', '--topo-order', '--reverse', '--parents', '--end-of-options', ...revs, '--'],
    { cwd: wc, env: ENV },
  );
  const lines = stdout.split('\n').filter((l) => l !== '');
  const objects = await catFile(
    wc,
    lines.map((l) => l.split(' ')[0] as string),
    true,
  );
  return lines.map((line) => {
    const [sha = '', ...parents] = line.split(' ');
    const raw = objects.get(sha)?.content ?? Buffer.alloc(0);
    const body = raw.indexOf('\n\n');
    const headers = raw.toString('utf8', 0, body < 0 ? raw.length : body).split('\n');
    const prefix = sha.length === 64 ? 'gpgsig-sha256 ' : 'gpgsig ';
    const gpgsig = headers.find((h) => h.startsWith(prefix))?.slice(prefix.length);
    return { sha, parents, message: body < 0 ? '' : raw.toString('utf8', body + 2), gpgsig };
  });
}

/** Signaturstatus je Commit, geprüft gegen die `allowed_signers`-Datei `allowedSigners`. */
export async function signatures(
  wc: string,
  shas: readonly string[],
  allowedSigners: string,
): Promise<Map<string, Signature>> {
  const result = new Map<string, Signature>();
  if (shas.length === 0) return result;
  const { stdout } = await git(
    [
      '-c',
      `gpg.ssh.allowedSignersFile=${allowedSigners}`,
      ...LOG,
      '--no-walk=unsorted',
      '--stdin',
      '--format=%H%x00%G?%x00%GK%x00%GS%x1e',
    ],
    { cwd: wc, env: ENV, input: `${shas.join('\n')}\n` },
  );
  for (const record of stdout.split('\x1e')) {
    const [sha = '', status = '', fingerprint = '', principal = ''] = record
      .replace(/^\n/, '')
      .split('\0');
    if (sha !== '') result.set(sha, { status, fingerprint, principal });
  }
  return result;
}

/** Änderungen von `parent` (ohne: leerer Baum) nach `sha`, rekursiv, ohne Rename-Erkennung. */
export async function treeChanges(
  wc: string,
  parent: string | undefined,
  sha: string,
): Promise<RawChange[]> {
  const revs =
    parent === undefined ? ['--root', '--end-of-options', sha] : ['--end-of-options', parent, sha];
  const { stdout } = await git(
    ['diff-tree', '-r', '-z', '--no-renames', '--raw', '--no-commit-id', ...revs],
    { cwd: wc, env: ENV },
  );
  const fields = stdout.split('\0');
  const changes: RawChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [oldMode = '', newMode = '', , , status = ''] = (fields[i] as string).slice(1).split(' ');
    changes.push({
      path: fields[i + 1] as string,
      status: status as RawChange['status'],
      oldMode,
      newMode,
    });
  }
  return changes;
}

/** Blob-Inhalte je `<rev>:<pfad>` (oder Objekt-ID); fehlend oder kein Blob → `null`. */
export async function readBlobs(
  wc: string,
  specs: readonly string[],
): Promise<Map<string, Buffer | null>> {
  const objects = await catFile(wc, specs, true);
  return new Map(
    specs.map((spec) => {
      const obj = objects.get(spec);
      return [spec, obj?.type === 'blob' ? (obj.content as Buffer) : null];
    }),
  );
}

/** Objekt-ID und -Typ je Spezifikation (`<rev>:<pfad>`); fehlend → `undefined`. */
export async function objectInfo(
  wc: string,
  specs: readonly string[],
): Promise<Map<string, { oid: string; type: string } | undefined>> {
  const objects = await catFile(wc, specs, false);
  return new Map(
    specs.map((spec) => {
      const obj = objects.get(spec);
      return [spec, obj && { oid: obj.oid, type: obj.type }];
    }),
  );
}

/** Einträge eines Baums (nicht rekursiv). */
export async function listTree(wc: string, tree: string): Promise<TreeEntry[]> {
  const { stdout } = await git(['ls-tree', '-z', '--end-of-options', tree], {
    cwd: wc,
    env: ENV,
  });
  return stdout
    .split('\0')
    .filter((e) => e !== '')
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [mode = '', type = '', oid = ''] = entry.slice(0, tab).split(' ');
      return { mode, type, oid, name: entry.slice(tab + 1) };
    });
}

export async function isAncestor(wc: string, a: string, b: string): Promise<boolean> {
  const { exitCode } = await git(['merge-base', '--is-ancestor', '--end-of-options', a, b], {
    cwd: wc,
    env: ENV,
    okExitCodes: [1],
  });
  return exitCode === 0;
}

/** Bester gemeinsamer Vorfahre von `a` und `b`; keiner oder eine Revision fehlt → `undefined`. */
export async function mergeBase(wc: string, a: string, b: string): Promise<string | undefined> {
  const { stdout, exitCode } = await git(['merge-base', '--end-of-options', a, b], {
    cwd: wc,
    env: ENV,
    okExitCodes: [1, 128],
  });
  return exitCode === 0 ? stdout.trim() : undefined;
}

/** Wurzel-Commits der Historie von `rev`. */
export async function rootCommits(wc: string, rev: string): Promise<string[]> {
  const { stdout } = await git(['rev-list', '--max-parents=0', '--end-of-options', rev, '--'], {
    cwd: wc,
    env: ENV,
  });
  return stdout.split('\n').filter((l) => l !== '');
}

/** Volle Commit-ID von `rev`; keine Revision oder kein Commit → `not_found`. */
export async function resolveCommit(wc: string, rev: string): Promise<string> {
  const { stdout } = await git(
    ['rev-parse', '-q', '--verify', '--end-of-options', `${rev}^{commit}`],
    { cwd: wc, env: ENV, okExitCodes: [1, 128] },
  );
  const sha = stdout.trim();
  if (sha === '') throw new BackeError('not_found', `Revision ${rev} nicht gefunden`);
  return sha;
}
