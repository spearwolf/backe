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
import { attachCommands } from './commands/attach.ts';
import { backlogCommands } from './commands/backlog.ts';
import { batchCommand } from './commands/batch.ts';
import { commentCommands } from './commands/comment.ts';
import { commitCommand } from './commands/commit.ts';
import { configCommands } from './commands/config.ts';
import { contextCommand } from './commands/context.ts';
import { doctorCommand } from './commands/doctor.ts';
import { initCommand } from './commands/init.ts';
import { issueCommands } from './commands/issue.ts';
import { mcpCommand } from './commands/mcp.ts';
import { nextCommand } from './commands/next.ts';
import { projectCommands } from './commands/project.ts';
import { repoCommands } from './commands/repo.ts';
import { sprintCommands } from './commands/sprint.ts';
import { syncCommands } from './commands/sync.ts';
import { userCommands } from './commands/user.ts';
import { verifyCommand } from './commands/verify.ts';
import type { CliIo } from './io.ts';
import {
  addGlobalOptions,
  commandPath,
  lastDispatched,
  type Runtime,
  trackAllDispatch,
  trackDispatch,
} from './options.ts';
import { exitCodeOf, type Format, renderError, resolveFormat, safeText } from './output.ts';

const QUICKSTART = [
  '',
  'Schnellstart:',
  '  backe config set user <handle>    eigenes Handle setzen',
  '  backe init <verz> --name <n> --prefix <p> --remote <url>',
  '                                    neues Backlog anlegen',
  '  backe backlog clone <url>         vorhandenes Backlog klonen',
  '  backe project create web          Projekt anlegen (-t für einen Titel)',
  '  backe sprint create 2026-w48      Sprint anlegen',
  '  backe new -t "…" -p web           Issue anlegen (-s für den Sprint)',
  '  backe ls                          offene Issues',
  '  backe show <id>                   Issue anzeigen',
  '  backe mv <id> in_progress         State ändern',
  '  backe next --claim                nächstes Issue holen und übernehmen',
  'Mehr: backe <befehl> --help',
  '',
].join('\n');

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
    .enablePositionalOptions()
    .addHelpText('after', QUICKSTART);
  addGlobalOptions(trackDispatch(program));
  contextCommand(program, rt);
  initCommand(program, rt);
  backlogCommands(program, rt);
  issueCommands(program, rt);
  nextCommand(program, rt);
  commentCommands(program, rt);
  attachCommands(program, rt);
  commitCommand(program, rt);
  syncCommands(program, rt);
  batchCommand(program, rt);
  projectCommands(program, rt);
  sprintCommands(program, rt);
  repoCommands(program, rt);
  userCommands(program, rt);
  verifyCommand(program, rt);
  doctorCommand(program, rt);
  mcpCommand(program, rt);
  configCommands(program, rt);
  trackAllDispatch(program);
  return program;
}

/** Hilfe eines Befehls samt `addHelpText`-Blöcken, als String statt auf stdout. */
function helpOf(cmd: Command): string {
  let text = '';
  const saved = cmd.configureOutput();
  cmd.configureOutput({ ...saved, writeOut: (s) => (text += s) });
  try {
    cmd.outputHelp();
  } finally {
    cmd.configureOutput(saved);
  }
  return text;
}

/**
 * commander-Fehler als `usage`. `commander.help` mit Exit 1 heißt: einer Gruppe fehlt der
 * Unterbefehl; welcher, sagt der zuletzt betretene Befehl (`trackDispatch`). Fehlt ein Befehl,
 * Unterbefehl, Pflichtargument oder eine Pflichtoption, steht die Hilfe dieses Befehls dabei
 * (backe.md §2.18); sie ersetzt im Text-Modus den Hinweis.
 */
function fromCommander(
  err: CommanderError,
  program: Command,
): { error: BackeError; help?: string } {
  const failed = lastDispatched(program);
  const path = commandPath(failed);
  const hint = `${path} --help`;
  if (err.code === 'commander.help') {
    const message = path === 'backe' ? 'Befehl fehlt' : 'Unterbefehl fehlt';
    return { error: new BackeError('usage', message, { hint }), help: helpOf(failed) };
  }
  if (err.code === 'commander.missingArgument') {
    const name = /'([^']*)'/.exec(err.message)?.[1] ?? '';
    return {
      error: new BackeError('usage', `Argument »${name}« fehlt`, { hint }),
      help: helpOf(failed),
    };
  }
  if (err.code === 'commander.missingMandatoryOptionValue') {
    const flags = /'([^']*)'/.exec(err.message)?.[1] ?? '';
    return {
      error: new BackeError('usage', `Option »${flags}« fehlt`, { hint }),
      help: helpOf(failed),
    };
  }
  return { error: new BackeError('usage', err.message.replace(/^error: /, '')) };
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
    let help: string | undefined;
    if (caught instanceof CommanderError && program !== undefined) {
      if (caught.exitCode === 0) return 0;
      ({ error: err, help } = fromCommander(caught, program));
    }
    const format = rt.state.format ?? (await fallbackFormat(io));
    if (format !== 'json' && help !== undefined && err instanceof BackeError) {
      // Die Hilfe folgt der Meldung und ersetzt den Hinweis `… --help`.
      const bare = new BackeError(err.code, err.message);
      io.stderr(`${renderError(bare, 'text')}\n${safeText(help)}`);
      return exitCodeOf(err);
    }
    io.stderr(renderError(err, format === 'json' ? 'json' : 'text'));
    return exitCodeOf(err);
  }
}
