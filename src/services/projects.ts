/** Projekte (backe.md §2.9): anlegen, listen, zeigen, verschieben, entfernen. */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Project } from '../core/schemas.ts';
import { isSettled, type State } from '../core/state.ts';
import type { OpOf } from '../ops/operation.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { openSnapshot, resolveHandle } from './read.ts';
import type { WriteDeps } from './write.ts';

export function createProject(
  ctx: ResolvedContext,
  input: { path: string; title: string; lead?: string; body?: string },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const op: OpOf<'project.create'> = { op: 'project.create', path: input.path, title: input.title };
  if (input.lead !== undefined) op.lead = resolveHandle(ctx, input.lead);
  if (input.body !== undefined) op.body = input.body;
  return writeOp(ctx, () => op, deps);
}

export async function listProjects(
  ctx: ResolvedContext,
): Promise<{ path: string; title: string; lead?: string; open: number }[]> {
  const { snapshot: s } = await openSnapshot(ctx);
  // Wie `showProject`: ein Issue zählt für jedes Projekt und alle seine Vorfahren, je einmal.
  const open = new Map<string, number>();
  for (const { data } of s.issues.values()) {
    if (isSettled(data.state)) continue;
    const counted = new Set<string>();
    for (const p of data.projects ?? []) {
      const parts = p.split('/');
      for (let n = 1; n <= parts.length; n++) counted.add(parts.slice(0, n).join('/'));
    }
    for (const path of counted) open.set(path, (open.get(path) ?? 0) + 1);
  }
  return [...s.projects.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, { data }]) => ({
      path,
      title: data.title,
      ...(data.lead === undefined ? {} : { lead: data.lead }),
      open: open.get(path) ?? 0,
    }));
}

export async function showProject(
  ctx: ResolvedContext,
  path: string,
): Promise<{
  path: string;
  project: Project;
  body: string;
  subprojects: string[];
  counts: Partial<Record<State, number>>;
}> {
  const { snapshot: s } = await openSnapshot(ctx);
  const stored = s.projects.get(path);
  if (stored === undefined) {
    throw new BackeError('not_found', `Projekt »${path}« nicht gefunden`);
  }
  const inTree = (p: string): boolean => p === path || p.startsWith(`${path}/`);
  const counts: Partial<Record<State, number>> = {};
  for (const { data } of s.issues.values()) {
    if ((data.projects ?? []).some(inTree)) counts[data.state] = (counts[data.state] ?? 0) + 1;
  }
  return {
    path,
    project: stored.data,
    body: stored.body,
    subprojects: [...s.projects.keys()].filter((p) => p.startsWith(`${path}/`)).sort(),
    counts,
  };
}

export function moveProject(
  ctx: ResolvedContext,
  from: string,
  to: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  return writeOp(ctx, () => ({ op: 'project.mv', from, to }), deps);
}

export function removeProject(
  ctx: ResolvedContext,
  path: string,
  input: { reassign?: string; detach?: boolean },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  if (input.reassign !== undefined && input.detach === true) {
    throw new BackeError('usage', '--reassign und --detach schließen sich aus');
  }
  const op: OpOf<'project.rm'> = { op: 'project.rm', path };
  if (input.reassign !== undefined) op.reassign = input.reassign;
  if (input.detach === true) op.detach = true;
  return writeOp(ctx, () => op, deps);
}
