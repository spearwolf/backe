/**
 * `backe issue create | list | show | edit | move | resume | reopen | assign | rank | link |
 * unlink | delete` und die Aliase `new`, `ls`, `show`, `mv` (backe.md §2.17, §2.18, §2.22, §2.23).
 */
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { type IssueListQuery, listIssues } from '../../services/issue-list.ts';
import { showIssue } from '../../services/issue-show.ts';
import {
  assignIssue,
  createIssue,
  deleteIssue,
  editIssue,
  linkIssue,
  moveIssue,
  type RankPositionInput,
  rankIssue,
  reopenIssue,
  resumeIssue,
  unlinkIssue,
} from '../../services/issues.ts';
import {
  action,
  bodyArg,
  type CommandEnv,
  collect,
  emitNotices,
  emitOutcome,
  fileText,
  GLOBAL_KEYS,
  limitArg,
  type Runtime,
  stdinBody,
  subcommand,
  text,
} from '../options.ts';
import { headerLine, json, lines, pickFields } from '../output.ts';
import {
  issueDetailJson,
  issueDetailMd,
  issueDetailText,
  issueLines,
  issueListJson,
  LIST_FIELDS,
  SHOW_FIELDS,
} from '../render-issue.ts';

type ReasonOpts = { reason?: string; reasonFile?: string };

/** Begründung aus `--reason <md|->` oder `--reason-file <pfad>`; beide zusammen passen nicht. */
async function reasonOf(env: CommandEnv, opts: ReasonOpts): Promise<string | undefined> {
  if (opts.reason !== undefined && opts.reasonFile !== undefined) {
    throw new BackeError('usage', '--reason und --reason-file schließen sich aus');
  }
  if (opts.reason !== undefined) return text(opts.reason, env.io, env.stdin);
  if (opts.reasonFile !== undefined) return fileText(opts.reasonFile, env.io);
  return undefined;
}

function reasonOptions(cmd: Command): Command {
  return cmd
    .option('--reason <md|->', 'Begründung (»-« liest stdin)')
    .option('--reason-file <pfad>', 'Begründung aus Datei');
}

// --- create ------------------------------------------------------------------------------------

type CreateOpts = {
  title: string;
  description?: string;
  file?: string;
  project?: string[];
  sprint?: string[];
  assignee?: string;
  repo?: string[];
  dep?: string[];
  parent?: string;
  prop?: string[];
  state?: string;
};

function defineCreate(parent: Command, name: string, rt: Runtime, description: string): void {
  subcommand(parent, name, description)
    .requiredOption('-t, --title <titel>', 'Titel')
    .option(
      '-d, --description <md|->',
      "Beschreibung; »-« liest stdin, das nicht leer sein darf (ohne Text: -d '')",
    )
    .option('-F, --file <pfad>', 'Beschreibung aus Datei (darf leer sein)')
    .option('-p, --project <pfad>', 'Projekt (wiederholbar)', collect)
    .option('-s, --sprint <slug>', 'Sprint (wiederholbar)', collect)
    .option('-a, --assignee <user|me>', 'zuweisen')
    .option('--repo <name[@ref]>', 'Repo (wiederholbar)', collect)
    .option('--dep <id>', 'Abhängigkeit (wiederholbar)', collect)
    .option('--parent <id>', 'Parent; Projekte, Sprints und Repos werden von dort vorbelegt')
    .option('--prop <key=wert|key:=json>', 'Property (wiederholbar)', collect)
    .option('--state <state>', 'Anfangszustand (Default backlog)')
    .action(
      action(rt, async (env, opts: CreateOpts) => {
        const body = await bodyArg(env, opts);
        const r = await createIssue(await env.context(), {
          title: opts.title,
          ...(body === undefined ? {} : { body }),
          ...(opts.state === undefined ? {} : { state: opts.state }),
          ...(opts.project === undefined ? {} : { projects: opts.project }),
          ...(opts.sprint === undefined ? {} : { sprints: opts.sprint }),
          ...(opts.repo === undefined ? {} : { repos: opts.repo }),
          ...(opts.assignee === undefined ? {} : { assignee: opts.assignee }),
          ...(opts.dep === undefined ? {} : { deps: opts.dep }),
          ...(opts.parent === undefined ? {} : { parent: opts.parent }),
          ...(opts.prop === undefined ? {} : { props: opts.prop }),
        });
        emitOutcome(env, r, 'create');
      }),
    );
}

// --- list --------------------------------------------------------------------------------------

type ListOpts = {
  state?: string[];
  project?: string[];
  exact?: boolean;
  sprint?: string[];
  assignee?: string;
  creator?: string;
  repo?: string[];
  blocked?: boolean;
  unblockable?: boolean;
  ready?: boolean;
  parent?: string;
  topLevel?: boolean;
  prop?: string[];
  hasProp?: string[];
  tree?: boolean;
  sort?: string;
  query?: string;
  all?: boolean;
  limit?: string;
};

function listMode(opts: ListOpts): IssueListQuery['mode'] {
  const modes = (['blocked', 'unblockable', 'ready'] as const).filter((m) => opts[m] === true);
  if (modes.length > 1) {
    throw new BackeError('usage', '--blocked, --unblockable und --ready schließen sich aus');
  }
  return modes[0];
}

/** `--sort rank|created` für `issue list` und `sprint show`; sonst `validation`. */
export function listSort(value: string | undefined): IssueListQuery['sort'] {
  if (value === undefined || value === 'rank' || value === 'created') return value;
  throw new BackeError('validation', `Ungültige Sortierung: »${value}«`, {
    hint: 'rank oder created',
  });
}

function listQuery(opts: ListOpts): IssueListQuery {
  const mode = listMode(opts);
  const sort = listSort(opts.sort);
  const limit = limitArg(opts.limit);
  const q: IssueListQuery = {};
  if (opts.state !== undefined) q.states = opts.state;
  if (opts.project !== undefined) q.projects = opts.project;
  if (opts.exact === true) q.exact = true;
  if (opts.sprint !== undefined) q.sprints = opts.sprint;
  if (opts.repo !== undefined) q.repos = opts.repo;
  if (opts.assignee !== undefined) q.assignee = opts.assignee;
  if (opts.creator !== undefined) q.creator = opts.creator;
  if (mode !== undefined) q.mode = mode;
  if (opts.parent !== undefined) q.parent = opts.parent;
  if (opts.topLevel === true) q.topLevel = true;
  if (opts.prop !== undefined) q.props = opts.prop;
  if (opts.hasProp !== undefined) q.hasProps = opts.hasProp;
  if (opts.query !== undefined) q.text = opts.query;
  if (opts.tree === true) q.tree = true;
  if (sort !== undefined) q.sort = sort;
  if (opts.all === true) q.all = true;
  if (limit !== undefined) q.limit = limit;
  return q;
}

function defineList(parent: Command, name: string, rt: Runtime, description: string): void {
  subcommand(parent, name, description)
    .option('--state <state[,state]|all>', 'States (Default: alle offenen; wiederholbar)', collect)
    .option('-p, --project <pfad>', 'Projekt samt Unterprojekten (wiederholbar)', collect)
    .option('--exact', 'nur genau diese Projekte, ohne Unterprojekte')
    .option('-s, --sprint <slug>', 'Sprint (wiederholbar)', collect)
    .option('-a, --assignee <user|me|none>', 'zugewiesen an; none = niemandem')
    .option('--creator <user|me>', 'angelegt von')
    .option('--repo <name>', 'Repo (wiederholbar)', collect)
    .option('--blocked', 'nur blockierte')
    .option('--unblockable', 'blockierte, deren Blocker alle erledigt sind')
    .option('--ready', 'nur bereite (backe.md §2.22)')
    .option('--parent <id>', 'nur direkte Sub-Issues von <id>')
    .option('--top-level', 'nur Issues ohne Parent')
    .option('--prop <filter>', 'Property-Filter key=wert[,wert], key>=wert, key<=wert', collect)
    .option('--has-prop <key>', 'Property gesetzt (wiederholbar)', collect)
    .option('--tree', 'Hierarchie eingerückt')
    .option('--sort <rank|created>', 'Sortierung (Default rank)')
    .option('-q, --query <text>', 'Text in Titel oder Body')
    .option('-A, --all', 'Kontextfilter (Projekt, Sprint, Repo) ignorieren')
    .option('--limit <n>', 'höchstens n Einträge')
    .action(
      action(
        rt,
        async (env, opts: ListOpts) => {
          const q = listQuery(opts);
          const r = await listIssues(await env.context(), q);
          if (env.format === 'json') {
            const issues = r.items.map((item) => {
              const obj = issueListJson(item);
              return env.fields === undefined ? obj : pickFields(obj, env.fields, LIST_FIELDS);
            });
            env.out(
              json({
                context: Object.keys(r.header).length === 0 ? undefined : r.header,
                issues,
                truncated: r.truncated ? true : undefined,
                problems: r.problems.length === 0 ? undefined : r.problems,
              }),
            );
            return;
          }
          const header = headerLine(r.header);
          env.out(
            lines([...(header === undefined ? [] : [header]), ...issueLines(r.items, env.color)]),
          );
          env.io.stderr(
            lines([
              ...r.problems.map((p) => `Warnung: ${p.path}: ${p.message}`),
              ...(r.truncated ? [`Hinweis: Liste gekürzt (--limit ${r.items.length})`] : []),
            ]),
          );
        },
        { fields: LIST_FIELDS },
      ),
    );
}

// --- show --------------------------------------------------------------------------------------

function commentsArg(value: string | undefined): number | 'all' | undefined {
  if (value === undefined || value === 'all') return value;
  if (/^\d+$/.test(value)) return Number(value);
  throw new BackeError('validation', `Ungültige Kommentaranzahl: »${value}«`, {
    hint: 'eine Zahl ab 0 oder all angeben',
  });
}

function defineShow(parent: Command, name: string, rt: Runtime, description: string): void {
  subcommand(parent, `${name} <id>`, description)
    .option('--comments <n|all>', 'die letzten n Kommentare oder alle anhängen')
    .action(
      action(
        rt,
        async (env, ref: string, opts: { comments?: string }) => {
          const comments = commentsArg(opts.comments);
          const d = await showIssue(await env.context(), ref, {
            ...(comments === undefined ? {} : { comments }),
          });
          if (env.format === 'json') {
            const obj = issueDetailJson(d);
            env.out(
              json(env.fields === undefined ? obj : pickFields(obj, env.fields, SHOW_FIELDS)),
            );
            return;
          }
          env.out(env.format === 'md' ? issueDetailMd(d) : issueDetailText(d, env.color));
          emitNotices(env, d.notices);
        },
        { formats: ['text', 'json', 'md'], fields: SHOW_FIELDS },
      ),
    );
}

// --- edit --------------------------------------------------------------------------------------

type EditOpts = {
  title?: string;
  addProject?: string[];
  rmProject?: string[];
  addSprint?: string[];
  rmSprint?: string[];
  addDep?: string[];
  rmDep?: string[];
  /** `--parent <id>` setzt, `--no-parent` (false) löst. */
  parent?: string | false;
  prop?: string[];
  unsetProp?: string[];
  bodyFile?: string;
};

function defineEdit(parent: Command, rt: Runtime): void {
  // commander legt `--parent <id>` und `--no-parent` auf dasselbe Feld, die letzte Angabe gewönne
  // still. Beide Events zu sehen heißt: widersprüchlicher Aufruf.
  const parentFlags = new Set<string>();
  subcommand(parent, 'edit <id>', 'Felder eines Issues ändern')
    .on('option:parent', () => parentFlags.add('--parent'))
    .on('option:no-parent', () => parentFlags.add('--no-parent'))
    .option('--title <titel>', 'neuer Titel')
    .option('--add-project <pfad>', 'Projekt hinzufügen (wiederholbar)', collect)
    .option('--rm-project <pfad>', 'Projekt entfernen (wiederholbar)', collect)
    .option('--add-sprint <slug>', 'Sprint hinzufügen (wiederholbar)', collect)
    .option('--rm-sprint <slug>', 'Sprint entfernen (wiederholbar)', collect)
    .option('--add-dep <id>', 'Abhängigkeit hinzufügen (wiederholbar)', collect)
    .option('--rm-dep <id>', 'Abhängigkeit entfernen (wiederholbar)', collect)
    .option('--parent <id>', 'umhängen unter <id>')
    .option('--no-parent', 'vom Parent lösen')
    .option('--prop <key=wert|key:=json>', 'Property setzen (wiederholbar)', collect)
    .option('--unset-prop <key>', 'Property entfernen (wiederholbar)', collect)
    .option(
      '--body-file <pfad|->',
      'neuer Body aus Datei, eine leere Datei leert ihn; »-« liest stdin, das nicht leer sein darf',
    )
    .action(
      action(rt, async (env, ref: string, opts: EditOpts) => {
        if (parentFlags.size > 1) {
          throw new BackeError('usage', '--parent und --no-parent schließen sich aus');
        }
        const given = Object.entries(opts).filter(
          ([key, v]) => v !== undefined && !(GLOBAL_KEYS as readonly string[]).includes(key),
        );
        if (given.length === 0) {
          throw new BackeError('usage', 'Nichts zu ändern');
        }
        const body =
          opts.bodyFile === undefined
            ? undefined
            : opts.bodyFile === '-'
              ? await stdinBody(env.io, env.stdin, '--body-file <leere datei>')
              : await fileText(opts.bodyFile, env.io);
        const r = await editIssue(await env.context(), ref, {
          ...(opts.title === undefined ? {} : { title: opts.title }),
          ...(opts.addProject === undefined ? {} : { addProjects: opts.addProject }),
          ...(opts.rmProject === undefined ? {} : { rmProjects: opts.rmProject }),
          ...(opts.addSprint === undefined ? {} : { addSprints: opts.addSprint }),
          ...(opts.rmSprint === undefined ? {} : { rmSprints: opts.rmSprint }),
          ...(opts.addDep === undefined ? {} : { addDeps: opts.addDep }),
          ...(opts.rmDep === undefined ? {} : { rmDeps: opts.rmDep }),
          ...(opts.parent === undefined
            ? {}
            : { parent: opts.parent === false ? null : opts.parent }),
          ...(opts.prop === undefined ? {} : { props: opts.prop }),
          ...(opts.unsetProp === undefined ? {} : { unsetProps: opts.unsetProp }),
          ...(body === undefined ? {} : { body }),
        });
        emitOutcome(env, r, 'other');
      }),
    );
}

// --- move, resume, reopen ----------------------------------------------------------------------

type MoveOpts = ReasonOpts & { blockedBy?: string[]; force?: boolean };

function defineMove(parent: Command, name: string, rt: Runtime, description: string): void {
  reasonOptions(subcommand(parent, `${name} <id> <state>`, description))
    .option('--blocked-by <id>', 'Blocker bei blocked (wiederholbar)', collect)
    .option('--force', 'done trotz offener Sub-Issues oder unter einem done-Parent')
    .action(
      action(rt, async (env, ref: string, to: string, opts: MoveOpts) => {
        const reason = await reasonOf(env, opts);
        const r = await moveIssue(await env.context(), ref, {
          to,
          ...(reason === undefined ? {} : { reason }),
          ...(opts.blockedBy === undefined ? {} : { blockedBy: opts.blockedBy }),
          ...(opts.force === true ? { force: true } : {}),
        });
        emitOutcome(env, r, 'other');
      }),
    );
}

function defineResume(parent: Command, rt: Runtime): void {
  reasonOptions(
    subcommand(parent, 'resume <id>', 'blocked oder on_hold verlassen, zurück nach paused_from'),
  ).action(
    action(rt, async (env, ref: string, opts: ReasonOpts) => {
      const reason = await reasonOf(env, opts);
      const r = await resumeIssue(await env.context(), ref, {
        ...(reason === undefined ? {} : { reason }),
      });
      emitOutcome(env, r, 'other');
    }),
  );
}

function defineReopen(parent: Command, rt: Runtime): void {
  reasonOptions(subcommand(parent, 'reopen <id>', 'erledigtes Issue wieder öffnen'))
    .option('--to <state>', 'Zielzustand')
    .action(
      action(rt, async (env, ref: string, opts: ReasonOpts & { to?: string }) => {
        const reason = await reasonOf(env, opts);
        const r = await reopenIssue(await env.context(), ref, {
          ...(opts.to === undefined ? {} : { to: opts.to }),
          ...(reason === undefined ? {} : { reason }),
        });
        emitOutcome(env, r, 'other');
      }),
    );
}

// --- assign, rank, link, unlink, delete --------------------------------------------------------

type RankOpts = { top?: boolean; bottom?: boolean; before?: string; after?: string };

function rankPosition(value: string | undefined, opts: RankOpts): RankPositionInput {
  const given: RankPositionInput[] = [];
  if (opts.top === true) given.push({ top: true });
  if (opts.bottom === true) given.push({ bottom: true });
  if (opts.before !== undefined) given.push({ before: opts.before });
  if (opts.after !== undefined) given.push({ after: opts.after });
  if (value !== undefined) {
    if (!/^-?\d+$/.test(value)) {
      throw new BackeError('validation', `Ungültiger Rang: »${value}«`, {
        hint: 'erwartet eine ganze Zahl',
      });
    }
    given.push({ value: Number(value) });
  }
  const [only] = given;
  if (given.length !== 1 || only === undefined) {
    throw new BackeError('usage', 'Genau eine Position angeben', {
      hint: '--top, --bottom, --before <id>, --after <id> oder eine Zahl',
    });
  }
  return only;
}

function defineSmallWrites(issue: Command, rt: Runtime): void {
  subcommand(issue, 'assign <id> <user>', 'zuweisen: Handle, me oder none').action(
    action(rt, async (env, ref: string, who: string) => {
      emitOutcome(env, await assignIssue(await env.context(), ref, who), 'other');
    }),
  );

  subcommand(issue, 'rank <id> [zahl]', 'umsortieren')
    .option('--top', 'ganz nach vorn')
    .option('--bottom', 'ganz nach hinten')
    .option('--before <id>', 'vor <id>')
    .option('--after <id>', 'hinter <id>')
    .action(
      action(rt, async (env, ref: string, value: string | undefined, opts: RankOpts) => {
        const pos = rankPosition(value, opts);
        emitOutcome(env, await rankIssue(await env.context(), ref, pos), 'other');
      }),
    );

  subcommand(
    issue,
    'link <id> <ziel>',
    'Repo verknüpfen: <repo>[@<ref>] oder <url>[@<ref>]',
  ).action(
    action(rt, async (env, ref: string, target: string) => {
      emitOutcome(env, await linkIssue(await env.context(), ref, target), 'other');
    }),
  );

  subcommand(issue, 'unlink <id> <repo>', 'Repo-Verknüpfung lösen').action(
    action(rt, async (env, ref: string, repo: string) => {
      emitOutcome(env, await unlinkIssue(await env.context(), ref, repo), 'other');
    }),
  );

  subcommand(issue, 'delete <id>', 'Issue löschen (Historie bleibt in Git)')
    .option('--force', 'auch wenn andere Issues es in blocked_by oder depends_on führen')
    .option('--orphan', 'Sub-Issues vom Parent lösen')
    .option('--recursive', 'Sub-Issues mitlöschen')
    .action(
      action(
        rt,
        async (
          env,
          ref: string,
          opts: { force?: boolean; orphan?: boolean; recursive?: boolean },
        ) => {
          if (opts.orphan === true && opts.recursive === true) {
            throw new BackeError('usage', '--orphan und --recursive schließen sich aus');
          }
          const children =
            opts.orphan === true ? 'orphan' : opts.recursive === true ? 'recursive' : undefined;
          const r = await deleteIssue(await env.context(), ref, {
            ...(opts.force === true ? { force: true } : {}),
            ...(children === undefined ? {} : { children }),
          });
          emitOutcome(env, r, 'other');
        },
      ),
    );
}

export function issueCommands(program: Command, rt: Runtime): void {
  const issue = subcommand(program, 'issue', 'Issues anlegen, listen, zeigen und ändern');
  defineCreate(issue, 'create', rt, 'Issue anlegen; druckt die neue ID');
  defineList(issue, 'list', rt, 'Issues listen (Default: offene im Kontext)');
  defineShow(issue, 'show', rt, 'Issue mit Beziehungen und Kommentaren zeigen');
  defineEdit(issue, rt);
  defineMove(issue, 'move', rt, 'State ändern');
  defineResume(issue, rt);
  defineReopen(issue, rt);
  defineSmallWrites(issue, rt);

  // Top-Level-Aliase (backe.md §2.17).
  defineCreate(program, 'new', rt, 'Issue anlegen (= issue create)');
  defineList(program, 'ls', rt, 'Issues listen (= issue list)');
  defineShow(program, 'show', rt, 'Issue zeigen (= issue show)');
  defineMove(program, 'mv', rt, 'State ändern (= issue move)');
}
