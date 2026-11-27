import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, vi } from 'vitest';
import { type Env, type Homes, resolveHomes } from '../../src/context/paths.ts';
import { setIdentity } from '../../src/context/registry.ts';
import {
  type ContextFlags,
  type ResolvedContext,
  resolveContext,
} from '../../src/context/resolve.ts';
import { git, sshKeygen } from '../../src/git/exec.ts';
import { stateDir } from '../../src/git/local-state.ts';
import {
  formatCommitMessage,
  parseCommitMessage,
  TRAILER_ACTOR,
  TRAILER_OP,
} from '../../src/git/message.ts';
import { initBacklog } from '../../src/services/init.ts';
import { ensureWorkingCopy } from '../../src/services/working-copy.ts';
import { executeWrite } from '../../src/services/write.ts';
import { BACKLOG_CONFIG } from '../../src/store/layout.ts';
import { tempDir } from './backlog.ts';

// Tests auf echten Git-Repos (Klone, Sync-Runden, Replay) starten viele Git-Prozesse; mit
// Coverage reichen die 5 s des Vitest-Standards auf den CI-Runnern nicht, auf macOS liegen
// schon einfache Claim-Tests bei 4–5 s. Gilt für jede Testdatei, die diesen Helfer importiert.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

export type TestKey = { priv: string; pub: string; line: string };

let keyDir: Promise<string> | undefined;
const keys = new Map<string, Promise<TestKey>>();

afterAll(async () => {
  const dir = await keyDir;
  keyDir = undefined;
  keys.clear();
  if (dir) await rm(dir, { recursive: true, force: true });
});

export async function revParse(wc: string, rev: string): Promise<string> {
  return (await git(['rev-parse', rev], { cwd: wc })).stdout.trim();
}

/** Zeilen von `git status --short` (ohne leere Zeilen). */
export async function statusShort(wc: string): Promise<string[]> {
  const { stdout } = await git(['status', '--short', '--untracked-files=all'], { cwd: wc });
  return stdout.split('\n').filter((line) => line !== '');
}

/** Signaturstatus (`%G?`) und Principal (`%GS`) von `rev`, geprüft gegen eine `allowed_signers`-Datei aus `keys`. */
export async function sigOf(
  wc: string,
  rev: string,
  keys: Readonly<Record<string, TestKey>>,
): Promise<[status: string, principal: string]> {
  const dir = await mkdtemp(join(tmpdir(), 'backe-signers-'));
  try {
    const file = join(dir, 'allowed_signers');
    const lines = Object.entries(keys).map(([name, key]) => `${name} ${key.line}`);
    await writeFile(file, `${lines.join('\n')}\n`);
    const { stdout } = await git(
      [
        '-c',
        'gpg.format=ssh',
        '-c',
        `gpg.ssh.allowedSignersFile=${file}`,
        'log',
        '-1',
        '--format=%G?%x00%GS',
        rev,
      ],
      { cwd: wc },
    );
    const [status = '', principal = ''] = stdout.replace(/\n$/, '').split('\0');
    return [status, principal];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** ed25519-Schlüsselpaar je Name und Testdatei; einmal erzeugt, nach der Datei entfernt. */
export function testKey(name: string): Promise<TestKey> {
  let key = keys.get(name);
  if (!key) {
    keyDir ??= mkdtemp(join(tmpdir(), 'backe-keys-'));
    const dirPromise = keyDir;
    key = (async () => {
      const dir = await dirPromise;
      const priv = join(dir, name);
      await sshKeygen(['-q', '-t', 'ed25519', '-N', '', '-C', `${name}@test`, '-f', priv], {
        cwd: dir,
      });
      const pub = `${priv}.pub`;
      return { priv, pub, line: (await readFile(pub, 'utf8')).split('\n')[0] as string };
    })();
    keys.set(name, key);
  }
  return key;
}

/** Leeres bares Repository (Branch `main`) als Remote; wird mit dem Temp-Verzeichnis aufgeräumt. */
export async function bareRemote(): Promise<string> {
  const dir = join(await tempDir(), 'remote.git');
  await git(['init', '--bare', '-q', '-b', 'main', dir], { cwd: tmpdir() });
  return dir;
}

export type TestBacklog = {
  homes: Homes;
  env: Env;
  root: string;
  handle: string;
  key: TestKey;
  remote?: string;
  context(flags?: ContextFlags, cwd?: string): Promise<ResolvedContext>;
};

/**
 * Frisch initialisierter Backlog (verwalteter Klon) in einem Temp-Home, optional mit `bareRemote`.
 * `context()` löst als `handle` auf, solange `flags.as` nichts anderes sagt.
 */
export async function testBacklog(
  opts: { handle?: string; name?: string; userName?: string; remote?: boolean } = {},
): Promise<TestBacklog> {
  const handle = opts.handle ?? 'spw';
  const name = opts.name ?? 'acme';
  const tmp = await tempDir();
  const env: Env = { HOME: join(tmp, 'home'), BACKE_HOME: join(tmp, 'backe') };
  const homes = resolveHomes(env, tmp);
  const key = await testKey(handle);
  const remote = opts.remote ? await bareRemote() : undefined;
  const { root } = await initBacklog({
    homes,
    env,
    name,
    prefix: 'bk',
    handle,
    key: key.priv,
    ...(opts.userName === undefined ? {} : { userName: opts.userName }),
    ...(remote === undefined ? {} : { remote }),
  });
  return {
    homes,
    env,
    root,
    handle,
    key,
    ...(remote === undefined ? {} : { remote }),
    context: (flags = {}, cwd) =>
      resolveContext({ cwd: cwd ?? root, env, flags: { as: handle, ...flags } }),
  };
}

/** Commits ab `HEAD`, neueste zuerst: Subject und die Trailer `Backe-Actor` / `Backe-Op`. */
export async function logTrailers(
  wc: string,
): Promise<{ subject: string; actor?: string; op?: string }[]> {
  const { stdout } = await git(['log', '--format=%B%x00'], { cwd: wc });
  return stdout
    .split('\0')
    .filter((raw) => raw.trim() !== '')
    .map((raw) => {
      // `--format` trennt Einträge mit einem Newline; er gehört nicht zur Message.
      const { subject, trailers } = parseCommitMessage(raw.replace(/^\n/, ''));
      const actor = trailers.get(TRAILER_ACTOR)?.[0];
      const op = trailers.get(TRAILER_OP)?.[0];
      return {
        subject,
        ...(actor === undefined ? {} : { actor }),
        ...(op === undefined ? {} : { op }),
      };
    });
}

export type RawCommitSpec = {
  /**
   * Pfad → Inhalt; `null` löscht den Pfad, `{ symlink }` legt einen Symlink (Modus 120000) an,
   * `{ executable }` eine ausführbare Datei (Modus 100755).
   */
  files: Record<string, string | null | { symlink: string } | { executable: string }>;
  key?: TestKey;
  /** Author- und Committer-Datum (sonst jetzt). */
  date?: string;
  /** Mehrere Handles ergeben mehrere `Backe-Actor`-Trailer. */
  actor?: string | string[];
  op?: string;
  subject?: string;
  parents?: string[];
};

/**
 * Commit an `executeWrite` vorbei (ohne dessen Prüfungen) über Plumbing; ohne `key` unsigniert.
 * Setzt `HEAD` und Arbeitsbaum auf den neuen Commit.
 */
export async function rawCommit(wc: string, spec: RawCommitSpec): Promise<string> {
  const head = (
    await git(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: wc, okExitCodes: [0, 1] })
  ).stdout.trim();
  const parents = spec.parents ?? (head === '' ? [] : [head]);
  const indexFile = join(await stateDir(wc), `raw-index-${randomBytes(6).toString('hex')}`);
  const env = { GIT_INDEX_FILE: indexFile, GIT_LITERAL_PATHSPECS: '1' };
  try {
    const base = parents[0];
    await git(base === undefined ? ['read-tree', '--empty'] : ['read-tree', base], {
      cwd: wc,
      env,
    });
    for (const [path, content] of Object.entries(spec.files)) {
      if (content === null) {
        await git(['update-index', '--force-remove', '--', path], { cwd: wc, env });
        continue;
      }
      if (typeof content === 'object' && 'executable' in content) {
        const blob = await git(['hash-object', '-w', '--stdin'], {
          cwd: wc,
          input: content.executable,
        });
        await git(
          ['update-index', '--add', '--cacheinfo', `100755,${blob.stdout.trim()},${path}`],
          { cwd: wc, env },
        );
        continue;
      }
      if (typeof content === 'object') {
        const link = await git(['hash-object', '-w', '--stdin'], {
          cwd: wc,
          input: content.symlink,
        });
        await git(
          ['update-index', '--add', '--cacheinfo', `120000,${link.stdout.trim()},${path}`],
          {
            cwd: wc,
            env,
          },
        );
        continue;
      }
      const abs = join(wc, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
      const blob = (await git(['hash-object', '-w', '--', abs], { cwd: wc })).stdout.trim();
      await git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], {
        cwd: wc,
        env,
      });
    }
    const tree = (await git(['write-tree'], { cwd: wc, env })).stdout.trim();
    const subject = spec.subject ?? 'raw';
    const trailers: [string, string][] = [];
    for (const actor of [spec.actor ?? []].flat()) trailers.push([TRAILER_ACTOR, actor]);
    if (spec.op !== undefined) trailers.push([TRAILER_OP, spec.op]);
    const signing = spec.key
      ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${spec.key.priv}`]
      : [];
    const created = await git(
      [
        ...signing,
        'commit-tree',
        ...(spec.key ? ['-S'] : []),
        tree,
        ...parents.flatMap((p) => ['-p', p]),
        '-F',
        '-',
      ],
      {
        cwd: wc,
        env: {
          GIT_AUTHOR_NAME: 'Raw',
          GIT_AUTHOR_EMAIL: 'raw@backe.invalid',
          GIT_COMMITTER_NAME: 'Raw',
          GIT_COMMITTER_EMAIL: 'raw@backe.invalid',
          ...(spec.date === undefined
            ? {}
            : { GIT_AUTHOR_DATE: spec.date, GIT_COMMITTER_DATE: spec.date }),
        },
        input: formatCommitMessage({ subject, trailers }),
      },
    );
    const sha = created.stdout.trim();
    await git(['update-ref', '-m', subject, 'HEAD', sha], { cwd: wc });
    await git(['reset', '-q', '--hard', sha], { cwd: wc });
    return sha;
  } finally {
    await rm(indexFile, { force: true });
  }
}

/**
 * Backlog mit Remote im Modus `verify: warn`, darauf ein unsignierter Commit, und der Agent
 * `claude-1` ohne eigene Arbeitskopie: Sein erster Write klont und meldet den Commit als
 * `<sha7>: unsigniert` in `verifyNotices`.
 */
export async function warnModeAgent(): Promise<{
  remote: TestBacklog;
  ctx: ResolvedContext;
  notice: string;
}> {
  const remote = await testBacklog({ remote: true });
  const spw = await remote.context();
  const config = await readFile(join(remote.root, '.backe/backlog.jsonc'), 'utf8');
  await executeWrite(spw, {
    kind: 'manual',
    subject: 'verify: warn',
    changes: [
      {
        path: '.backe/backlog.jsonc',
        content: config.replace(/\n}\n$/, ',\n  "verify": "warn"\n}\n'),
      },
    ],
  });
  const claude = await testKey('claude-1');
  await executeWrite(spw, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [claude.line],
    },
  });
  const bad = await rawCommit(remote.root, {
    files: { 'notes.md': 'x\n' },
    actor: 'spw',
    op: 'manual',
  });
  await git(['push', '-q', 'origin', 'main'], { cwd: remote.root });
  await setIdentity(remote.homes, 'acme', 'claude-1', claude.priv);
  const ctx = await remote.context({ as: 'claude-1', backlog: 'acme' });
  return { remote, ctx, notice: `${bad.slice(0, 7)}: unsigniert` };
}

/**
 * Backlog mit bare Remote und dem Agent `claude-1` (Operator `spw`) mit eigener Arbeitskopie;
 * beide stehen auf demselben gepushten Stand. `sync.mode` bleibt `auto`, gestartet wird nichts.
 */
export async function twoClones(): Promise<{
  remote: string;
  spw: TestBacklog & { ctx: ResolvedContext };
  agent: { ctx: ResolvedContext; wc: string };
}> {
  const spw = await testBacklog({ remote: true });
  const ctx = await spw.context();
  const claude = await testKey('claude-1');
  await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [claude.line],
    },
  });
  await git(['push', '-q', 'origin', 'main'], { cwd: spw.root });
  await setIdentity(spw.homes, 'acme', 'claude-1', claude.priv);
  const agentCtx = await spw.context({ as: 'claude-1', backlog: 'acme' });
  const { root: wc } = await ensureWorkingCopy(agentCtx, 'claude-1');
  return { remote: spw.remote as string, spw: { ...spw, ctx }, agent: { ctx: agentCtx, wc } };
}

/** Ein gültiger Admin-Commit von `b.handle` hängt `"<key>": <block>` an die Backlog-Config an. */
async function appendConfigBlock(
  b: TestBacklog,
  key: string,
  block: string,
  subject: string,
): Promise<void> {
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  const changed = config.replace(/\n}\n$/, `,\n  "${key}": ${block}\n}\n`);
  if (changed === config) throw new Error('Config ohne erwartetes Ende');
  await executeWrite(await b.context(), {
    kind: 'manual',
    subject,
    changes: [{ path: BACKLOG_CONFIG, content: changed }],
  });
}

/**
 * Ein gültiger Admin-Commit von `b.handle` setzt `sync.pull_interval` in der Backlog-Config; die
 * Config darf noch keinen `sync`-Block haben.
 */
export async function setPullInterval(b: TestBacklog, seconds: number): Promise<void> {
  await appendConfigBlock(
    b,
    'sync',
    `{ "pull_interval": ${seconds} }`,
    `pull_interval: ${seconds}`,
  );
}

/**
 * Ein gültiger Admin-Commit von `b.handle` setzt `attachments.lfs: true`; die Config darf noch
 * keinen `attachments`-Block haben. Der Commit selbst braucht kein git-lfs, solange die Config
 * davor `lfs` noch aus hat; Anhänge, die danach dazukommen, schon.
 */
export async function setAttachmentsLfs(b: TestBacklog): Promise<void> {
  await appendConfigBlock(b, 'attachments', '{ "lfs": true }', 'attachments.lfs: true');
}

/**
 * Ein gültiger Admin-Commit von `b.handle` setzt `attachments.max_bytes`; die Config darf noch
 * keinen `attachments`-Block haben.
 */
export async function setAttachmentsMaxBytes(b: TestBacklog, bytes: number): Promise<void> {
  await appendConfigBlock(
    b,
    'attachments',
    `{ "max_bytes": ${bytes} }`,
    `attachments.max_bytes: ${bytes}`,
  );
}
