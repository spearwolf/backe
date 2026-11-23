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
import { m as outputMessages } from './output.messages.ts';
import { exitCodeOf, type Format, renderError, resolveFormat, safeText } from './output.ts';
import { m } from './run.messages.ts';

/**
 * Das Programm samt aller Befehle. Einstellungen (Fehlerbehandlung, Ausgabe, positionale Optionen)
 * müssen vor dem ersten Befehl stehen, weil Unterbefehle sie beim Anlegen erben.
 */
export function buildProgram(rt: Runtime): Command {
  const program = new Command('backe')
    .description(m.programDescription)
    .version(pkg.version, '-V, --version', m.versionDescription)
    .helpOption('-h, --help', m.helpDescription)
    .helpCommand(m.helpCommandFlags, m.helpCommandDescription)
    .configureHelp({ styleTitle: (title) => m.helpTitle(title) })
    .exitOverride()
    .configureOutput({
      writeOut: (s) => rt.io.stdout(s),
      // stderr bekäme nur die Hilfe bei fehlendem Unterbefehl; `run` meldet den Fehler im Format
      // des Aufrufs und hängt bei fehlendem Befehl, Unterbefehl, Argument oder fehlender Option
      // die Hilfe des betroffenen Befehls selbst an.
      writeErr: () => {},
      // Fehlermeldungen schreibt `run` selbst, im Format des Aufrufs.
      outputError: () => {},
    })
    // Optionen gehören zu der Ebene, hinter der sie stehen; jede Ebene kennt die globalen. So
    // frisst das Programm keine Optionswerte eines Unterbefehls (`-t --json` bleibt ein Titel).
    .enablePositionalOptions()
    .addHelpText('after', m.quickstart());
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

/**
 * Hilfe eines Befehls samt `addHelpText`-Blöcken, als String statt auf stdout. Sie geht über den
 * Fehlerkanal (`outputHelp({ error: true })`), damit Breite und Farben dem Ziel stderr folgen.
 */
function helpOf(cmd: Command): string {
  let text = '';
  const saved = cmd.configureOutput();
  cmd.configureOutput({ ...saved, writeErr: (s) => (text += s) });
  try {
    cmd.outputHelp({ error: true });
  } finally {
    cmd.configureOutput(saved);
  }
  return text;
}

/** `(Did you mean …?)` aus commanders Meldung, übersetzt; leer ohne Vorschlag. */
function suggestionOf(several: string | undefined, candidates: string | undefined): string {
  return candidates === undefined ? '' : ` ${m.didYouMean(candidates, several !== undefined)}`;
}

/** Bezug in einer Konflikt-Meldung: eine Option oder eine Umgebungsvariable. */
function referenceOf(kind: string | undefined, name: string): string {
  return kind === 'environment variable' ? m.envVarRef(name) : m.optionRef(name);
}

const SUGGESTION = String.raw`(?:\n\(Did you mean (one of )?(.*)\?\))?`;

/**
 * Meldungen, die commander selbst erzeugt, in der Sprache des Prozesses. Die Namen holt je ein
 * Muster aus dem englischen Text (der Teil in `'…'`); passt keines, bleibt das Original.
 */
const COMMANDER_MESSAGES: Record<string, (match: RegExpMatchArray) => string> = {
  'commander.unknownOption': (x) => m.unknownOption(x[1] as string, suggestionOf(x[2], x[3])),
  'commander.unknownCommand': (x) => m.unknownCommand(x[1] as string, suggestionOf(x[2], x[3])),
  'commander.excessArguments': (x) =>
    m.excessArguments(x[1], Number(x[2]), Number(x[3]), x[4] as string),
  'commander.optionMissingArgument': (x) => m.optionMissingArgument(x[1] as string),
  'commander.conflictingOption': (x) =>
    m.conflictingOption(referenceOf(x[1], x[2] as string), referenceOf(x[3], x[4] as string)),
};

const COMMANDER_PATTERNS: Record<string, RegExp> = {
  'commander.unknownOption': new RegExp(`^unknown option '([^']*)'${SUGGESTION}$`),
  'commander.unknownCommand': new RegExp(`^unknown command '([^']*)'${SUGGESTION}$`),
  'commander.excessArguments':
    /^too many arguments(?: for '([^']*)')?\. Expected (\d+) arguments? but got (\d+): (.*)\.$/s,
  'commander.optionMissingArgument': /^option '(.*)' argument missing$/,
  'commander.conflictingOption':
    /^(option|environment variable) '(.*?)' cannot be used with (option|environment variable) '(.*)'$/,
};

function translated(code: string, original: string): string {
  const pattern = COMMANDER_PATTERNS[code];
  const match = pattern === undefined ? null : original.match(pattern);
  const build = COMMANDER_MESSAGES[code];
  return match === null || build === undefined ? original : build(match);
}

/**
 * commander-Fehler als `usage`. `commander.help` mit Exit 1 heißt: einer Gruppe fehlt der
 * Unterbefehl; welcher, sagt der zuletzt betretene Befehl (`trackDispatch`). Fehlt ein Befehl,
 * Unterbefehl, Pflichtargument oder eine Pflichtoption, kommt die Hilfe dieses Befehls als `help`
 * zurück (backe.md §2.18); im Text-Modus ersetzt sie den Hinweis, im JSON-Modus bleibt `hint`.
 * Argument- und Optionsname stammen vom gescheiterten Befehl, nicht aus commanders Meldung.
 */
function fromCommander(
  err: CommanderError,
  program: Command,
): { error: BackeError; help?: string } {
  const failed = lastDispatched(program);
  const path = commandPath(failed);
  const hint = `${path} --help`;
  const original = err.message.replace(/^error: /, '');
  if (err.code === 'commander.help') {
    const message = path === 'backe' ? m.commandMissing : m.subcommandMissing;
    return { error: new BackeError('usage', message, { hint }), help: helpOf(failed) };
  }
  if (err.code === 'commander.missingArgument') {
    const missing = failed.registeredArguments.find((a, i) => a.required && failed.args[i] == null);
    const message = missing === undefined ? original : m.argumentMissing(missing.name());
    return { error: new BackeError('usage', message, { hint }), help: helpOf(failed) };
  }
  if (err.code === 'commander.missingMandatoryOptionValue') {
    // Wie commander: der Befehl und seine Vorfahren.
    let missing: string | undefined;
    for (
      let cmd: Command | null = failed;
      cmd !== null && missing === undefined;
      cmd = cmd.parent
    ) {
      const found = cmd.options.find(
        (o) => o.mandatory && cmd?.getOptionValue(o.attributeName()) === undefined,
      );
      missing = found?.flags;
    }
    const message = missing === undefined ? original : m.optionMissing(missing);
    return { error: new BackeError('usage', message, { hint }), help: helpOf(failed) };
  }
  return { error: new BackeError('usage', translated(err.code, original)) };
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
    let helped: { message: string; help: string } | undefined;
    if (caught instanceof CommanderError && program !== undefined) {
      if (caught.exitCode === 0) return 0;
      const converted = fromCommander(caught, program);
      err = converted.error;
      if (converted.help !== undefined) {
        helped = { message: converted.error.message, help: converted.help };
      }
    }
    const format = rt.state.format ?? (await fallbackFormat(io));
    if (format !== 'json' && helped !== undefined) {
      // Die Hilfe folgt der Meldung und ersetzt den Hinweis `… --help`.
      io.stderr(
        `${safeText(`${outputMessages.errorPrefix} ${helped.message}\n`)}\n${safeText(helped.help)}`,
      );
      return exitCodeOf(err);
    }
    io.stderr(renderError(err, format === 'json' ? 'json' : 'text'));
    return exitCodeOf(err);
  }
}
