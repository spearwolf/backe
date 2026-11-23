/**
 * Gemeinsames Gerüst aller Befehle: globale Optionen, die Umgebung eines Aufrufs (`CommandEnv`),
 * stdin- und Datei-Eingaben und die Ausgabe von Write-Ergebnissen. Ein Befehl entsteht über
 * `subcommand` und bekommt seine Aktion über `action`; mehr braucht ein neuer Befehl nicht.
 */
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { envValue, expandPath, type Homes, resolveHomes } from '../context/paths.ts';
import { type ContextFlags, type ResolvedContext, resolveContext } from '../context/resolve.ts';
import { readUserConfig, userConfigPath } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import type { Notice } from '../ops/notice.ts';
import { freshen, scheduleSync, statusLine, syncStatus } from '../services/background.ts';
import type { WriteOpsOutcome, WriteOutcome } from '../services/outcome.ts';
import { checkFields } from '../services/views.ts';
import { isMissing } from '../store/files.ts';
import type { CliIo } from './io.ts';
import { m } from './options.messages.ts';
import {
  type Format,
  json,
  lines,
  renderHints,
  renderNotices,
  renderOutcome,
  resolveFormat,
  safeText,
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

export const GLOBAL_KEYS = ['backlog', 'as', 'format', 'json', 'fields'] as const;
export type GlobalKey = (typeof GLOBAL_KEYS)[number];

/** Flags und Beschreibung je globaler Option; als Funktion, damit sie die Locale beim Bauen lesen. */
const globalOption = (key: GlobalKey): [flags: string, description: string] => {
  switch (key) {
    case 'backlog':
      return [m.backlogFlags, m.backlogDescription];
    case 'as':
      return ['--as <handle>', m.asDescription];
    case 'format':
      return ['--format <format>', m.formatDescription];
    case 'json':
      return ['--json', m.jsonDescription];
    case 'fields':
      return [m.fieldsFlags, m.fieldsDescription];
  }
};

/** Globale Optionen, die ein Befehl nicht trägt, weil er den Namen selbst belegt. */
const optedOut = new WeakMap<Command, ReadonlySet<GlobalKey>>();

/** Die globalen Optionen, die `cmd` trägt. */
export function globalKeysOf(cmd: Command): GlobalKey[] {
  const without = optedOut.get(cmd);
  return GLOBAL_KEYS.filter((key) => !without?.has(key));
}

export function addGlobalOptions(cmd: Command, without: readonly GlobalKey[] = []): Command {
  if (without.length > 0) optedOut.set(cmd, new Set(without));
  for (const key of globalKeysOf(cmd)) cmd.option(...globalOption(key));
  return cmd;
}

/** Zuletzt betretener Unterbefehl je Programm; nennt den Befehl, dem ein Unterbefehl fehlt. */
const dispatched = new WeakMap<Command, Command>();

function rootOf(cmd: Command): Command {
  let c = cmd;
  while (c.parent !== null) c = c.parent;
  return c;
}

const tracking = new WeakSet<Command>();

/** Merkt sich am Programm jeden Unterbefehl, den `cmd` betritt (je Befehl nur einmal). */
export function trackDispatch(cmd: Command): Command {
  if (tracking.has(cmd)) return cmd;
  tracking.add(cmd);
  return cmd.hook('preSubcommand', (_self, sub) => {
    dispatched.set(rootOf(cmd), sub);
  });
}

/**
 * `trackDispatch` für jede Gruppe unter `program`, auch für eine, die nicht über `subcommand()`
 * entstand; sonst fiele der Hinweis bei fehlendem Unterbefehl auf eine höhere Ebene zurück.
 */
export function trackAllDispatch(program: Command): void {
  for (const cmd of program.commands) {
    if (cmd.commands.length > 0) trackDispatch(cmd);
    trackAllDispatch(cmd);
  }
}

/** Der zuletzt betretene Befehl unter `program`, sonst `program` selbst. */
export function lastDispatched(program: Command): Command {
  return dispatched.get(program) ?? program;
}

/**
 * Legt einen Unterbefehl samt globalen Optionen an; Einstellungen erbt er von `parent`.
 * `without` nennt globale Optionen, deren Namen der Befehl selbst belegt (etwa ein eigenes
 * `--json <json|->`); dort gilt die Option der Ebene darüber.
 */
export function subcommand(
  parent: Command,
  nameAndArgs: string,
  description: string,
  opts: { without?: readonly GlobalKey[] } = {},
): Command {
  const cmd = trackDispatch(parent.command(nameAndArgs).description(description));
  return addGlobalOptions(cmd, opts.without);
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
    for (const key of globalKeysOf(c)) {
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
  /** Kontext des Aufrufs (`cwd`, `env`, `-B`, `--as` plus `flags`); je Flag-Satz einmal aufgelöst. */
  context(flags?: Partial<ContextFlags>): Promise<ResolvedContext>;
  /** Handle für Befehle ohne Kontext (`init`, `backlog clone|add`): `--as` → `BACKE_USER` → `user`. */
  handle(): string;
  /** Ausgabe nach stdout. */
  out(s: string): void;
  /**
   * Meldet den Commit eines Writes (`emitOutcome` tut das selbst). Bei einem Befehl mit
   * `write: true` startet danach bei Bedarf der Hintergrund-Sync; ohne Commit nichts.
   */
  committed(commit: string | undefined): void;
};

/** Optionen eines Aufrufs, wie commander sie liefert. */
type Opts = Record<string, unknown>;

export type CommandSpec = {
  /** Formate, die der Befehl ausgeben kann; Default `text` und `json`. */
  formats?: readonly Format[];
  /** Erlaubte Felder für `--fields`; ohne Angabe kennt der Befehl `--fields` nicht. */
  fields?: readonly string[];
  /**
   * Eine ungültige User-Config bricht den Befehl nicht ab (Defaults gelten); für `doctor`,
   * `config get` und `config edit`, die sie melden bzw. reparieren.
   */
  lenientConfig?: boolean;
  /**
   * Lesender Befehl (backe.md §2.16.3): Option `--sync` (`syncOption`) dreht vor dem Lesen eine
   * blockierende Runde, deren Fehler den Befehl abbricht; sonst startet bei Bedarf der
   * Hintergrund-Sync, und das Lesen läuft sofort weiter. Eine Funktion entscheidet je Aufruf
   * (`next --claim` liest nicht, sondern claimt).
   */
  read?: true | ((opts: Opts) => boolean);
  /**
   * Schreibender Befehl (backe.md §2.16.1): Hat die Aktion einen Commit gemeldet
   * (`env.committed`), startet danach bei Bedarf der Hintergrund-Sync. Ein Fehler dabei lässt den
   * Write gelingen.
   */
  write?: true;
  /**
   * Die Kopfzeile (backe.md §2.16.2) nach der Aktion; Default an. `sync status` zeigt den Zustand
   * selbst, `sync --background` schreibt in sein Log.
   */
  statusLine?: (opts: Opts) => boolean;
};

/** Die Option `--sync` eines lesenden Befehls. */
export function syncOption(cmd: Command): Command {
  return cmd.option('--sync', m.syncDescription);
}

/** Was eine Aktion über den Aufruf hinterlässt: den ersten aufgelösten Kontext und den Commit. */
type Trace = {
  ctx?: Promise<ResolvedContext>;
  commit?: string;
  /** Vergisst die aufgelösten Kontexte; der nächste Aufruf von `context` löst neu auf. */
  forget(): void;
};

const CONTEXT_KEYS = [
  'backlog',
  'as',
  'project',
  'sprint',
] as const satisfies readonly (keyof ContextFlags)[];

function splitFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '');
}

async function commandEnv(
  rt: Runtime,
  cmd: Command,
  spec: CommandSpec,
): Promise<{ env: CommandEnv; trace: Trace }> {
  const { io } = rt;
  const g = globalOpts(cmd);
  const homes = resolveHomes(io.env, io.cwd);
  let userConfig: UserConfig = {};
  try {
    userConfig = await readUserConfig(homes.backeHome);
  } catch (error) {
    if (spec.lenientConfig !== true) throw error;
  }
  const name = commandPath(cmd);
  let format = resolveFormat(g, io.env, userConfig);
  const formats = spec.formats ?? ['text', 'json'];
  if (!formats.includes(format)) {
    // Ein Default aus Env oder Config, den der Befehl nicht kann, fällt auf Text zurück.
    if (g.json === true || g.format !== undefined) {
      rt.state.format = 'text';
      throw new BackeError('usage', m.formatNotSupported(name, format), {
        hint: m.formatAvailable(formats.join(', ')),
      });
    }
    format = 'text';
  }
  rt.state.format = format;
  const fields = splitFields(g.fields);
  if (fields !== undefined) {
    if (format !== 'json') throw new BackeError('usage', m.fieldsNeedJson);
    if (spec.fields === undefined) throw new BackeError('usage', m.fieldsNotSupported(name));
    checkFields(fields, spec.fields);
  }
  const resolved = new Map<string, Promise<ResolvedContext>>();
  const trace: Trace = {
    forget: () => {
      resolved.clear();
      delete trace.ctx;
    },
  };
  const env: CommandEnv = {
    io,
    format,
    ...(fields === undefined ? {} : { fields }),
    color: useColor(io, userConfig),
    homes,
    userConfig,
    stdin: rt.stdin,
    context: (flags = {}) => {
      const all: ContextFlags = { backlog: g.backlog, as: g.as, ...flags };
      const key = JSON.stringify(CONTEXT_KEYS.map((k) => all[k] ?? null));
      let ctx = resolved.get(key);
      if (ctx === undefined) {
        ctx = resolveContext({ cwd: io.cwd, env: io.env, flags: all });
        resolved.set(key, ctx);
      }
      // Nur ein aufgelöster Kontext zählt für Kopfzeile und Hintergrund-Start; ein gescheiterter
      // Standardkontext würde sie sonst für den Kontext sperren, den der Befehl danach nutzt.
      ctx.then(
        (resolvedCtx) => {
          trace.ctx ??= Promise.resolve(resolvedCtx);
        },
        () => {},
      );
      return ctx;
    },
    handle: () => {
      const handle = g.as ?? envValue(io.env, 'BACKE_USER') ?? userConfig.user;
      if (handle === undefined) {
        throw new BackeError('usage', m.noHandle, {
          hint: m.noHandleHint(userConfigPath(homes.backeHome)),
        });
      }
      return handle;
    },
    out: (s) => io.stdout(s),
    committed: (commit) => {
      if (commit !== undefined) trace.commit = commit;
    },
  };
  return { env, trace };
}

/**
 * Frische vor dem Lesen. Ohne `--sync` startet höchstens der Hintergrund-Sync; ein Kontext, der
 * sich nicht auflösen lässt, meldet der Befehl dann selbst. Mit `--sync` läuft die Runde
 * blockierend; danach wird der Kontext neu aufgelöst, weil sie die Arbeitskopie erst geklont haben
 * kann. Ihre Hinweise gehen im Text-Modus nach stderr.
 */
async function beforeRead(env: CommandEnv, trace: Trace, force: boolean): Promise<void> {
  if (!force) {
    let ctx: ResolvedContext;
    try {
      ctx = await env.context();
    } catch {
      return;
    }
    await freshen(ctx, { force: false });
    return;
  }
  const out = await freshen(await env.context(), { force: true });
  trace.forget();
  if (env.format !== 'json' && out !== undefined) env.io.stderr(renderHints(out.notices));
}

/**
 * Die Kopfzeile auf stderr (backe.md §2.16.2), wenn der Befehl einen Kontext mit Arbeitskopie
 * aufgelöst hat und etwas offen ist. Fehler beim Bestimmen des Status bleiben still.
 */
async function emitStatusLine(env: CommandEnv, trace: Trace): Promise<void> {
  if (trace.ctx === undefined) return;
  try {
    const ctx = await trace.ctx;
    if (ctx.backlog.workingCopy === undefined) return;
    const line = statusLine(await syncStatus(ctx));
    if (line !== undefined)
      env.io.stderr(lines([safeText(line)]) + renderHints(['backe sync status']));
  } catch {
    // Ohne Arbeitskopie oder lesbaren Zustand gibt es keine Kopfzeile.
  }
}

/** Nach einem Write mit Commit: Hintergrund-Sync bei Bedarf. Wirft nie. */
async function afterWrite(trace: Trace): Promise<void> {
  if (trace.commit === undefined || trace.ctx === undefined) return;
  try {
    await scheduleSync(await trace.ctx, 'write');
  } catch {
    // Der Kontext hat die Aktion schon getragen; scheitert er jetzt doch, bleibt der Write gültig.
  }
}

/**
 * Aktion eines Befehls: baut die `CommandEnv` und ruft `fn` mit den Argumenten von commander
 * (Positionsargumente, dann die Optionen des Befehls). Davor bei `read` die Frische, danach bei
 * `write` der Start des Hintergrund-Syncs und im Text-Modus die Kopfzeile. Fehler fängt `run`;
 * nach einem Fehler gibt es keine Kopfzeile, die Fehlermeldung ist dann die Ausgabe.
 */
export function action<A extends unknown[]>(
  rt: Runtime,
  fn: (env: CommandEnv, ...args: A) => Promise<void>,
  spec: CommandSpec = {},
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args.at(-1) as Command;
    const opts = cmd.opts() as Opts;
    const { env, trace } = await commandEnv(rt, cmd, spec);
    const reads = typeof spec.read === 'function' ? spec.read(opts) : spec.read === true;
    if (reads) await beforeRead(env, trace, opts.sync === true);
    await fn(env, ...(args.slice(0, -1) as A));
    if (spec.write === true) await afterWrite(trace);
    if (env.format === 'text' && (spec.statusLine?.(opts) ?? true)) {
      await emitStatusLine(env, trace);
    }
  };
}

/** Sammelt eine wiederholbare Option (`-p a -p b`). */
export function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

/** `--limit <n>`: eine ganze Zahl ab 1, sonst `validation`. */
export function limitArg(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BackeError('validation', m.invalidLimit(value), {
      hint: m.invalidLimitHint,
    });
  }
  return Number(value);
}

/** `~` gegen `HOME`, relativ gegen `cwd`. */
export function absPath(p: string, io: CliIo): string {
  return expandPath(p, { home: resolveHomes(io.env, io.cwd).home, base: io.cwd });
}

/** Ein Textwert; `-` liest stdin, das je Aufruf nur einmal vergeben wird. */
export async function text(value: string, io: CliIo, stdin: StdinGuard): Promise<string> {
  if (value !== '-') return value;
  if (stdin.taken) {
    throw new BackeError('usage', m.stdinTaken, {
      hint: m.stdinTakenHint,
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
    if (isMissing(error)) throw new BackeError('not_found', m.fileNotFound(path));
    throw new BackeError(
      'unexpected',
      m.fileUnreadable(file, (error as NodeJS.ErrnoException).code),
    );
  }
}

/**
 * Hinweise und Warnungen einer Operation: im Text-Modus als `Hinweis: …`/`Warnung: …` nach stderr,
 * im JSON-Modus nichts, weil sie dort im Ergebnisobjekt stehen.
 */
export function emitNotices(
  env: CommandEnv,
  notices: readonly Notice[],
  warnings: readonly string[] = [],
): void {
  if (env.format === 'json') return;
  const out = renderNotices(notices, warnings);
  if (out !== '') env.io.stderr(out);
}

/**
 * Gibt ein Write-Ergebnis aus. Text: Ergebnis nach stdout, Hinweise und Warnungen nach stderr.
 * JSON: alles in einem Objekt auf stdout (`notices`, `warnings`), stderr bleibt leer.
 */
export function emitOutcome(
  env: CommandEnv,
  o: WriteOutcome | WriteOpsOutcome,
  kind: 'create' | 'other',
): void {
  env.out(renderOutcome(o, env.format, kind));
  emitNotices(env, o.notices, o.warnings);
  env.committed(o.commit);
}

/**
 * Body aus stdin (`-d -`, `--body-file -`). Leeres stdin ist ein Fehler, damit ein abgebrochener
 * Erzeuger in der Pipe die Beschreibung nicht still löscht; leeren geht ausdrücklich mit `-d ''`
 * oder einer leeren Datei; `clear` nennt diesen Weg im Hinweis.
 */
export async function stdinBody(io: CliIo, stdin: StdinGuard, clear: string): Promise<string> {
  const body = await text('-', io, stdin);
  if (body.trim() === '') {
    throw new BackeError('validation', m.emptyBody, { hint: m.emptyBodyHint(clear) });
  }
  return body;
}

/**
 * Beschreibung beim Anlegen aus `-d <md|->` oder `-F <pfad>`; beide zusammen passen nicht, ohne
 * Angabe gibt es keine. Leeres stdin ist ein Fehler (`stdinBody`), eine leere Datei nicht.
 */
export async function bodyArg(
  env: CommandEnv,
  opts: { description?: string; file?: string },
): Promise<string | undefined> {
  if (opts.description !== undefined && opts.file !== undefined) {
    throw new BackeError('usage', m.bodyAndFile);
  }
  if (opts.description === '-') return stdinBody(env.io, env.stdin, "-d ''");
  if (opts.description !== undefined) return opts.description;
  if (opts.file !== undefined) return fileText(opts.file, env.io);
  return undefined;
}

/** JSON oder Text, je nach Format. */
export function emit(env: CommandEnv, value: unknown, textOut: () => string): void {
  env.out(env.format === 'json' ? json(value) : textOut());
}
