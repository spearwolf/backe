import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { BackeError } from '../core/errors.ts';

export type GitOptions = {
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
  input?: string;
  okExitCodes?: readonly number[];
};

export type GitResult = { stdout: string; stderr: string; exitCode: number };

function startFailure(args: readonly string[], error: unknown): BackeError {
  const cause = error instanceof Error ? error.message : String(error);
  return new BackeError('unexpected', `git konnte nicht gestartet werden: ${cause}`, {
    details: { args, cause },
  });
}

/** Führt das System-git aus; Ausgabe wird vollständig gepuffert (UTF-8). */
export function git(args: readonly string[], opts: GitOptions): Promise<GitResult> {
  const merged: Record<string, string | undefined> = { ...process.env, ...opts.env };
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) env[key] = value;
  }
  env.LC_ALL = 'C';
  env.GIT_TERMINAL_PROMPT = '0';

  return new Promise<GitResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('git', [...args], { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      // spawn wirft manche Fehler (z. B. ENOTDIR) synchron statt per error-Event.
      reject(startFailure(args, error));
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // Ein vorzeitig beendetes git schließt stdin; das ist kein eigener Fehler.
    child.stdin.on('error', () => {});

    let spawnFailed = false;
    const onSpawnError = (error: NodeJS.ErrnoException): void => {
      spawnFailed = true;
      if (error.code !== 'ENOENT') {
        reject(startFailure(args, error));
        return;
      }
      // ENOENT meldet spawn sowohl für fehlendes Binary als auch für fehlendes cwd.
      stat(opts.cwd).then(
        () =>
          reject(
            new BackeError('unexpected', 'git nicht gefunden', {
              hint: 'git installieren; backe doctor prüft die Voraussetzungen.',
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
      // Nach einem Startfehler folgt close mit negativem Code; der Fehler gehört dem error-Handler.
      if (spawnFailed) return;
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === null) {
        reject(
          new BackeError(
            'unexpected',
            `git ${args[0]} durch Signal beendet (${signal ?? 'unbekannt'})`,
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
            `git ${args[0]} fehlgeschlagen (Exit ${exitCode}): ${firstLine}`,
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
