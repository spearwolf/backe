/** Repo-Registry (backe.md §2.11): registrieren, listen, entfernen. */
import type { ResolvedContext } from '../context/resolve.ts';
import { parseRepoRef } from '../core/names.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import type { OpOf } from '../ops/operation.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { openSnapshot } from './read.ts';
import type { WriteDeps } from './write.ts';

export function addRepo(
  ctx: ResolvedContext,
  input: { url: string; name?: string; defaultRef?: string; body?: string },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const op: OpOf<'repo.add'> = { op: 'repo.add', url: input.url };
  if (input.name !== undefined) op.name = input.name;
  if (input.defaultRef !== undefined) op.default_ref = input.defaultRef;
  if (input.body !== undefined) op.body = input.body;
  return writeOp(ctx, () => op, deps);
}

export async function listRepos(ctx: ResolvedContext): Promise<
  {
    name: string;
    url: string;
    canonical: string;
    defaultRef?: string;
    issues: number;
  }[]
> {
  const { snapshot: s } = await openSnapshot(ctx);
  const linked = new Map<string, number>();
  for (const { data } of s.issues.values()) {
    const names = new Set((data.repos ?? []).map((r) => parseRepoRef(r).name));
    for (const name of names) linked.set(name, (linked.get(name) ?? 0) + 1);
  }
  return [...s.repos.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, { data }]) => ({
      name,
      url: data.url,
      canonical: normalizeRepoUrl(data.url),
      ...(data.default_ref === undefined ? {} : { defaultRef: data.default_ref }),
      issues: linked.get(name) ?? 0,
    }));
}

export function removeRepo(
  ctx: ResolvedContext,
  name: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  return writeOp(ctx, () => ({ op: 'repo.rm', name }), deps);
}
