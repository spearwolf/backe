/**
 * Gemeinsames Gerüst aller Befehle: globale Optionen, die Umgebung eines Aufrufs (`CommandEnv`),
 * stdin- und Datei-Eingaben und die Ausgabe von Write-Ergebnissen. Ein Befehl entsteht über
 * `subcommand` und bekommt seine Aktion über `action`; mehr braucht ein neuer Befehl nicht.
 */
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { envValue, expandPath, type Homes, isMissing, resolveHomes } from '../context/paths.ts';
import { type ContextFlags, type ResolvedContext, resolveContext } from '../context/resolve.ts';
import { readUserConfig, userConfigPath } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import type { WriteOutcome } from '../services/outcome.ts';
import type { CliIo } from './io.ts';
import {
  checkFields,
  type Format,
  json,
  renderNotices,
  renderOutcome,
  resolveFormat,
  useColor,
} from './output.ts';

/** Globale Optionen; jeder Befehl trägt sie, damit sie vor und nach dem Befehlsnamen gelten. */
export type GlobalOpts = {
  backlog?: string;
  as?: string;
  format?: string;
  json?: boolean;
  fields?: string;
};

const GLOBAL_KEYS = ['backlog', 'as', 'format', 'json', 'fields'] as const;

export function addGlobalOptions(cmd: Command): Command {
  return cmd
    .option('-B, --backlog <name|pfad>', 'Backlog (Name, Pfad oder Remote-URL)')
    .option('--as <handle>', 'Identität für diesen Aufruf')
    .option('--format <format>', 'Ausgabeformat: text, json oder md')
    .option('--json', 'Kurzform für --format json')
    .option('--fields <liste>', 'nur diese Felder ausgeben (mit --format json)');
}

/** Legt einen Unterbefehl samt globalen Optionen an; Einstellungen erbt er von `parent`. */
export function subcommand(parent: Command, nameAndArgs: string, description: string): Command {
  return addGlobalOptions(parent.command(nameAndArgs).description(description));
}

/**
 * Globale Optionen über alle Ebenen: Programm, Gruppe, Befehl. Der Wert, der auf der Kommandozeile
 * zuletzt kommt (die tiefere Ebene), gewinnt.
 */
export function globalOpts(cmd: Command): GlobalOpts {
  const chain: Command[] = [];
  for (let c: Command | null = cmd; c !== null; c = c.parent) chain.unshift(c);
  const out: GlobalOpts = {};
  for (const c of chain) {
    const o = c.opts() as GlobalOpts;
    for (const key of GLOBAL_KEYS) {
      if (o[key] !== undefined) (out as Record<string, unknown>)[key] = o[key];
    }
  }
  return out;
}

/** `backe backlog list` für Meldungen. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c !== null; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

/** stdin lässt sich je Aufruf nur einmal lesen. */
export type StdinGuard = { taken: boolean };

/** Zustand eines Aufrufs, den `run` nach einem Fehler braucht. */
export type RunState = { format?: Format };

export type Runtime = { io: CliIo; stdin: StdinGuard; state: RunState };

export type CommandEnv = {
  io: CliIo;
  format: Format;
  fields?: string[];
  color: boolean;
  homes: Homes;
  userConfig: UserConfig;
  stdin: StdinGuard;
  /** Kontext des Aufrufs (`cwd`, `env`, `-B`, `--as` plus `flags`); einmal aufgelöst, danach gemerkt. */
  context(flags?: Partial<ContextFlags>): Promise<ResolvedContext>;
  /** Handle für Befehle ohne Kontext (`init`, `backlog clone|add`): `--as` → `BACKE_USER` → `user`. */
  handle(): string;
  /** Ausgabe nach stdout. */
  out(s: string): void;
};

export type CommandSpec = {
  /** Formate, die der Befehl ausgeben kann; Default `text` und `json`. */
  formats?: readonly Format[];
  /** Erlaubte Felder für `--fields`; ohne Angabe kennt der Befehl `--fields` nicht. */
  fields?: readonly string[];
};

function splitFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '');
}

async function commandEnv(rt: Runtime, cmd: Command, spec: CommandSpec): Promise<CommandEnv> {
  const { io } = rt;
  const g = globalOpts(cmd);
  const homes = resolveHomes(io.env, io.cwd);
  const userConfig = await readUserConfig(homes.backeHome);
  const name = `»${commandPath(cmd)}«`;
  let format = resolveFormat(g, io.env, userConfig);
  const formats = spec.formats ?? ['text', 'json'];
  if (!formats.includes(format)) {
    // Ein Default aus Env oder Config, den der Befehl nicht kann, fällt auf Text zurück.
    if (g.json === true || g.format !== undefined) {
      rt.state.format = 'text';
      throw new BackeError('usage', `${name} kennt --format ${format} nicht`, {
        hint: `Möglich: ${formats.join(', ')}`,
      });
    }
    format = 'text';
  }
  rt.state.format = format;
  const fields = splitFields(g.fields);
  if (fields !== undefined) {
    if (format !== 'json') throw new BackeError('usage', '--fields geht nur mit --format json');
    if (spec.fields === undefined) throw new BackeError('usage', `${name} kennt --fields nicht`);
    checkFields(fields, spec.fields);
  }
  let resolved: Promise<ResolvedContext> | undefined;
  return {
    io,
    format,
    ...(fields === undefined ? {} : { fields }),
    color: useColor(io, userConfig),
    homes,
    userConfig,
    stdin: rt.stdin,
    context: (flags = {}) => {
      resolved ??= resolveContext({
        cwd: io.cwd,
        env: io.env,
        flags: { backlog: g.backlog, as: g.as, ...flags },
      });
      return resolved;
    },
    handle: () => {
      const handle = g.as ?? envValue(io.env, 'BACKE_USER') ?? userConfig.user;
      if (handle === undefined) {
        throw new BackeError('usage', 'Kein Handle angegeben', {
          hint: `--as <handle>, BACKE_USER oder »user« in ${userConfigPath(homes.backeHome)}`,
        });
      }
      return handle;
    },
    out: (s) => io.stdout(s),
  };
}

/**
 * Aktion eines Befehls: baut die `CommandEnv` und ruft `fn` mit den Argumenten von commander
 * (Positionsargumente, dann die Optionen des Befehls). Fehler fängt `run`.
 */
export function action<A extends unknown[]>(
  rt: Runtime,
  fn: (env: CommandEnv, ...args: A) => Promise<void>,
  spec: CommandSpec = {},
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args.at(-1) as Command;
    const env = await commandEnv(rt, cmd, spec);
    await fn(env, ...(args.slice(0, -1) as A));
  };
}

/** Sammelt eine wiederholbare Option (`-p a -p b`). */
export function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

/** `~` gegen `HOME`, relativ gegen `cwd`. */
export function absPath(p: string, io: CliIo): string {
  return expandPath(p, { home: resolveHomes(io.env, io.cwd).home, base: io.cwd });
}

/** Ein Textwert; `-` liest stdin, das je Aufruf nur einmal vergeben wird. */
export async function text(value: string, io: CliIo, stdin: StdinGuard): Promise<string> {
  if (value !== '-') return value;
  if (stdin.taken) {
    throw new BackeError('usage', 'stdin ist schon vergeben', {
      hint: 'Nur eine Angabe je Aufruf kann »-« (stdin) sein.',
    });
  }
  stdin.taken = true;
  return io.readStdin();
}

/** Inhalt einer Datei (`-F <datei>`), Pfad wie `absPath`. */
export async function fileText(path: string, io: CliIo): Promise<string> {
  const file = absPath(path, io);
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) throw new BackeError('not_found', `Datei »${path}« nicht gefunden`);
    throw new BackeError('unexpected', `${file}: ${(error as NodeJS.ErrnoException).code}`);
  }
}

/**
 * Gibt ein Write-Ergebnis aus: das Ergebnis nach stdout; Warnungen nach stderr, Hinweise der
 * Operation im Text-Modus ebenfalls (im JSON-Modus stehen sie im Objekt).
 */
export function emitOutcome(env: CommandEnv, o: WriteOutcome, kind: 'create' | 'other'): void {
  env.out(renderOutcome(o, env.format, kind));
  const notices = renderNotices(env.format === 'json' ? [] : o.notices, o.warnings);
  if (notices !== '') env.io.stderr(notices);
}

/** JSON oder Text, je nach Format. */
export function emit(env: CommandEnv, value: unknown, textOut: () => string): void {
  env.out(env.format === 'json' ? json(value) : textOut());
}
