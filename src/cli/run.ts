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
import { addGlobalOptions, type Runtime } from './options.ts';
import { exitCodeOf, type Format, renderError, resolveFormat } from './output.ts';

/**
 * Das Programm samt aller Befehle. Einstellungen (Fehlerbehandlung, Ausgabe, positionale Optionen)
 * müssen vor dem ersten Befehl stehen, weil Unterbefehle sie beim Anlegen erben.
 * `writeErr` nimmt die Hilfe auf, die commander bei fehlendem Unterbefehl auf stderr schreibt.
 */
export function buildProgram(rt: Runtime, writeErr: (s: string) => void): Command {
  const program = new Command('backe')
    .description('Git-basiertes Backlog für Menschen und Agents')
    .version(pkg.version, '-V, --version', 'Version ausgeben')
    .helpOption('-h, --help', 'Hilfe anzeigen')
    .helpCommand('help [befehl]', 'Hilfe zu einem Befehl')
    .exitOverride()
    .configureOutput({
      writeOut: (s) => rt.io.stdout(s),
      writeErr,
      // Fehlermeldungen schreibt `run` selbst, im Format des Aufrufs.
      outputError: () => {},
    })
    // Optionen gehören zu der Ebene, hinter der sie stehen; jede Ebene kennt die globalen. So
    // frisst das Programm keine Optionswerte eines Unterbefehls (`-t --json` bleibt ein Titel).
    .enablePositionalOptions();
  addGlobalOptions(program);
  contextCommand(program, rt);
  initCommand(program, rt);
  backlogCommands(program, rt);
  verifyCommand(program, rt);
  return program;
}

/** Der Befehl aus der Hilfe, die commander bei fehlendem Unterbefehl ausgibt (`Usage: backe backlog …`). */
function helpCommandPath(help: string): string {
  const match = /^Usage: (\S+(?: [a-z][a-z-]*)*)/.exec(help);
  return match?.[1] ?? 'backe';
}

function fromCommander(err: CommanderError, help: string): BackeError {
  if (err.code === 'commander.help') {
    const path = helpCommandPath(help);
    return new BackeError('usage', path === 'backe' ? 'Befehl fehlt' : 'Unterbefehl fehlt', {
      hint: `${path} --help`,
    });
  }
  return new BackeError('usage', err.message.replace(/^error: /, ''));
}

/**
 * Format für einen Fehler, der vor der Aktion eines Befehls entstand: dieselbe Rangfolge wie
 * `resolveFormat`, die Flags aus den Rohargumenten gelesen; ist auch das ungültig, Text.
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
  let help = '';
  const program = buildProgram(rt, (s) => {
    help += s;
  });
  try {
    await program.parseAsync(io.argv, { from: 'user' });
    return 0;
  } catch (caught) {
    let err = caught;
    if (caught instanceof CommanderError) {
      if (caught.exitCode === 0) return 0;
      err = fromCommander(caught, help);
    }
    const format = rt.state.format ?? (await fallbackFormat(io));
    io.stderr(renderError(err, format === 'json' ? 'json' : 'text'));
    return exitCodeOf(err);
  }
}
