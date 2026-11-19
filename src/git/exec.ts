import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { BackeError } from '../core/errors.ts';

export type GitEnv = Readonly<Record<string, string | undefined>>;

export type GitOptions = {
  cwd: string;
  env?: GitEnv;
  input?: string;
  okExitCodes?: readonly number[];
  /** Bricht den Aufruf nach so vielen Millisekunden ab (SIGKILL) und meldet `unexpected`. */
  timeoutMs?: number;
};

export type GitResult = { stdout: string; stderr: string; exitCode: number };
export type GitBytesResult = { stdout: Buffer; stderr: string; exitCode: number };

type Bin = 'git' | 'ssh-keygen';

function startFailure(bin: Bin, args: readonly string[], error: unknown): BackeError {
  const cause = error instanceof Error ? error.message : String(error);
  return new BackeError('unexpected', `${bin} konnte nicht gestartet werden: ${cause}`, {
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
  const merged: Record<string, string | undefined> = { ...inherited, ...opts.env };
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
    // Sofort ablehnen statt auf `close` zu warten: Enkelprozesse (ssh, Remote-Helper) halten die Pipes offen.
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGKILL');
            reject(
              new BackeError(
                'unexpected',
                `${label(bin, args)}: Zeitüberschreitung nach ${opts.timeoutMs} ms`,
                { details: { args, timeoutMs: opts.timeoutMs } },
              ),
            );
          }, opts.timeoutMs);
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
      if (error.code !== 'ENOENT') {
        reject(startFailure(bin, args, error));
        return;
      }
      // ENOENT meldet spawn sowohl für fehlendes Binary als auch für fehlendes cwd.
      stat(opts.cwd).then(
        () =>
          reject(
            new BackeError('unexpected', `${bin} nicht gefunden`, {
              hint: `${bin === 'git' ? 'git' : 'openssh'} installieren; backe doctor prüft die Voraussetzungen.`,
            }),
          ),
        () =>
          reject(
            new BackeError('unexpected', `Arbeitsverzeichnis nicht gefunden: ${opts.cwd}`, {
              details: { args, cwd: opts.cwd },
            }),
          ),
      );
    };

    child.on('error', onSpawnError);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // Nach einem Startfehler folgt close mit negativem Code; der Fehler gehört dem error-Handler.
      if (spawnFailed) return;
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === null) {
        reject(
          new BackeError(
            'unexpected',
            `${label(bin, args)} durch Signal beendet (${signal ?? 'unbekannt'})`,
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
          new BackeError(
            'unexpected',
            `${label(bin, args)} fehlgeschlagen (Exit ${exitCode}): ${firstLine}`,
            {
              details: { args, exitCode, stderr },
            },
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.end(opts.input ?? '');
  });
}
