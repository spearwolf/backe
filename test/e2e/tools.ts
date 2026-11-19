/** Gemeinsamer Aufbau der E2E-Tests für Anhänge, Hand-Edits, Batch und Editor (M5b). */
import { fileURLToPath } from 'node:url';
import type { Env } from '../../src/context/paths.ts';
import { issueDir } from '../../src/store/layout.ts';
import { tempDir } from '../helpers/backlog.ts';
import { type TestBacklog, testBacklog } from '../helpers/git.ts';
import { type CliResult, cli, cliBytes, normalize } from './cli.ts';

export type Tools = {
  b: TestBacklog;
  env: Env;
  cwd: string;
  names: Record<string, string>;
  /** Ein Issue »Erstes«, per CLI angelegt. */
  id: string;
};

export const editor = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/editors/${name}`, import.meta.url));

export const run = (
  t: Pick<Tools, 'env' | 'cwd'>,
  args: string[],
  extra: { env?: Env; input?: string } = {},
): Promise<CliResult> =>
  cli(args, {
    env: { ...t.env, ...extra.env },
    cwd: t.cwd,
    ...(extra.input === undefined ? {} : { input: extra.input }),
  });

export const runBytes = (t: Pick<Tools, 'env' | 'cwd'>, args: string[]) =>
  cliBytes(args, { env: t.env, cwd: t.cwd });

export const ok = (r: CliResult): string => {
  expect({ stderr: r.stderr, code: r.code }).toEqual({ stderr: '', code: 0 });
  return r.stdout;
};

export const errorOf = (r: CliResult) =>
  (
    JSON.parse(r.stderr) as {
      error: { code: string; message: string; hint?: string; details?: Record<string, unknown> };
    }
  ).error;

export async function setupTools(): Promise<Tools> {
  const b = await testBacklog();
  const cwd = await tempDir();
  const env: Env = { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1' };
  const t = { env, cwd };
  const id = ok(await run(t, ['new', '-t', 'Erstes'])).trim();
  const names: Record<string, string> = {
    [b.root]: '<root>',
    [b.env.HOME as string]: '<home>',
    [b.env.BACKE_HOME as string]: '<backe>',
    [cwd]: '<cwd>',
    [issueDir(id)]: '<issue-dir>',
    [id]: '<id>',
  };
  return { b, env, cwd, names, id };
}

export const norm = (t: Tools, text: string): string => normalize(text, t.names);
