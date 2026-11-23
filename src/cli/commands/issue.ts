/**
 * `backe issue create | list | show | edit | move | resume | reopen | assign | rank | link |
 * unlink | delete` und die Aliase `new`, `ls`, `show`, `mv` (backe.md §2.17, §2.18, §2.22, §2.23).
 */

import { rm } from 'node:fs/promises';
import type { Command } from 'commander';
import { BackeError } from '../../core/errors.ts';
import { claimIssue } from '../../services/claim.ts';
import { type IssueListQuery, listIssues, listSort } from '../../services/issue-list.ts';
import { showIssue } from '../../services/issue-show.ts';
import {
  assignIssue,
  createIssue,
  deleteIssue,
  editIssue,
  editIssueText,
  linkIssue,
  moveIssue,
  type RankPositionInput,
  rankIssue,
  readIssueFile,
  reopenIssue,
  resumeIssue,
  unlinkIssue,
} from '../../services/issues.ts';
import {
  issueListResultJson,
  issueShowJson,
  LIST_FIELDS,
  SHOW_FIELDS,
} from '../../services/views.ts';
import { editorCommand, editText, noEditorError } from '../editor.ts';
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
  syncOption,
  text,
} from '../options.ts';
import { m as outputMessages } from '../output.messages.ts';
import { headerLine, json, lines, safeText } from '../output.ts';
import { issueDetailMd, issueDetailText, issueLines } from '../render-issue.ts';
import { m } from './issue.messages.ts';

type ReasonOpts = { reason?: string; reasonFile?: string };

/** Begründung aus `--reason <md|->` oder `--reason-file <pfad>`; beide zusammen passen nicht. */
async function reasonOf(env: CommandEnv, opts: ReasonOpts): Promise<string | undefined> {
  if (opts.reason !== undefined && opts.reasonFile !== undefined) {
    throw new BackeError('usage', m.reasonAndFileExclusive);
  }
  if (opts.reason !== undefined) return text(opts.reason, env.io, env.stdin);
  if (opts.reasonFile !== undefined) return fileText(opts.reasonFile, env.io);
  return undefined;
}

function reasonOptions(cmd: Command): Command {
  return cmd
    .option('--reason <md|->', m.reasonOption)
    .option(m.reasonFileFlags, m.reasonFileOption);
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
    .requiredOption(m.titleFlags, m.titleOption)
    .option('-d, --description <md|->', m.descriptionOption)
    .option(m.fileFlags, m.fileOption)
    .option(m.projectFlags, m.projectOption, collect)
    .option('-s, --sprint <slug>', m.sprintOption, collect)
    .option('-a, --assignee <user|me>', m.assigneeOption)
    .option('--repo <name[@ref]>', m.repoOption, collect)
    .option('--dep <id>', m.depOption, collect)
    .option('--parent <id>', m.parentOption)
    .option(m.propFlags, m.propOption, collect)
    .option('--state <state>', m.stateOption)
    .action(
      action(
        rt,
        async (env, opts: CreateOpts) => {
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
        },
        { write: true },
      ),
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
    throw new BackeError('usage', m.modesExclusive);
  }
  return modes[0];
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
  syncOption(subcommand(parent, name, description))
    .option('--state <state[,state]|all>', m.stateFilterOption, collect)
    .option(m.projectFlags, m.projectFilterOption, collect)
    .option('--exact', m.exactOption)
    .option('-s, --sprint <slug>', m.sprintOption, collect)
    .option('-a, --assignee <user|me|none>', m.assigneeFilterOption)
    .option('--creator <user|me>', m.creatorOption)
    .option('--repo <name>', m.repoOption, collect)
    .option('--blocked', m.blockedOption)
    .option('--unblockable', m.unblockableOption)
    .option('--ready', m.readyOption)
    .option('--parent <id>', m.parentFilterOption)
    .option('--top-level', m.topLevelOption)
    .option(m.propFilterFlags, m.propFilterOption, collect)
    .option('--has-prop <key>', m.hasPropOption, collect)
    .option('--tree', m.treeOption)
    .option('--sort <rank|created>', m.sortOption)
    .option('-q, --query <text>', m.queryOption)
    .option('-A, --all', m.allOption)
    .option('--limit <n>', m.limitOption)
    .action(
      action(
        rt,
        async (env, opts: ListOpts) => {
          const q = listQuery(opts);
          const r = await listIssues(await env.context(), q);
          if (env.format === 'json') {
            env.out(json(issueListResultJson(r, env.fields)));
            return;
          }
          const header = headerLine(r.header);
          env.out(
            lines([...(header === undefined ? [] : [header]), ...issueLines(r.items, env.color)]),
          );
          env.io.stderr(
            lines([
              ...r.problems.map((p) =>
                safeText(`${outputMessages.warningPrefix} ${p.path}: ${p.message}`),
              ),
              ...(r.truncated
                ? [`${outputMessages.hintPrefix} ${m.listTruncated(r.items.length)}`]
                : []),
            ]),
          );
        },
        { fields: LIST_FIELDS, read: true },
      ),
    );
}

// --- show --------------------------------------------------------------------------------------

function commentsArg(value: string | undefined): number | 'all' | undefined {
  if (value === undefined || value === 'all') return value;
  if (/^\d+$/.test(value)) return Number(value);
  throw new BackeError('validation', m.invalidCommentCount(value), {
    hint: m.commentCountHint,
  });
}

function defineShow(parent: Command, name: string, rt: Runtime, description: string): void {
  syncOption(subcommand(parent, `${name} <id>`, description))
    .option('--comments <n|all>', m.commentsOption)
    .action(
      action(
        rt,
        async (env, ref: string, opts: { comments?: string }) => {
          const comments = commentsArg(opts.comments);
          const d = await showIssue(await env.context(), ref, {
            ...(comments === undefined ? {} : { comments }),
          });
          if (env.format === 'json') {
            env.out(json(issueShowJson(d, env.fields)));
            return;
          }
          env.out(env.format === 'md' ? issueDetailMd(d) : issueDetailText(d, env.color));
          emitNotices(env, d.notices);
        },
        { formats: ['text', 'json', 'md'], fields: SHOW_FIELDS, read: true },
      ),
    );
}

// --- edit --------------------------------------------------------------------------------------

/** Ein Fehler der Übersetzung, mit dem Pfad des Entwurfs statt dem der Issue-Datei und dem Entwurf im Hinweis. */
function draftError(error: BackeError, issuePath: string, draft: string): BackeError {
  const hint = [m.draftLabel(draft), error.hint?.replaceAll(issuePath, draft)]
    .filter((part) => part !== undefined)
    .join('; ');
  return new BackeError(error.code, error.message.replaceAll(issuePath, draft), {
    hint,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

/**
 * `issue edit <id>` ohne Flags (backe.md §2.17): die Issue-Datei im Editor, das Ergebnis als
 * Operationen. Scheitert die Übersetzung, bleibt der Entwurf liegen und der Fehler nennt ihn.
 */
async function editInEditor(env: CommandEnv, ref: string): Promise<void> {
  if (editorCommand(env.io) === undefined) throw noEditorError();
  const ctx = await env.context();
  const file = await readIssueFile(ctx, ref);
  const edited = await editText(env.io, file.id, file.text);
  try {
    const r = await editIssueText(ctx, file.id, file.text, edited.text);
    await rm(edited.file, { force: true });
    emitOutcome(env, r, 'other');
  } catch (error) {
    throw error instanceof BackeError ? draftError(error, file.path, edited.file) : error;
  }
}

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
  subcommand(parent, 'edit <id>', m.editDescription)
    .on('option:parent', () => parentFlags.add('--parent'))
    .on('option:no-parent', () => parentFlags.add('--no-parent'))
    .option(m.newTitleFlags, m.newTitleOption)
    .option(m.addProjectFlags, m.addProjectOption, collect)
    .option(m.rmProjectFlags, m.rmProjectOption, collect)
    .option('--add-sprint <slug>', m.addSprintOption, collect)
    .option('--rm-sprint <slug>', m.rmSprintOption, collect)
    .option('--add-dep <id>', m.addDepOption, collect)
    .option('--rm-dep <id>', m.rmDepOption, collect)
    .option('--parent <id>', m.reparentOption)
    .option('--no-parent', m.noParentOption)
    .option(m.propFlags, m.editPropOption, collect)
    .option('--unset-prop <key>', m.unsetPropOption, collect)
    .option(m.bodyFileFlags, m.bodyFileOption)
    .addHelpText('after', m.editorHelp)
    .action(
      action(
        rt,
        async (env, ref: string, opts: EditOpts) => {
          if (parentFlags.size > 1) {
            throw new BackeError('usage', m.parentAndNoParentExclusive);
          }
          const given = Object.entries(opts).filter(
            ([key, v]) => v !== undefined && !(GLOBAL_KEYS as readonly string[]).includes(key),
          );
          if (given.length === 0) {
            await editInEditor(env, ref);
            return;
          }
          const body =
            opts.bodyFile === undefined
              ? undefined
              : opts.bodyFile === '-'
                ? await stdinBody(env.io, env.stdin, m.emptyFileLabel)
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
        },
        { write: true },
      ),
    );
}

// --- move, resume, reopen ----------------------------------------------------------------------

type MoveOpts = ReasonOpts & { blockedBy?: string[]; force?: boolean };

function defineMove(parent: Command, name: string, rt: Runtime, description: string): void {
  reasonOptions(subcommand(parent, `${name} <id> <state>`, description))
    .option('--blocked-by <id>', m.blockedByOption, collect)
    .option('--force', m.forceMoveOption)
    .action(
      action(
        rt,
        async (env, ref: string, to: string, opts: MoveOpts) => {
          const reason = await reasonOf(env, opts);
          const r = await moveIssue(await env.context(), ref, {
            to,
            ...(reason === undefined ? {} : { reason }),
            ...(opts.blockedBy === undefined ? {} : { blockedBy: opts.blockedBy }),
            ...(opts.force === true ? { force: true } : {}),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );
}

function defineResume(parent: Command, rt: Runtime): void {
  reasonOptions(subcommand(parent, 'resume <id>', m.resumeDescription)).action(
    action(
      rt,
      async (env, ref: string, opts: ReasonOpts) => {
        const reason = await reasonOf(env, opts);
        const r = await resumeIssue(await env.context(), ref, {
          ...(reason === undefined ? {} : { reason }),
        });
        emitOutcome(env, r, 'other');
      },
      { write: true },
    ),
  );
}

function defineReopen(parent: Command, rt: Runtime): void {
  reasonOptions(subcommand(parent, 'reopen <id>', m.reopenDescription))
    .option('--to <state>', m.toOption)
    .action(
      action(
        rt,
        async (env, ref: string, opts: ReasonOpts & { to?: string }) => {
          const reason = await reasonOf(env, opts);
          const r = await reopenIssue(await env.context(), ref, {
            ...(opts.to === undefined ? {} : { to: opts.to }),
            ...(reason === undefined ? {} : { reason }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
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
      throw new BackeError('validation', m.invalidRank(value), {
        hint: m.rankHint,
      });
    }
    given.push({ value: Number(value) });
  }
  const [only] = given;
  if (given.length !== 1 || only === undefined) {
    throw new BackeError('usage', m.exactlyOnePosition, {
      hint: m.positionHint,
    });
  }
  return only;
}

function defineSmallWrites(issue: Command, rt: Runtime): void {
  subcommand(issue, 'assign <id> <user>', m.assignDescription).action(
    action(
      rt,
      async (env, ref: string, who: string) => {
        emitOutcome(env, await assignIssue(await env.context(), ref, who), 'other');
      },
      { write: true },
    ),
  );

  // Kein `write`: Der Claim synct selbst und pusht sich als letzten Commit; einen Hintergrund-Lauf,
  // der währenddessen warten musste, startet der Service nach der Freigabe von `sync.lock`.
  subcommand(issue, 'claim <id>', m.claimDescription).action(
    action(rt, async (env, ref: string) => {
      emitOutcome(env, await claimIssue(await env.context(), ref), 'other');
    }),
  );

  subcommand(issue, m.rankCommand, m.rankDescription)
    .option('--top', m.topOption)
    .option('--bottom', m.bottomOption)
    .option('--before <id>', m.beforeOption)
    .option('--after <id>', m.afterOption)
    .action(
      action(
        rt,
        async (env, ref: string, value: string | undefined, opts: RankOpts) => {
          const pos = rankPosition(value, opts);
          emitOutcome(env, await rankIssue(await env.context(), ref, pos), 'other');
        },
        { write: true },
      ),
    );

  subcommand(issue, m.linkCommand, m.linkDescription).action(
    action(
      rt,
      async (env, ref: string, target: string) => {
        emitOutcome(env, await linkIssue(await env.context(), ref, target), 'other');
      },
      { write: true },
    ),
  );

  subcommand(issue, 'unlink <id> <repo>', m.unlinkDescription).action(
    action(
      rt,
      async (env, ref: string, repo: string) => {
        emitOutcome(env, await unlinkIssue(await env.context(), ref, repo), 'other');
      },
      { write: true },
    ),
  );

  subcommand(issue, 'delete <id>', m.deleteDescription)
    .option('--force', m.deleteForceOption)
    .option('--orphan', m.orphanOption)
    .option('--recursive', m.recursiveOption)
    .action(
      action(
        rt,
        async (
          env,
          ref: string,
          opts: { force?: boolean; orphan?: boolean; recursive?: boolean },
        ) => {
          if (opts.orphan === true && opts.recursive === true) {
            throw new BackeError('usage', m.orphanAndRecursiveExclusive);
          }
          const children =
            opts.orphan === true ? 'orphan' : opts.recursive === true ? 'recursive' : undefined;
          const r = await deleteIssue(await env.context(), ref, {
            ...(opts.force === true ? { force: true } : {}),
            ...(children === undefined ? {} : { children }),
          });
          emitOutcome(env, r, 'other');
        },
        { write: true },
      ),
    );
}

export function issueCommands(program: Command, rt: Runtime): void {
  const issue = subcommand(program, 'issue', m.groupDescription);
  defineCreate(issue, 'create', rt, m.createDescription);
  defineList(issue, 'list', rt, m.listDescription);
  defineShow(issue, 'show', rt, m.showDescription);
  defineEdit(issue, rt);
  defineMove(issue, 'move', rt, m.moveDescription);
  defineResume(issue, rt);
  defineReopen(issue, rt);
  defineSmallWrites(issue, rt);

  // Top-Level-Aliase (backe.md §2.17).
  defineCreate(program, 'new', rt, m.newDescription);
  defineList(program, 'ls', rt, m.lsDescription);
  defineShow(program, 'show', rt, m.showAliasDescription);
  defineMove(program, 'mv', rt, m.mvDescription);
}
