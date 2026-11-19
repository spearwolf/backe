/**
 * Issues anlegen und bearbeiten (backe.md §2.4, §2.14, §2.17, §2.23, §2.24). Jede Operation wird
 * unter dem Write-Lock gegen den gesperrten Snapshot abgeleitet; Vorbedingungen (`from`) stammen
 * von dort, nicht aus einem früheren Lesen.
 */
import { isDeepStrictEqual } from 'node:util';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { PropValue } from '../core/schemas.ts';
import { normalizeStateInput } from '../core/state.ts';
import { bodyHash, type OpOf } from '../ops/operation.ts';
import { parsePropAssignment } from '../ops/props.ts';
import { canonicalBody } from '../store/frontmatter.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { resolveHandle, resolveIssueRef } from './read.ts';
import type { WriteDeps } from './write.ts';

export type IssueCreateInput = {
  title: string;
  body?: string;
  state?: string;
  projects?: string[];
  sprints?: string[];
  repos?: string[];
  assignee?: string;
  deps?: string[];
  parent?: string;
  props?: string[];
};

export type IssueEditInput = {
  title?: string;
  addProjects?: string[];
  rmProjects?: string[];
  addSprints?: string[];
  rmSprints?: string[];
  addDeps?: string[];
  rmDeps?: string[];
  parent?: string | null;
  props?: string[];
  unsetProps?: string[];
  body?: string;
};

/** `k=v`-/`k:=json`-Ausdrücke zu einem Record; derselbe Key zweimal ist ein Aufruffehler. */
function parseProps(exprs: readonly string[]): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const expr of exprs) {
    const [key, value] = parsePropAssignment(expr);
    if (Object.hasOwn(out, key)) {
      throw new BackeError('usage', `Property »${key}« mehrfach angegeben`);
    }
    out[key] = value;
  }
  return out;
}

export function createIssue(
  ctx: ResolvedContext,
  input: IssueCreateInput,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  return writeOp(
    ctx,
    (s) => {
      const op: OpOf<'issue.create'> = { op: 'issue.create', title: input.title };
      if (input.body !== undefined) op.body = input.body;
      if (input.state !== undefined) op.state = normalizeStateInput(input.state);
      if (input.assignee !== undefined) op.assignee = resolveHandle(ctx, input.assignee);
      if (input.deps !== undefined && input.deps.length > 0) {
        op.depends_on = input.deps.map((d) => resolveIssueRef(s, d));
      }
      if (input.props !== undefined && input.props.length > 0) op.props = parseProps(input.props);

      if (input.parent !== undefined) {
        // Mit Parent erbt die Ops-Schicht, was die Eingabe nicht setzt; kein Kontext-Default.
        op.parent = resolveIssueRef(s, input.parent);
        if (input.projects !== undefined) op.projects = input.projects;
        if (input.sprints !== undefined) op.sprints = input.sprints;
        if (input.repos !== undefined) op.repos = input.repos;
      } else {
        const project = input.projects ?? (ctx.project.value ? [ctx.project.value] : undefined);
        const sprint = input.sprints ?? (ctx.sprint.value ? [ctx.sprint.value] : undefined);
        const repo = input.repos ?? (ctx.repo.value ? [ctx.repo.value] : undefined);
        if (project !== undefined) op.projects = project;
        if (sprint !== undefined) op.sprints = sprint;
        if (repo !== undefined) op.repos = repo;
      }
      return op;
    },
    deps,
  );
}

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

export async function editIssue(
  ctx: ResolvedContext,
  ref: string,
  input: IssueEditInput,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const props = parseProps(input.props ?? []);
  const unset = unique(input.unsetProps ?? []);
  for (const key of unset) {
    if (Object.hasOwn(props, key)) {
      throw new BackeError('usage', `Property »${key}« gleichzeitig setzen und entfernen`);
    }
  }
  return writeOp(
    ctx,
    (s) => {
      const id = resolveIssueRef(s, ref);
      const current = s.issues.get(id);
      if (current === undefined) throw new BackeError('not_found', `Issue »${id}« nicht gefunden`);
      const issue = current.data;
      const op: OpOf<'issue.edit'> = { op: 'issue.edit', id };

      const set: NonNullable<OpOf<'issue.edit'>['set']> = {};
      if (input.title !== undefined && input.title !== issue.title) {
        set.title = { from: issue.title, to: input.title };
      }
      if (input.parent !== undefined) {
        const to = input.parent === null ? null : resolveIssueRef(s, input.parent);
        const from = issue.parent ?? null;
        if (to !== from) set.parent = { from, to };
      }
      if (Object.keys(set).length > 0) op.set = set;

      const lists = [
        ['projects', input.addProjects, input.rmProjects, issue.projects],
        ['sprints', input.addSprints, input.rmSprints, issue.sprints],
        [
          'depends_on',
          input.addDeps?.map((d) => resolveIssueRef(s, d)),
          input.rmDeps?.map((d) => resolveIssueRef(s, d)),
          issue.depends_on,
        ],
      ] as const;
      const add: NonNullable<OpOf<'issue.edit'>['add']> = {};
      const remove: NonNullable<OpOf<'issue.edit'>['remove']> = {};
      for (const [field, adds, removes, have = []] of lists) {
        const toAdd = unique(adds ?? []);
        for (const v of toAdd) {
          if ((removes ?? []).includes(v)) {
            throw new BackeError('usage', `»${v}« steht in add… und rm… (${field})`);
          }
        }
        const toRemove = unique(removes ?? []).filter((v) => have.includes(v));
        const missing = toAdd.filter((v) => !have.includes(v));
        if (missing.length > 0) add[field] = missing;
        if (toRemove.length > 0) remove[field] = toRemove;
      }
      if (Object.keys(add).length > 0) op.add = add;
      if (Object.keys(remove).length > 0) op.remove = remove;

      const changes: NonNullable<OpOf<'issue.edit'>['props']> = {};
      for (const [key, to] of Object.entries(props)) {
        const from =
          issue.props !== undefined && Object.hasOwn(issue.props, key) ? issue.props[key] : null;
        if (!isDeepStrictEqual(from, to)) changes[key] = { from: from ?? null, to };
      }
      for (const key of unset) {
        if (issue.props !== undefined && Object.hasOwn(issue.props, key)) {
          changes[key] = { from: issue.props[key] ?? null, to: null };
        }
      }
      if (Object.keys(changes).length > 0) op.props = changes;

      if (input.body !== undefined && canonicalBody(input.body) !== current.body) {
        op.body = { from_hash: bodyHash(current.body), to: input.body };
      }

      if (Object.keys(op).length === 2) {
        throw new BackeError('usage', 'Nichts zu ändern');
      }
      return op;
    },
    deps,
  );
}
