/**
 * Schreibende Tools (backe.md §2.19): jedes ruft genau einen Service, der genau eine Operation
 * (bzw. `batch` einen Batch) schreibt. Die Warteschlange und der Sync-Nachlauf stecken in
 * `defineTool` mit `kind: 'write'`.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, sep } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { expandPath, isMissing, physicalPath } from '../context/paths.ts';
import { BackeError } from '../core/errors.ts';
import { PROP_KEY_RE } from '../core/names.ts';
import { type AttachSource, addAttachment } from '../services/attachments.ts';
import { runBatch } from '../services/batch.ts';
import { addComment } from '../services/comments.ts';
import {
  createIssue,
  deleteIssue,
  editIssue,
  moveIssue,
  type RankPositionInput,
  rankIssue,
  reopenIssue,
  resumeIssue,
} from '../services/issues.ts';
import { batchJson, outcomeJson } from '../services/views.ts';
import { defineTool, type ToolEnv } from './tool.ts';

const strings = z.array(z.string());

/**
 * `props` als Objekt zu den Ausdrücken `<key>:=<json>` für den Service; `null` ist nur mit
 * `allowNull` erlaubt (`issue_update`) und wird zum Entfernen des Keys.
 */
export function propsArgs(
  props: Record<string, unknown>,
  allowNull: boolean,
): { props: string[]; unset: string[] } {
  const out = { props: [] as string[], unset: [] as string[] };
  for (const [key, value] of Object.entries(props)) {
    if (!PROP_KEY_RE.test(key)) {
      throw new BackeError('validation', `Ungültiger Property-Key »${key}«`, {
        hint: 'erlaubt: Kleinbuchstaben, Ziffern, _ . -, beginnend mit einem Buchstaben',
      });
    }
    if (value === null) {
      if (!allowNull) {
        throw new BackeError('validation', `Property »${key}«: null geht nur in issue_update`);
      }
      out.unset.push(key);
    } else {
      out.props.push(`${key}:=${JSON.stringify(value)}`);
    }
  }
  return out;
}

type RankArgs = {
  top?: boolean | undefined;
  bottom?: boolean | undefined;
  before?: string | undefined;
  after?: string | undefined;
  value?: number | undefined;
};

function rankPosition(a: RankArgs): RankPositionInput {
  const given: RankPositionInput[] = [];
  if (a.top === true) given.push({ top: true });
  if (a.bottom === true) given.push({ bottom: true });
  if (a.before !== undefined) given.push({ before: a.before });
  if (a.after !== undefined) given.push({ after: a.after });
  if (a.value !== undefined) {
    if (!Number.isInteger(a.value)) {
      throw new BackeError('validation', `Ungültiger Rang: »${a.value}«`, {
        hint: 'erwartet eine ganze Zahl',
      });
    }
    given.push({ value: a.value });
  }
  const [only] = given;
  if (given.length !== 1 || only === undefined) {
    throw new BackeError('usage', 'Genau eine Position angeben', {
      hint: 'top, bottom, before, after oder value',
    });
  }
  return only;
}

type AttachArgs = {
  name: string;
  path?: string | undefined;
  url?: string | undefined;
  json?: string | undefined;
  text?: string | undefined;
};

/** Liegt `path` in `root` oder ist es `root` selbst? Beide physisch; verglichen wird je Segment. */
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/**
 * Die Quelle eines Anhangs. `path` darf nur auf eine Datei im Arbeitsverzeichnis des Servers
 * zeigen, auch über Symlinks hinweg: Ein Agent soll keine beliebige Datei, die der Prozess lesen
 * kann, in den geteilten, signierten Backlog committen.
 */
async function attachSource(a: AttachArgs, home: string, cwd: string): Promise<AttachSource> {
  const given = [a.path, a.url, a.json, a.text].filter((v) => v !== undefined).length;
  if (given !== 1) {
    throw new BackeError('usage', 'Genau eins von path, url, json, text angeben');
  }
  if (a.url !== undefined) return { kind: 'url', url: a.url };
  if (a.json !== undefined) return { kind: 'json', text: a.json };
  if (a.text !== undefined) {
    return { kind: 'file', fileName: a.name, content: new TextEncoder().encode(a.text) };
  }
  const raw = a.path as string;
  const path = expandPath(raw, { home, base: cwd });
  const real = await physicalPath(path);
  if (!within(await physicalPath(cwd), real)) {
    throw new BackeError('validation', `Datei »${raw}« liegt außerhalb des Arbeitsverzeichnisses`, {
      hint: 'Inhalt per text oder json übergeben',
    });
  }
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(real);
  } catch (error) {
    if (isMissing(error)) throw new BackeError('not_found', `Datei »${a.path}« nicht gefunden`);
    throw new BackeError('unexpected', `»${path}«: ${(error as NodeJS.ErrnoException).code}`);
  }
  if (!info.isFile()) throw new BackeError('validation', `${path} ist keine Datei`);
  return { kind: 'file', fileName: basename(path), content: await readFile(real) };
}

/**
 * Operationen, die `batch` im MCP-Modus annimmt: dieselben Writes wie die Einzel-Tools, dazu
 * `issue.delete` nur mit `--allow-delete`. Alles andere (Projekte, Sprints, Repos, User, Löschen
 * von Kommentaren und Anhängen) bleibt dem CLI vorbehalten (backe.md §2.19).
 */
const BATCH_OPS: ReadonlySet<string> = new Set([
  'issue.create',
  'issue.edit',
  'issue.move',
  'issue.resume',
  'issue.reopen',
  'issue.rank',
  'comment.add',
  'attach.add',
]);

/**
 * Lehnt die erste Operation mit einem `op` außerhalb von {@link BATCH_OPS} ab, bevor der Batch
 * etwas liest oder schreibt. Einträge ohne String-`op` prüft `runBatch` mit seiner eigenen Meldung.
 * Jede Operation steht auf einer eigenen Zeile; die Nummer zählt wie dort ab 1.
 */
export function rejectBatchOps(
  ops: readonly Record<string, unknown>[],
  allowDelete: boolean,
): void {
  ops.forEach((o, i) => {
    const op = o.op;
    if (typeof op !== 'string') return;
    if (BATCH_OPS.has(op) || (allowDelete && op === 'issue.delete')) return;
    const line = i + 1;
    throw new BackeError('validation', `Zeile ${line}: »${op}« gibt es im MCP-Modus nicht`, {
      details: { line },
    });
  });
}

export function registerWriteTools(server: McpServer, env: ToolEnv): void {
  defineTool(
    server,
    env,
    'issue_create',
    {
      description: 'Issue anlegen (wie backe issue create); props ist ein Objekt',
      input: z.strictObject({
        title: z.string(),
        body: z.string().optional(),
        state: z.string().optional(),
        projects: strings.optional(),
        sprints: strings.optional(),
        repos: strings.optional(),
        assignee: z.string().optional(),
        depends_on: strings.optional(),
        parent: z.string().optional(),
        props: z.record(z.string(), z.unknown()).optional(),
      }),
      kind: 'write',
    },
    async (ctx, a) => {
      const input: Parameters<typeof createIssue>[1] = { title: a.title };
      if (a.body !== undefined) input.body = a.body;
      if (a.state !== undefined) input.state = a.state;
      if (a.projects !== undefined) input.projects = a.projects;
      if (a.sprints !== undefined) input.sprints = a.sprints;
      if (a.repos !== undefined) input.repos = a.repos;
      if (a.assignee !== undefined) input.assignee = a.assignee;
      if (a.depends_on !== undefined) input.deps = a.depends_on;
      if (a.parent !== undefined) input.parent = a.parent;
      if (a.props !== undefined) input.props = propsArgs(a.props, false).props;
      return outcomeJson(await createIssue(ctx, input, env.opts.deps?.write));
    },
  );

  defineTool(
    server,
    env,
    'issue_update',
    {
      description:
        'Issue ändern (wie backe issue edit / assign); parent und assignee: null entfernt, props: null entfernt den Key',
      input: z.strictObject({
        id: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        add_projects: strings.optional(),
        rm_projects: strings.optional(),
        add_sprints: strings.optional(),
        rm_sprints: strings.optional(),
        add_deps: strings.optional(),
        rm_deps: strings.optional(),
        parent: z.string().nullable().optional(),
        assignee: z.string().nullable().optional(),
        props: z.record(z.string(), z.unknown()).optional(),
      }),
      kind: 'write',
    },
    async (ctx, a) => {
      const input: Parameters<typeof editIssue>[2] = {};
      if (a.title !== undefined) input.title = a.title;
      if (a.body !== undefined) input.body = a.body;
      if (a.add_projects !== undefined) input.addProjects = a.add_projects;
      if (a.rm_projects !== undefined) input.rmProjects = a.rm_projects;
      if (a.add_sprints !== undefined) input.addSprints = a.add_sprints;
      if (a.rm_sprints !== undefined) input.rmSprints = a.rm_sprints;
      if (a.add_deps !== undefined) input.addDeps = a.add_deps;
      if (a.rm_deps !== undefined) input.rmDeps = a.rm_deps;
      if (a.parent !== undefined) input.parent = a.parent;
      if (a.assignee !== undefined) input.assignee = a.assignee;
      if (a.props !== undefined) {
        const p = propsArgs(a.props, true);
        input.props = p.props;
        input.unsetProps = p.unset;
      }
      return outcomeJson(await editIssue(ctx, a.id, input, env.opts.deps?.write));
    },
  );

  defineTool(
    server,
    env,
    'issue_move',
    {
      description: 'Issue in einen State verschieben (wie backe issue move)',
      input: z.strictObject({
        id: z.string(),
        to: z.string(),
        reason: z.string().optional(),
        blocked_by: strings.optional(),
        force: z.boolean().optional(),
      }),
      kind: 'write',
    },
    async (ctx, a) => {
      const input: Parameters<typeof moveIssue>[2] = { to: a.to };
      if (a.reason !== undefined) input.reason = a.reason;
      if (a.blocked_by !== undefined) input.blockedBy = a.blocked_by;
      if (a.force !== undefined) input.force = a.force;
      return outcomeJson(await moveIssue(ctx, a.id, input, env.opts.deps?.write));
    },
  );

  defineTool(
    server,
    env,
    'issue_resume',
    {
      description: 'Blockiertes Issue fortsetzen (wie backe issue resume)',
      input: z.strictObject({ id: z.string(), reason: z.string().optional() }),
      kind: 'write',
    },
    async (ctx, a) =>
      outcomeJson(
        await resumeIssue(
          ctx,
          a.id,
          a.reason === undefined ? {} : { reason: a.reason },
          env.opts.deps?.write,
        ),
      ),
  );

  defineTool(
    server,
    env,
    'issue_reopen',
    {
      description: 'Abgeschlossenes Issue wieder öffnen (wie backe issue reopen)',
      input: z.strictObject({
        id: z.string(),
        to: z.string().optional(),
        reason: z.string().optional(),
      }),
      kind: 'write',
    },
    async (ctx, a) => {
      const input: Parameters<typeof reopenIssue>[2] = {};
      if (a.to !== undefined) input.to = a.to;
      if (a.reason !== undefined) input.reason = a.reason;
      return outcomeJson(await reopenIssue(ctx, a.id, input, env.opts.deps?.write));
    },
  );

  defineTool(
    server,
    env,
    'issue_rank',
    {
      description:
        'Issue neu einreihen (wie backe issue rank); genau eins von top, bottom, before, after, value',
      input: z.strictObject({
        id: z.string(),
        top: z.boolean().optional(),
        bottom: z.boolean().optional(),
        before: z.string().optional(),
        after: z.string().optional(),
        value: z.number().optional(),
      }),
      kind: 'write',
    },
    async (ctx, a) =>
      outcomeJson(await rankIssue(ctx, a.id, rankPosition(a), env.opts.deps?.write)),
  );

  if (env.opts.allowDelete) {
    defineTool(
      server,
      env,
      'issue_delete',
      {
        description: 'Issue endgültig löschen (wie backe issue delete); nur mit --allow-delete',
        input: z.strictObject({
          id: z.string(),
          force: z.boolean().optional(),
          children: z.enum(['orphan', 'recursive']).optional(),
        }),
        kind: 'write',
      },
      async (ctx, a) => {
        const input: Parameters<typeof deleteIssue>[2] = {};
        if (a.force !== undefined) input.force = a.force;
        if (a.children !== undefined) input.children = a.children;
        return outcomeJson(await deleteIssue(ctx, a.id, input, env.opts.deps?.write));
      },
    );
  }

  defineTool(
    server,
    env,
    'comment_add',
    {
      description: 'Kommentar an ein Issue schreiben (wie backe comment add)',
      input: z.strictObject({ id: z.string(), body: z.string() }),
      kind: 'write',
    },
    async (ctx, a) => outcomeJson(await addComment(ctx, a.id, a.body, env.opts.deps?.write)),
  );

  defineTool(
    server,
    env,
    'attachment_add',
    {
      description:
        'Anhang hinzufügen (wie backe attach add); genau eins von path (Datei im Arbeitsverzeichnis des Servers, relativ dazu), url, json, text',
      input: z.strictObject({
        id: z.string(),
        name: z.string(),
        path: z.string().optional(),
        url: z.string().optional(),
        json: z.string().optional(),
        text: z.string().optional(),
      }),
      kind: 'write',
    },
    async (ctx, a) => {
      const source = await attachSource(a, ctx.homes.home, env.opts.cwd);
      return outcomeJson(
        await addAttachment(ctx, a.id, { name: a.name, source }, env.opts.deps?.write),
      );
    },
  );

  defineTool(
    server,
    env,
    'batch',
    {
      description:
        'Mehrere Operationen in einem Commit (wie backe batch); ops sind Objekte im Format von backe.md §2.16.6, Platzhalter wie $a verbinden sie; erlaubt sind issue.create, issue.edit, issue.move, issue.resume, issue.reopen, issue.rank, comment.add, attach.add mit url und mit --allow-delete issue.delete',
      input: z.strictObject({ ops: z.array(z.record(z.string(), z.unknown())) }),
      kind: 'write',
    },
    async (ctx, a) => {
      if (a.ops.length === 0) {
        throw new BackeError('usage', 'batch braucht mindestens eine Operation');
      }
      rejectBatchOps(a.ops, env.opts.allowDelete);
      const text = a.ops.map((o) => JSON.stringify(o)).join('\n');
      return batchJson(await runBatch(ctx, text, env.opts.deps?.write));
    },
  );
}
