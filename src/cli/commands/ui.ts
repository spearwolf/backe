/** `backe ui [-p | --port <n>] [--open]`: lokaler Webserver (ui.md §2.1), läuft bis SIGINT/SIGTERM. */
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { resolveStart } from '../../ui/context.ts';
import { createUiServer } from '../../ui/server.ts';
import { action, globalOpts, type Runtime, subcommand } from '../options.ts';
import { renderHints } from '../output.ts';
import { m } from './ui.messages.ts';

type Opts = { port?: string; open?: boolean };

const DEFAULT_PORT = 8002;

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!(port >= 0 && port <= 65535)) {
    throw new BackeError('validation', m.invalidPort(value), { hint: 'backe ui --port <n>' });
  }
  return port;
}

/** Übergibt die URL dem Browser-Starter der Plattform; scheitert das, bleibt es bei einem Hinweis. */
function openBrowser(url: string, stderr: (s: string) => void): void {
  const cmd =
    process.platform === 'linux' ? 'xdg-open' : process.platform === 'darwin' ? 'open' : undefined;
  if (cmd === undefined) {
    stderr(renderHints([m.openFailed('open')]));
    return;
  }
  const hint = () => stderr(renderHints([m.openFailed(cmd)]));
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  child.on('error', hint);
  child.on('exit', (code) => {
    if (code !== 0) hint();
  });
  child.unref();
}

/** Wartet auf das erste SIGINT oder SIGTERM und räumt beide Listener wieder ab. */
function untilSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.removeListener('SIGINT', done);
      process.removeListener('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

export function uiCommand(program: Command, rt: Runtime): void {
  subcommand(program, 'ui', m.description)
    .option('-p, --port <n>', m.portOption)
    .option('--open', m.openOption)
    .action((opts: Opts, cmd: Command) => {
      const { backlog, as } = globalOpts(cmd);
      return action(
        rt,
        async (env) => {
          const port = parsePort(opts.port);
          const input = {
            cwd: env.io.cwd,
            env: env.io.env,
            flags: {
              ...(backlog === undefined ? {} : { backlog }),
              ...(as === undefined ? {} : { as }),
            },
          };
          const start = await resolveStart(input);
          const server = createUiServer({ ...input, start, port });
          const { url } = await server.listen();
          env.out(`backe ui: ${url}\n`);
          if (opts.open === true) openBrowser(url, (s) => env.io.stderr(s));
          await untilSignal();
          await server.close();
        },
        { statusLine: () => false },
      )(opts, cmd);
    });
}
