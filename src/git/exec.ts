import { spawn } from 'node:child_process';
import { BackeError } from '../core/errors.ts';

export type GitOptions = {
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
  input?: string;
  okExitCodes?: readonly number[];
};

export type GitResult = { stdout: string; stderr: string; exitCode: number };

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
    const child = spawn('git', [...args], { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // Ein vorzeitig beendetes git schließt stdin; das ist kein eigener Fehler.
    child.stdin.on('error', () => {});

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new BackeError('unexpected', 'git nicht gefunden', {
            hint: 'git installieren; backe doctor prüft die Voraussetzungen.',
          }),
        );
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
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
