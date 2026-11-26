/**
 * Lesende Tools (backe.md §2.19). Jedes Tool ruft denselben Service und baut das Ergebnis mit
 * derselben Ansicht wie der gleichnamige CLI-Befehl.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { getAttachment } from '../services/attachments.ts';
import { nextClaim } from '../services/claim.ts';
import { contextInfo } from '../services/context-info.ts';
import { type IssueListQuery, listIssues } from '../services/issue-list.ts';
import { showIssue } from '../services/issue-show.ts';
import { type NextQuery, nextIssue } from '../services/next.ts';
import { listProjects } from '../services/projects.ts';
import { locateRepo } from '../services/repo-local.ts';
import { listSprints, showSprint } from '../services/sprints.ts';
import {
  attachmentJson,
  checkFields,
  contextJson,
  issueListResultJson,
  issueShowJson,
  LIST_FIELDS,
  NEXT_FIELDS,
  nextJson,
  repoLocateJson,
  SHOW_FIELDS,
  sprintShowJson,
} from '../services/views.ts';
import { ALL_SURFACES, type ToolDef, tool } from './define.ts';

/** Größte Datei, deren Inhalt `attachment_get` als `text` mitliefert. */
export const ATTACHMENT_TEXT_LIMIT = 262_144;

const strings = z.array(z.string());
const sortSchema = z.enum(['rank', 'created']);

function listQuery(a: {
  state?: string[] | undefined;
  project?: string[] | undefined;
  exact?: boolean | undefined;
  sprint?: string[] | undefined;
  repo?: string[] | undefined;
  assignee?: string | undefined;
  creator?: string | undefined;
  mode?: IssueListQuery['mode'] | undefined;
  parent?: string | undefined;
  top_level?: boolean | undefined;
  prop?: string[] | undefined;
  has_prop?: string[] | undefined;
  query?: string | undefined;
  tree?: boolean | undefined;
  sort?: IssueListQuery['sort'] | undefined;
  all?: boolean | undefined;
  limit?: number | undefined;
}): IssueListQuery {
  const q: IssueListQuery = {};
  if (a.state !== undefined) q.states = a.state;
  if (a.project !== undefined) q.projects = a.project;
  if (a.exact === true) q.exact = true;
  if (a.sprint !== undefined) q.sprints = a.sprint;
  if (a.repo !== undefined) q.repos = a.repo;
  if (a.assignee !== undefined) q.assignee = a.assignee;
  if (a.creator !== undefined) q.creator = a.creator;
  if (a.mode !== undefined) q.mode = a.mode;
  if (a.parent !== undefined) q.parent = a.parent;
  if (a.top_level === true) q.topLevel = true;
  if (a.prop !== undefined) q.props = a.prop;
  if (a.has_prop !== undefined) q.hasProps = a.has_prop;
  if (a.query !== undefined) q.text = a.query;
  if (a.tree === true) q.tree = true;
  if (a.sort !== undefined) q.sort = a.sort;
  if (a.all === true) q.all = true;
  if (a.limit !== undefined) q.limit = a.limit;
  return q;
}

/** `check` für Tools mit `fields`: ein unbekanntes Feld ist `usage`, bevor irgendetwas läuft. */
function fieldsCheck(allowed: readonly string[]) {
  return (a: { fields?: readonly string[] | undefined }): void => {
    if (a.fields !== undefined) checkFields(a.fields, allowed);
  };
}

/** Der Inhalt einer Datei als Text, wenn sie klein und gültiges UTF-8 ist; sonst `undefined`. */
async function textOf(path: string, size: number): Promise<string | undefined> {
  if (size > ATTACHMENT_TEXT_LIMIT) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch {
    return undefined;
  }
}

export const READ_TOOLS: readonly ToolDef[] = [
  tool({
    name: 'context_get',
    description:
      'Show the resolved context with the source of each value (like backe context); with props, the property declarations of the backlog',
    input: z.strictObject({ props: z.boolean().optional() }),
    kind: 'read',
    surfaces: ALL_SURFACES,
    run: async (ctx, args) => contextJson(await contextInfo(ctx, { props: args.props === true })),
  }),
  tool({
    name: 'issue_list',
    description:
      'List and filter issues (like backe issue list); default: all open issues within the context filter',
    input: z.strictObject({
      state: strings.optional(),
      project: strings.optional(),
      exact: z.boolean().optional(),
      sprint: strings.optional(),
      repo: strings.optional(),
      assignee: z.string().optional(),
      creator: z.string().optional(),
      mode: z.enum(['blocked', 'unblockable', 'ready']).optional(),
      parent: z.string().optional(),
      top_level: z.boolean().optional(),
      prop: strings.optional(),
      has_prop: strings.optional(),
      query: z.string().optional(),
      tree: z.boolean().optional(),
      sort: sortSchema.optional(),
      all: z.boolean().optional(),
      limit: z.number().int().min(1).optional(),
      fields: strings.optional(),
    }),
    kind: 'read',
    check: fieldsCheck(LIST_FIELDS),
    surfaces: ALL_SURFACES,
    run: async (ctx, a) => issueListResultJson(await listIssues(ctx, listQuery(a)), a.fields),
  }),
  tool({
    name: 'issue_get',
    description: 'Show an issue with its relations (like backe issue show); short IDs are allowed',
    input: z.strictObject({
      id: z.string(),
      comments: z.enum(['none', 'last', 'all']).optional(),
      fields: strings.optional(),
    }),
    kind: 'read',
    check: fieldsCheck(SHOW_FIELDS),
    surfaces: ALL_SURFACES,
    run: async (ctx, a) => {
      const comments = a.comments === 'last' ? 1 : a.comments === 'all' ? 'all' : undefined;
      const d = await showIssue(ctx, a.id, comments === undefined ? {} : { comments });
      return issueShowJson(d, a.fields);
    },
  }),
  tool({
    name: 'issue_next',
    description:
      'Show the next issue for me (like backe next); with claim, take it over right away, synchronously with the remote',
    input: z.strictObject({
      level: z.enum(['leaf', 'top']).optional(),
      project: z.string().optional(),
      sprint: z.string().optional(),
      repo: z.string().optional(),
      all: z.boolean().optional(),
      claim: z.boolean().optional(),
      fields: strings.optional(),
    }),
    // Mit `claim` kein Read (wie `next --claim` der CLI): Ein vorab angestoßener
    // Hintergrund-Sync könnte `sync.lock` vor dem Claim greifen und ihn eine ganze Runde
    // warten lassen. Der Claim synct selbst, neben der Warteschlange.
    kind: (a) => (a.claim === true ? 'sync' : 'read'),
    check: fieldsCheck(NEXT_FIELDS),
    surfaces: ALL_SURFACES,
    run: async (ctx, a, env) => {
      const q: NextQuery = {
        ...(a.level === undefined ? {} : { level: a.level }),
        ...(a.project === undefined ? {} : { project: a.project }),
        ...(a.sprint === undefined ? {} : { sprint: a.sprint }),
        ...(a.repo === undefined ? {} : { repo: a.repo }),
        ...(a.all === true ? { all: true } : {}),
      };
      const fields = a.fields === undefined ? {} : { fields: a.fields };
      if (a.claim !== true) {
        const r = await nextIssue(ctx, q);
        return nextJson(r, { notices: r.notices, warnings: [], ...fields });
      }
      // Wie `next --claim`: Commit, Versuche, Hinweise und Warnungen des Claims.
      const r = await nextClaim(ctx, q, env.deps?.claim);
      return nextJson(r, {
        claimed: { commit: r.claim.commit, attempts: r.attempts },
        notices: [...r.notices, ...r.claim.notices],
        warnings: r.claim.warnings,
        ...fields,
      });
    },
  }),
  tool({
    name: 'project_list',
    description: 'Projects with their number of open issues (like backe project list)',
    input: z.strictObject({}),
    kind: 'read',
    surfaces: ALL_SURFACES,
    run: (ctx) => listProjects(ctx),
  }),
  tool({
    name: 'sprint_list',
    description:
      'Sprints, open ones first, with their number of open issues (like backe sprint list)',
    input: z.strictObject({}),
    kind: 'read',
    surfaces: ALL_SURFACES,
    run: (ctx) => listSprints(ctx),
  }),
  tool({
    name: 'sprint_get',
    description: 'Issues of a sprint, grouped by state (like backe sprint show)',
    input: z.strictObject({
      slug: z.string(),
      project: strings.optional(),
      repo: strings.optional(),
      all: z.boolean().optional(),
      sort: sortSchema.optional(),
    }),
    kind: 'read',
    surfaces: ALL_SURFACES,
    run: async (ctx, a) =>
      sprintShowJson(
        a.slug,
        await showSprint(ctx, a.slug, {
          ...(a.project === undefined ? {} : { projects: a.project }),
          ...(a.repo === undefined ? {} : { repos: a.repo }),
          ...(a.all === true ? { all: true } : {}),
          ...(a.sort === undefined ? {} : { sort: a.sort }),
        }),
      ),
  }),
  tool({
    name: 'repo_locate',
    description: 'Local path of a repo from the user config (like backe repo where)',
    input: z.strictObject({ name: z.string() }),
    kind: 'read',
    surfaces: ALL_SURFACES,
    run: async (ctx, a) => repoLocateJson(await locateRepo(ctx, a.name)),
  }),
  tool({
    name: 'attachment_get',
    description:
      'Get an attachment of an issue (like backe attach get); small UTF-8 files are included as text',
    input: z.strictObject({ id: z.string(), name: z.string() }),
    kind: 'read',
    surfaces: ALL_SURFACES,
    run: async (ctx, a) => {
      const att = await getAttachment(ctx, a.id, a.name);
      const view = attachmentJson(att);
      if ('url' in att) return view;
      const text = await textOf(att.path, att.size);
      return text === undefined ? view : { ...view, text };
    },
  }),
];
