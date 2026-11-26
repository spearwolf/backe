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

/** Der Browser-Starter der Plattform; `undefined`, wo backe keinen kennt. */
export function browserCommand(platform: NodeJS.Platform): string | undefined {
  if (platform === 'linux') return 'xdg-open';
  if (platform === 'darwin') return 'open';
  return undefined;
}

/**
 * Übergibt die URL dem Browser-Starter der Plattform; scheitert das, bleibt es bei einem Hinweis.
 * Ohne Starter (etwa win32) gibt es nur den Hinweis, ohne einen Befehl zu nennen.
 */
export function openBrowser(url: string, stderr: (s: string) => void): void {
  const cmd = browserCommand(process.platform);
  if (cmd === undefined) {
    stderr(renderHints([m.openUnsupported]));
    return;
  }
  const hint = () => stderr(renderHints([m.openFailed(cmd)]));
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  child.on('error', hint);
  // Ein Ende durch Signal (`code === null`) zählt wie ein Exit-Code ungleich 0: Ob der Browser
  // aufging, ist dann unbekannt, und der Hinweis schadet nicht.
  child.on('exit', (code) => {
    if (code !== 0) hint();
  });
  child.unref();
}

/**
 * Registriert sofort je einen Listener für SIGINT und SIGTERM; `signalled` erfüllt sich beim
 * ersten der beiden. `dispose` entfernt beide wieder (idempotent), auch ohne Signal.
 */
function signalWaiter(): { signalled: Promise<void>; dispose(): void } {
  let dispose!: () => void;
  const signalled = new Promise<void>((resolve) => {
    const done = () => {
      dispose();
      resolve();
    };
    dispose = () => {
      process.removeListener('SIGINT', done);
      process.removeListener('SIGTERM', done);
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  return { signalled, dispose };
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
          // Die Listener stehen vor der Startzeile: Wer auf sie hin sofort SIGTERM schickt, trifft
          // nie auf Nodes Default, der den Prozess ohne Exit-Code beendet.
          const signal = signalWaiter();
          try {
            env.out(`backe ui: ${url}\n`);
            if (opts.open === true) openBrowser(url, (s) => env.io.stderr(s));
            await signal.signalled;
          } catch (err) {
            // Auch ein Fehler nach `listen` lässt den Server nicht offen; scheitert dabei `close`,
            // bleibt der ursprüngliche Fehler der, der ankommt.
            await server.close().catch((closeErr: unknown) => {
              env.io.stderr(
                `backe ui: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}\n`,
              );
            });
            throw err;
          } finally {
            signal.dispose();
          }
          await server.close();
        },
        { statusLine: () => false },
      )(opts, cmd);
    });
}
