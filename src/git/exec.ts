import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { BackeError } from '../core/errors.ts';
import { m } from './exec.messages.ts';

export type GitEnv = Readonly<Record<string, string | undefined>>;

export type GitOptions = {
  cwd: string;
  env?: GitEnv;
  /** Für stdin; Bytes etwa für `hash-object --stdin` mit Binärinhalt. */
  input?: string | Uint8Array;
  okExitCodes?: readonly number[];
  /**
   * Bricht den Aufruf nach so vielen Millisekunden ab und meldet `unexpected`. SIGKILL trifft den
   * Prozess samt allen Nachfahren (ssh, Remote-Helper); er bleibt in der Prozessgruppe von backe,
   * damit Ctrl-C ihn erreicht und ssh sein Terminal für Rückfragen behält.
   */
  timeoutMs?: number;
};

export type GitResult = { stdout: string; stderr: string; exitCode: number };
export type GitBytesResult = { stdout: Buffer; stderr: string; exitCode: number };

type Bin = 'git' | 'ssh-keygen';

function startFailure(bin: Bin, args: readonly string[], error: unknown): BackeError {
  const cause = error instanceof Error ? error.message : String(error);
  return new BackeError('unexpected', m.startFailed(bin, cause), {
    details: { args, cause },
  });
}

/**
 * Variablen, mit denen ein aufrufendes git (z. B. in einem Hook) sein Repo an Kindprozesse
 * weitergibt; Liste aus `git rev-parse --local-env-vars`. Geerbt würden sie jedes `cwd` überstimmen.
 */
const REPO_LOCAL_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
] as const;

/** Unterbefehl für Meldungen: erstes Argument, das weder Option noch Wert von `-c`/`-C` ist. */
function subcommand(args: readonly string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '-c' || arg === '-C') {
      i++;
      continue;
    }
    if (!arg.startsWith('-')) return `git ${arg}`;
  }
  return 'git';
}

/** Name für Meldungen: bei git der Unterbefehl, sonst das Binary selbst. */
function label(bin: Bin, args: readonly string[]): string {
  return bin === 'git' ? subcommand(args) : bin;
}

/** Variablen, die ein Git-Aufruf für Signieren und SSH-Transport braucht. */
export function transportEnv(env: GitEnv): Record<string, string | undefined> {
  return {
    HOME: env.HOME,
    SSH_AUTH_SOCK: env.SSH_AUTH_SOCK,
    GIT_SSH_COMMAND: env.GIT_SSH_COMMAND,
  };
}

/** Pfade je Aufruf, wenn eine Pfadliste als Argumente an git geht: weit unter jedem ARG_MAX. */
export const PATH_CHUNK = 1000;

/** Ruft `fn` nacheinander mit Blöcken von höchstens `size` Elementen auf, in Reihenfolge. */
export async function forChunks<T>(
  items: readonly T[],
  size: number,
  fn: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/**
 * Alle Nachfahren von `root` (Kinder, Enkel, …) aus der Ausgabe von `ps -A -o pid=,ppid=`;
 * `root` selbst gehört nicht dazu.
 */
export function descendantsOf(ps: string, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const line of ps.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const list = children.get(ppid as number) ?? [];
    list.push(pid as number);
    children.set(ppid as number, list);
  }
  const out: number[] = [];
  const queue = [root];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of children.get(pid) ?? []) {
      if (child === root || out.includes(child)) continue;
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * SIGKILL an `pid` und alle seine Nachfahren. Der Baum wird vorher erfasst: Stirbt ein Elternteil,
 * hängt init seine Kinder um, und sie wären über die PPID nicht mehr zu finden. Synchron, weil es
 * auch im `exit`-Listener läuft; scheitert `ps`, trifft es nur `pid`.
 */
function killTree(pid: number): void {
  let tree: number[] = [];
  try {
    tree = descendantsOf(execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }), pid);
  } catch {
    // ohne `ps` bleibt nur das Kind selbst
  }
  for (const target of [pid, ...tree]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // schon beendet
    }
  }
}

/** Kinder laufender Aufrufe mit `timeoutMs`; beim Beenden von backe fallen sie mit. */
const openChildren = new Set<number>();
let exitHookInstalled = false;

/** Beendet alle noch offenen Kinder samt Nachfahren; läuft als `exit`-Listener. */
export function killOpenChildren(): void {
  for (const pid of openChildren) killTree(pid);
  openChildren.clear();
}

function trackChild(pid: number): void {
  if (!exitHookInstalled) {
    process.on('exit', killOpenChildren);
    exitHookInstalled = true;
  }
  openChildren.add(pid);
}

/** Führt das System-git aus; Ausgabe wird vollständig gepuffert (UTF-8). */
export async function git(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  return decoded(await run('git', args, opts));
}

/** Wie `git`, aber stdout bleibt Bytes (z. B. Blob-Inhalte aus `cat-file`). */
export function gitBytes(args: readonly string[], opts: GitOptions): Promise<GitBytesResult> {
  return run('git', args, opts);
}

/** Führt ssh-keygen aus; gleiche Fehlerformen wie `git`, Meldungen nennen `ssh-keygen`. */
export async function sshKeygen(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  return decoded(await run('ssh-keygen', args, opts));
}

function decoded(r: GitBytesResult): GitResult {
  return { stdout: r.stdout.toString('utf8'), stderr: r.stderr, exitCode: r.exitCode };
}

function run(bin: Bin, args: readonly string[], opts: GitOptions): Promise<GitBytesResult> {
  const inherited: Record<string, string | undefined> = { ...process.env };
  for (const name of REPO_LOCAL_ENV) delete inherited[name];
  // Ohne optionale Locks frischt ein lesendes `status` den Index nicht auf und kollidiert so nicht
  // mit einem parallelen Write; ein explizites `opts.env` darf es anders wollen.
  const defaults = bin === 'git' ? { GIT_OPTIONAL_LOCKS: '0' } : {};
  const merged: Record<string, string | undefined> = { ...inherited, ...defaults, ...opts.env };
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) env[key] = value;
  }
  env.LC_ALL = 'C';
  env.GIT_TERMINAL_PROMPT = '0';

  return new Promise<GitBytesResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, [...args], { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      // spawn wirft manche Fehler (z. B. ENOTDIR) synchron statt per error-Event.
      reject(startFailure(bin, args, error));
      return;
    }
    // Nur Aufrufe mit Frist kann backe selbst abbrechen; nur sie räumt der `exit`-Listener ab.
    const tracked = opts.timeoutMs === undefined ? undefined : child.pid;
    if (tracked !== undefined) trackChild(tracked);
    const release = (): void => {
      if (tracked !== undefined) openChildren.delete(tracked);
    };
    // Sofort ablehnen statt auf `close` zu warten: Enkelprozesse (ssh, Remote-Helper) halten die Pipes offen.
    const { timeoutMs } = opts;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            if (tracked !== undefined) killTree(tracked);
            release();
            reject(
              new BackeError('unexpected', m.timedOut(label(bin, args), timeoutMs), {
                details: { args, timeoutMs },
              }),
            );
          }, timeoutMs);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // Ein vorzeitig beendetes git schließt stdin; das ist kein eigener Fehler.
    child.stdin.on('error', () => {});

    let spawnFailed = false;
    const onSpawnError = (error: NodeJS.ErrnoException): void => {
      spawnFailed = true;
      clearTimeout(timer);
      release();
      if (error.code !== 'ENOENT') {
        reject(startFailure(bin, args, error));
        return;
      }
      // ENOENT meldet spawn sowohl für fehlendes Binary als auch für fehlendes cwd.
      stat(opts.cwd).then(
        () =>
          reject(
            new BackeError('unexpected', m.binNotFound(bin), {
              hint: m.binNotFoundHint(bin === 'git' ? 'git' : 'openssh'),
            }),
          ),
        () =>
          reject(
            new BackeError('unexpected', m.cwdNotFound(opts.cwd), {
              details: { args, cwd: opts.cwd },
            }),
          ),
      );
    };

    child.on('error', onSpawnError);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      release();
      // Nach einem Startfehler folgt close mit negativem Code; der Fehler gehört dem error-Handler.
      if (spawnFailed) return;
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === null) {
        reject(
          new BackeError(
            'unexpected',
            m.killedBySignal(label(bin, args), signal ?? m.unknownSignal),
            {
              details: { args, signal, stderr },
            },
          ),
        );
        return;
      }
      const exitCode = code;
      if (exitCode !== 0 && !(opts.okExitCodes ?? []).includes(exitCode)) {
        const firstLine = stderr.split('\n')[0] ?? '';
        reject(
          new BackeError('unexpected', m.failed(label(bin, args), exitCode, firstLine), {
            details: { args, exitCode, stderr },
          }),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.end(opts.input ?? '');
  });
}
