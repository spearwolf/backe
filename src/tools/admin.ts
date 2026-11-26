/**
 * Verwaltungs-Tools nur für `backe ui` (ui.md §2.3.2): Links, Kommentare, Anhänge, Projekte,
 * Sprints, Repos und Users ändern oder löschen. Wie bei den schreibenden Tools ruft jedes genau einen Service, die
 * Ergebnisse sind die `outcomeJson` der CLI-Befehle mit `--format json`. MCP bietet sie nicht an.
 */
import { z } from 'zod';
import { createAgent } from '../services/agent.ts';
import { removeAttachment } from '../services/attachments.ts';
import { deleteComment, editComment } from '../services/comments.ts';
import { linkIssue, unlinkIssue } from '../services/issues.ts';
import { createProject, moveProject, removeProject } from '../services/projects.ts';
import { checkRepoResult } from '../services/repo-check.ts';
import { addRepo, removeRepo } from '../services/repos.ts';
import { closeSprint, createSprint } from '../services/sprints.ts';
import { addUser, removeUser, revokeKey } from '../services/users.ts';
import { outcomeJson, repoCheckJson } from '../services/views.ts';
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
  tool({
    name: 'repo_add',
    description:
      'Register a repo (like backe repo add); ref is its default ref, body its description',
    input: z.strictObject({
      url: z.string(),
      name: z.string().optional(),
      ref: z.string().optional(),
      body: z.string().optional(),
    }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof addRepo>[1] = { url: a.url };
      if (a.name !== undefined) input.name = a.name;
      if (a.ref !== undefined) input.defaultRef = a.ref;
      if (a.body !== undefined) input.body = a.body;
      return outcomeJson(await addRepo(ctx, input, env.deps?.write));
    },
  }),
  tool({
    name: 'repo_rm',
    description: 'Remove a repo (like backe repo rm)',
    input: z.strictObject({ name: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => outcomeJson(await removeRepo(ctx, a.name, env.deps?.write)),
  }),
  tool({
    name: 'repo_check',
    description:
      'Check repos (like backe repo check); findings carry their level, errors are not a failure',
    input: z.strictObject({
      names: z.array(z.string()).optional(),
      remote: z.boolean().optional(),
      fresh: z.boolean().optional(),
    }),
    kind: 'read',
    surfaces: UI_ONLY,
    run: async (ctx, a) => {
      const input: Parameters<typeof checkRepoResult>[1] = {};
      if (a.names !== undefined) input.names = a.names;
      if (a.remote === true) input.remote = true;
      if (a.fresh === true) input.fresh = true;
      return repoCheckJson(await checkRepoResult(ctx, input));
    },
  }),
  tool({
    name: 'user_add',
    description:
      'Add a user (like backe user add); key is the public key line (ssh-ed25519 AAAA...), not a path',
    input: z.strictObject({
      handle: z.string(),
      key: z.string(),
      name: z.string().optional(),
      agent: z.boolean().optional(),
      operator: z.string().optional(),
    }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof addUser>[1] = { handle: a.handle, key: a.key };
      if (a.name !== undefined) input.name = a.name;
      if (a.agent === true) input.agent = true;
      if (a.operator !== undefined) input.operator = a.operator;
      return outcomeJson(await addUser(ctx, input, env.deps?.write));
    },
  }),
  tool({
    name: 'user_create_agent',
    description:
      'Create an agent with its own key pair (like backe user create-agent); answers handle, key_path and commit',
    input: z.strictObject({ handle: z.string(), name: z.string().optional() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => {
      const input: Parameters<typeof createAgent>[1] = { handle: a.handle };
      if (a.name !== undefined) input.name = a.name;
      const r = await createAgent(ctx, input, env.deps?.write);
      return { handle: a.handle, key_path: r.keyPath, commit: r.commit };
    },
  }),
  tool({
    name: 'user_revoke_key',
    description:
      'Revoke a user key (like backe user revoke-key); fingerprint is full or a prefix of 8+ characters',
    input: z.strictObject({ handle: z.string(), fingerprint: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) =>
      outcomeJson(await revokeKey(ctx, a.handle, a.fingerprint, env.deps?.write)),
  }),
  tool({
    name: 'user_rm',
    description: 'Remove a user (like backe user rm)',
    input: z.strictObject({ handle: z.string() }),
    kind: 'write',
    surfaces: UI_ONLY,
    run: async (ctx, a, env) => outcomeJson(await removeUser(ctx, a.handle, env.deps?.write)),
  }),
];
