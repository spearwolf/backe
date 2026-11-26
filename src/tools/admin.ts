/**
 * Verwaltungs-Tools nur für `backe ui` (ui.md §2.3.2): Links, Kommentare, Anhänge, Projekte und
 * Sprints ändern oder löschen. Wie bei den schreibenden Tools ruft jedes genau einen Service, die
 * Ergebnisse sind die `outcomeJson` der CLI-Befehle mit `--format json`. MCP bietet sie nicht an.
 */
import { z } from 'zod';
import { removeAttachment } from '../services/attachments.ts';
import { deleteComment, editComment } from '../services/comments.ts';
import { linkIssue, unlinkIssue } from '../services/issues.ts';
import { createProject, moveProject, removeProject } from '../services/projects.ts';
import { closeSprint, createSprint } from '../services/sprints.ts';
import { outcomeJson } from '../services/views.ts';
import { type ToolDef, tool } from './define.ts';

const UI_ONLY = ['ui'] as const;

export const ADMIN_TOOLS: readonly ToolDef[] = [
  tool({
    name: 'issue_link',
    description:
      'Link an issue to a repo or URL (like backe issue link); target is name[@ref] or URL',
    input: z.strictObject({ id: z.string(), target: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => outcomeJson(await linkIssue(ctx, a.id, a.target, env.deps?.write)),
  }),
  tool({
    name: 'issue_unlink',
    description: 'Remove the link from an issue to a repo (like backe issue unlink)',
    input: z.strictObject({ id: z.string(), repo: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => outcomeJson(await unlinkIssue(ctx, a.id, a.repo, env.deps?.write)),
  }),
  tool({
    name: 'comment_edit',
    description:
      'Edit your own comment (like backe comment edit); comment is the file name or index',
    input: z.strictObject({ id: z.string(), comment: z.string(), body: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) =>
      outcomeJson(await editComment(ctx, a.id, a.comment, a.body, env.deps?.write)),
  }),
  tool({
    name: 'comment_delete',
    description:
      'Delete your own comment (like backe comment delete); comment is the file name or index',
    input: z.strictObject({ id: z.string(), comment: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) =>
      outcomeJson(await deleteComment(ctx, a.id, a.comment, env.deps?.write)),
  }),
  tool({
    name: 'attachment_rm',
    description: 'Remove an attachment from an issue (like backe attach rm)',
    input: z.strictObject({ id: z.string(), name: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) =>
      outcomeJson(await removeAttachment(ctx, a.id, a.name, env.deps?.write)),
  }),
  tool({
    name: 'project_create',
    description: 'Create a project (like backe project create); path may nest with /',
    input: z.strictObject({
      path: z.string(),
      title: z.string().optional(),
      lead: z.string().optional(),
      body: z.string().optional(),
    }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof createProject>[1] = { path: a.path };
      if (a.title !== undefined) input.title = a.title;
      if (a.lead !== undefined) input.lead = a.lead;
      if (a.body !== undefined) input.body = a.body;
      return outcomeJson(await createProject(ctx, input, env.deps?.write));
    },
  }),
  tool({
    name: 'project_mv',
    description: 'Move or rename a project (like backe project mv)',
    input: z.strictObject({ from: z.string(), to: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => outcomeJson(await moveProject(ctx, a.from, a.to, env.deps?.write)),
  }),
  tool({
    name: 'project_rm',
    description:
      'Remove a project (like backe project rm); reassign moves its issues to another project, detach removes it from them; not both',
    input: z.strictObject({
      path: z.string(),
      reassign: z.string().optional(),
      detach: z.boolean().optional(),
    }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof removeProject>[2] = {};
      if (a.reassign !== undefined) input.reassign = a.reassign;
      if (a.detach !== undefined) input.detach = a.detach;
      return outcomeJson(await removeProject(ctx, a.path, input, env.deps?.write));
    },
  }),
  tool({
    name: 'sprint_create',
    description: 'Create a sprint (like backe sprint create); start and end as dates',
    input: z.strictObject({
      slug: z.string(),
      title: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      body: z.string().optional(),
    }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof createSprint>[1] = { slug: a.slug };
      if (a.title !== undefined) input.title = a.title;
      if (a.start !== undefined) input.start = a.start;
      if (a.end !== undefined) input.end = a.end;
      if (a.body !== undefined) input.body = a.body;
      return outcomeJson(await createSprint(ctx, input, env.deps?.write));
    },
  }),
  tool({
    name: 'sprint_close',
    description:
      'Close a sprint (like backe sprint close); carry_over moves its open issues to another sprint',
    input: z.strictObject({ slug: z.string(), carry_over: z.string().optional() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof closeSprint>[2] = {};
      if (a.carry_over !== undefined) input.carryOver = a.carry_over;
      return outcomeJson(await closeSprint(ctx, a.slug, input, env.deps?.write));
    },
  }),
];
