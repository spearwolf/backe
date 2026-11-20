/**
 * Lesende Tools und die Resource `backe://issue/{id}` (backe.md §2.19). Jedes Tool ruft denselben
 * Service und baut das Ergebnis mit derselben Ansicht wie der gleichnamige CLI-Befehl.
 */
import { readFile } from 'node:fs/promises';
import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BackeError } from '../core/errors.ts';
import { getAttachment } from '../services/attachments.ts';
import { scheduleSync } from '../services/background.ts';
import { nextClaim } from '../services/claim.ts';
import { type IssueListQuery, listIssues } from '../services/issue-list.ts';
import { showIssue } from '../services/issue-show.ts';
import { readIssueFile } from '../services/issues.ts';
import { type NextQuery, nextIssue } from '../services/next.ts';
import { listProjects } from '../services/projects.ts';
import { locateRepo } from '../services/repo-local.ts';
import { listSprints, showSprint } from '../services/sprints.ts';
import {
  attachmentJson,
  checkFields,
  issueDetailJson,
  issueListResultJson,
  LIST_FIELDS,
  NEXT_FIELDS,
  nextJson,
  pickFields,
  repoLocateJson,
  SHOW_FIELDS,
  sprintShowJson,
} from '../services/views.ts';
import { defineTool, type ToolEnv } from './tool.ts';

/** Größte Datei, deren Inhalt `attachment_get` als `text` mitliefert. */
const TEXT_LIMIT = 262_144;

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

/**
 * Prüft `fields` vor jedem Service-Aufruf: Ein unbekanntes Feld ist `usage`, bevor gelesen oder
 * (bei `issue_next` mit `claim`) übernommen und gepusht wird.
 */
function checkFieldsFirst(fields: readonly string[] | undefined, allowed: readonly string[]): void {
  if (fields !== undefined) checkFields(fields, allowed);
}

/** Der Inhalt einer Datei als Text, wenn sie klein und gültiges UTF-8 ist; sonst `undefined`. */
async function textOf(path: string, size: number): Promise<string | undefined> {
  if (size > TEXT_LIMIT) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch {
    return undefined;
  }
}

export function registerReadTools(server: McpServer, env: ToolEnv): void {
  defineTool(
    server,
    env,
    'issue_list',
    {
      description:
        'Issues listen und filtern (wie backe issue list); Standard: alle offenen im Kontextfilter',
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
    },
    async (ctx, a) => {
      checkFieldsFirst(a.fields, LIST_FIELDS);
      return issueListResultJson(await listIssues(ctx, listQuery(a)), a.fields);
    },
  );

  defineTool(
    server,
    env,
    'issue_get',
    {
      description: 'Issue mit Beziehungen zeigen (wie backe issue show); Kurz-IDs sind erlaubt',
      input: z.strictObject({
        id: z.string(),
        comments: z.enum(['none', 'last', 'all']).optional(),
        fields: strings.optional(),
      }),
      kind: 'read',
    },
    async (ctx, a) => {
      checkFieldsFirst(a.fields, SHOW_FIELDS);
      const comments = a.comments === 'last' ? 1 : a.comments === 'all' ? 'all' : undefined;
      const d = await showIssue(ctx, a.id, comments === undefined ? {} : { comments });
      const obj = issueDetailJson(d);
      return a.fields === undefined ? obj : pickFields(obj, a.fields, SHOW_FIELDS);
    },
  );

  defineTool(
    server,
    env,
    'issue_next',
    {
      description:
        'Nächstes Issue für mich zeigen (wie backe next); mit claim gleich übernehmen, synchron mit dem Remote',
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
    },
    async (ctx, a) => {
      checkFieldsFirst(a.fields, NEXT_FIELDS);
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
      const r = await nextClaim(ctx, q, env.opts.deps?.claim);
      return nextJson(r, {
        claimed: { commit: r.claim.commit, attempts: r.attempts },
        notices: [...r.notices, ...r.claim.notices],
        warnings: r.claim.warnings,
        ...fields,
      });
    },
  );

  defineTool(
    server,
    env,
    'project_list',
    {
      description: 'Projekte mit der Zahl offener Issues (wie backe project list)',
      input: z.strictObject({}),
      kind: 'read',
    },
    (ctx) => listProjects(ctx),
  );

  defineTool(
    server,
    env,
    'sprint_list',
    {
      description: 'Sprints, offene zuerst, mit der Zahl offener Issues (wie backe sprint list)',
      input: z.strictObject({}),
      kind: 'read',
    },
    (ctx) => listSprints(ctx),
  );

  defineTool(
    server,
    env,
    'sprint_get',
    {
      description: 'Issues eines Sprints, gruppiert nach State (wie backe sprint show)',
      input: z.strictObject({
        slug: z.string(),
        project: strings.optional(),
        repo: strings.optional(),
        all: z.boolean().optional(),
        sort: sortSchema.optional(),
      }),
      kind: 'read',
    },
    async (ctx, a) =>
      sprintShowJson(
        a.slug,
        await showSprint(ctx, a.slug, {
          ...(a.project === undefined ? {} : { projects: a.project }),
          ...(a.repo === undefined ? {} : { repos: a.repo }),
          ...(a.all === true ? { all: true } : {}),
          ...(a.sort === undefined ? {} : { sort: a.sort }),
        }),
      ),
  );

  defineTool(
    server,
    env,
    'repo_locate',
    {
      description: 'Lokaler Pfad eines Repos aus der User-Config (wie backe repo where)',
      input: z.strictObject({ name: z.string() }),
      kind: 'read',
    },
    async (ctx, a) => repoLocateJson(await locateRepo(ctx, a.name)),
  );

  defineTool(
    server,
    env,
    'attachment_get',
    {
      description:
        'Anhang eines Issues holen (wie backe attach get); kleine UTF-8-Dateien kommen als text mit',
      input: z.strictObject({ id: z.string(), name: z.string() }),
      kind: 'read',
    },
    async (ctx, a) => {
      const att = await getAttachment(ctx, a.id, a.name);
      const view = attachmentJson(att);
      if ('url' in att) return view;
      const text = await textOf(att.path, att.size);
      return text === undefined ? view : { ...view, text };
    },
  );
}

/** `{id}` aus der URI, prozent-dekodiert; eine kaputte Kodierung ist `validation`. */
function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BackeError('validation', `Ungültige Issue-ID in der URI: »${raw}«`);
  }
}

/** `backe://issue/{id}`: die Issue-Datei als Markdown; `{id}` darf eine Kurz-ID sein. */
export function registerIssueResource(server: McpServer, env: ToolEnv): void {
  server.registerResource(
    'issue',
    // Ohne `list`: ein Backlog kann zehntausende Issues haben.
    new ResourceTemplate('backe://issue/{id}', { list: undefined }),
    {
      description: 'Issue-Datei (Frontmatter und Markdown) nach ID oder Kurz-ID',
      mimeType: 'text/markdown',
    },
    async (_uri, variables) => {
      const ctx = await env.context();
      await scheduleSync(ctx, 'read', env.opts.deps?.sync);
      const raw = variables.id;
      const ref = decodeId(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''));
      const f = await readIssueFile(ctx, ref);
      return {
        contents: [{ uri: `backe://issue/${f.id}`, mimeType: 'text/markdown', text: f.text }],
      };
    },
  );
}
