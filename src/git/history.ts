/**
 * Lesende Primitive über die Historie für `verify` (backe.md §2.13). Revisionen stehen hinter
 * `--end-of-options`, Objekte werden NUL-getrennt über `cat-file -Z` gelesen.
 */
import { BackeError } from '../core/errors.ts';
import { git, gitBytes } from './exec.ts';

const USER_FILE = /^users\/([^/]+)\.md$/;
const OBJECT_HEADER = /^([0-9a-f]+) ([a-z]+) (\d+)$/;

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
      'log',
      '--format=',
      '--name-only',
      '-z',
      '--diff-filter=D',
      '--end-of-options',
      rev,
      '--',
      'users/',
    ],
    { cwd: wc, env: { GIT_LITERAL_PATHSPECS: '1' } },
  );
  const handles = new Set<string>();
  for (const entry of stdout.split('\0')) {
    const handle = USER_FILE.exec(entry.trim())?.[1];
    if (handle !== undefined) handles.add(handle);
  }
  return handles;
}

type CatObject = { oid: string; type: string; content: Buffer | undefined };

/** `cat-file --batch[-check] -Z`; fehlende oder mehrdeutige Spezifikationen fehlen in der Map. */
async function catFile(
  wc: string,
  specs: readonly string[],
  withContent: boolean,
): Promise<Map<string, CatObject>> {
  const found = new Map<string, CatObject>();
  if (specs.length === 0) return found;
  const { stdout } = await gitBytes(['cat-file', withContent ? '--batch' : '--batch-check', '-Z'], {
    cwd: wc,
    input: specs.map((s) => `${s}\0`).join(''),
  });
  let pos = 0;
  for (const spec of specs) {
    const end = stdout.indexOf(0, pos);
    const header = OBJECT_HEADER.exec(stdout.toString('utf8', pos, end));
    pos = end + 1;
    if (header === null) continue;
    const [, oid = '', type = '', size = '0'] = header;
    let content: Buffer | undefined;
    if (withContent) {
      content = stdout.subarray(pos, pos + Number(size));
      pos += Number(size) + 1;
    }
    found.set(spec, { oid, type, content });
  }
  return found;
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
    { cwd: wc },
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
      'log',
      '--no-walk=unsorted',
      '--stdin',
      '--format=%H%x00%G?%x00%GK%x00%GS%x1e',
    ],
    { cwd: wc, input: `${shas.join('\n')}\n` },
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
    { cwd: wc },
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
  const { stdout } = await git(['ls-tree', '-z', '--end-of-options', tree], { cwd: wc });
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
    okExitCodes: [1],
  });
  return exitCode === 0;
}

/** Wurzel-Commits der Historie von `rev`. */
export async function rootCommits(wc: string, rev: string): Promise<string[]> {
  const { stdout } = await git(['rev-list', '--max-parents=0', '--end-of-options', rev, '--'], {
    cwd: wc,
  });
  return stdout.split('\n').filter((l) => l !== '');
}

/** Volle Commit-ID von `rev`; keine Revision oder kein Commit → `not_found`. */
export async function resolveCommit(wc: string, rev: string): Promise<string> {
  const { stdout } = await git(
    ['rev-parse', '-q', '--verify', '--end-of-options', `${rev}^{commit}`],
    { cwd: wc, okExitCodes: [1, 128] },
  );
  const sha = stdout.trim();
  if (sha === '') throw new BackeError('not_found', `Revision ${rev} nicht gefunden`);
  return sha;
}
