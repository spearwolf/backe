/**
 * Programm und Fehlergrenze der CLI: baut die Befehle, führt einen Aufruf aus und macht aus jedem
 * Fehler eine Ausgabe auf stderr samt Exit-Code (backe.md §2.18). commander beendet nie selbst den
 * Prozess; seine Fehler werden `usage`, Hilfe und Version enden mit 0.
 */
import { Command, CommanderError } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { resolveHomes } from '../context/paths.ts';
import { readUserConfig } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import { backlogCommands } from './commands/backlog.ts';
import { contextCommand } from './commands/context.ts';
import { initCommand } from './commands/init.ts';
import { verifyCommand } from './commands/verify.ts';
import type { CliIo } from './io.ts';
import {
  addGlobalOptions,
  commandPath,
  lastDispatched,
  type Runtime,
  trackDispatch,
} from './options.ts';
import { exitCodeOf, type Format, renderError, resolveFormat } from './output.ts';

/**
 * Das Programm samt aller Befehle. Einstellungen (Fehlerbehandlung, Ausgabe, positionale Optionen)
 * müssen vor dem ersten Befehl stehen, weil Unterbefehle sie beim Anlegen erben.
 */
export function buildProgram(rt: Runtime): Command {
  const program = new Command('backe')
    .description('Git-basiertes Backlog für Menschen und Agents')
    .version(pkg.version, '-V, --version', 'Version ausgeben')
    .helpOption('-h, --help', 'Hilfe anzeigen')
    .helpCommand('help [befehl]', 'Hilfe zu einem Befehl')
    .exitOverride()
    .configureOutput({
      writeOut: (s) => rt.io.stdout(s),
      // stderr bekäme nur die Hilfe bei fehlendem Unterbefehl; `run` meldet dann einen
      // `usage`-Fehler im Format des Aufrufs.
      writeErr: () => {},
      // Fehlermeldungen schreibt `run` selbst, im Format des Aufrufs.
      outputError: () => {},
    })
    // Optionen gehören zu der Ebene, hinter der sie stehen; jede Ebene kennt die globalen. So
    // frisst das Programm keine Optionswerte eines Unterbefehls (`-t --json` bleibt ein Titel).
    .enablePositionalOptions();
  addGlobalOptions(trackDispatch(program));
  contextCommand(program, rt);
  initCommand(program, rt);
  backlogCommands(program, rt);
  verifyCommand(program, rt);
  return program;
}

/**
 * commander-Fehler als `usage`. `commander.help` mit Exit 1 heißt: einer Gruppe fehlt der
 * Unterbefehl; welcher, sagt der zuletzt betretene Befehl (`trackDispatch`).
 */
function fromCommander(err: CommanderError, program: Command): BackeError {
  if (err.code === 'commander.help') {
    const path = commandPath(lastDispatched(program));
    return new BackeError('usage', path === 'backe' ? 'Befehl fehlt' : 'Unterbefehl fehlt', {
      hint: `${path} --help`,
    });
  }
  return new BackeError('usage', err.message.replace(/^error: /, ''));
}

/**
 * Format für einen Fehler, der vor der Aktion eines Befehls entstand: dieselbe Rangfolge wie
 * `resolveFormat`, die Flags aus den Rohargumenten gelesen; ist auch das ungültig, Text.
 * Grenze: Der Scan kennt keine Optionsstellen. Ist `--json` der Wert einer anderen Option
 * (`--reason --json`) und scheitert das Parsen, kommt der Fehler als JSON. Das betrifft nur die
 * Form der Fehlermeldung; der Exit-Code bleibt derselbe.
 */
async function fallbackFormat(io: CliIo): Promise<Format> {
  const opts: { json?: boolean; format?: string } = {};
  for (const [i, arg] of io.argv.entries()) {
    if (arg === '--') break;
    if (arg === '--json') opts.json = true;
    else if (arg === '--format') opts.format = io.argv[i + 1];
    else if (arg.startsWith('--format=')) opts.format = arg.slice('--format='.length);
  }
  let cfg: UserConfig = {};
  try {
    cfg = await readUserConfig(resolveHomes(io.env, io.cwd).backeHome);
  } catch {
    // Eine kaputte Config darf die Fehlermeldung nicht verhindern.
  }
  try {
    return resolveFormat(opts, io.env, cfg);
  } catch {
    return 'text';
  }
}

/** Führt einen Aufruf aus und liefert den Exit-Code; wirft nie. */
export async function run(io: CliIo): Promise<number> {
  const rt: Runtime = { io, stdin: { taken: false }, state: {} };
  let program: Command | undefined;
  try {
    program = buildProgram(rt);
    await program.parseAsync(io.argv, { from: 'user' });
    return 0;
  } catch (caught) {
    let err = caught;
    if (caught instanceof CommanderError && program !== undefined) {
      if (caught.exitCode === 0) return 0;
      err = fromCommander(caught, program);
    }
    const format = rt.state.format ?? (await fallbackFormat(io));
    io.stderr(renderError(err, format === 'json' ? 'json' : 'text'));
    return exitCodeOf(err);
  }
}
