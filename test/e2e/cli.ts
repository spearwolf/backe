import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type { Env } from '../../src/context/paths.ts';

// Ein E2E-Test startet nacheinander viele CLI-Prozesse samt Git-Aufrufen; auf CI-Runnern
// reichen dafür die 5 s des Vitest-Standards nicht. Gilt für jede Testdatei, die diesen
// Helfer importiert.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

export const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

/**
 * Git-Isolation und Ausgabesprache des Testlaufs, die jeder CLI-Aufruf erbt; `NO_COLOR` setzen
 * die Tests selbst. Ein Test, der eine andere Sprache will, setzt `BACKE_LANG` in `env`.
 */
const INHERITED = [
  'PATH',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'XDG_CONFIG_HOME',
  'BACKE_LANG',
] as const;

export type CliResult = { stdout: string; stderr: string; code: number };

export type CliBytesResult = { stdout: Buffer; stderr: string; code: number };

/** Genau `env` plus die Git-Isolation des Testlaufs, als Umgebung eines Kindprozesses. */
export function childEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) out[name] = value;
  }
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** Führt `node dist/cli.js` mit genau `opts.env` (plus Git-Isolation) in `opts.cwd` aus. */
export async function cli(
  args: string[],
  opts: { env: Env; cwd: string; input?: string },
): Promise<CliResult> {
  const r = await cliBytes(args, opts);
  return { stdout: r.stdout.toString('utf8'), stderr: r.stderr, code: r.code };
}

/** Wie `cli`, aber stdout als unveränderte Bytes (für Binärinhalt). */
export function cliBytes(
  args: string[],
  opts: { env: Env; cwd: string; input?: string },
): Promise<CliBytesResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: opts.cwd,
      env: childEnv(opts.env),
    });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout: Buffer.concat(out), stderr, code: code ?? -1 }));
    child.stdin.end(opts.input ?? '');
  });
}

/**
 * Ersetzt jede Zeichenkette aus `names` (Schlüssel) durch ihren Platzhalter (Wert), längste zuerst,
 * damit ein Pfad vor seinem Präfix ersetzt wird; danach Zeitstempel → `<ts>`, 40-Hex → `<sha>`.
 */
export function normalize(text: string, names: Record<string, string>): string {
  let out = text;
  const keys = Object.keys(names).sort((a, b) => b.length - a.length);
  for (const key of keys) out = out.split(key).join(names[key] as string);
  return out
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, '<ts>')
    .replace(/\b[0-9a-f]{40}\b/g, '<sha>');
}

/** Ein Aufruf als Golden-Text: Exit-Code, stdout und stderr, normalisiert. */
export function transcript(r: CliResult, names: Record<string, string>): string {
  return normalize(`[exit ${r.code}]\n[stdout]\n${r.stdout}[stderr]\n${r.stderr}`, names);
}
