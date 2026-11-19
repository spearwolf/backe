/** `backe context` (backe.md §2.14, §2.24): aufgelöste Kontextwerte mit Herkunft, optional die Property-Deklarationen. */
import type { Resolved, ResolvedContext } from '../context/resolve.ts';
import type { BacklogConfig } from '../core/schemas.ts';
import { openSnapshot } from './read.ts';

export type ContextInfo = {
  backlog: Resolved<string> & { root?: string };
  user: Resolved<string | undefined> & { key?: string; canWrite: boolean };
  project: Resolved<string | undefined>;
  sprint: Resolved<string | undefined>;
  repo: Resolved<string | null | undefined>;
  props?: BacklogConfig['props'];
};

export async function contextInfo(
  ctx: ResolvedContext,
  opts: { props?: boolean } = {},
): Promise<ContextInfo> {
  const { root } = ctx.backlog;
  const { key } = ctx.user;
  return {
    backlog: {
      value: ctx.backlog.value,
      source: ctx.backlog.source,
      ...(root === undefined ? {} : { root }),
    },
    user: {
      value: ctx.user.value,
      source: ctx.user.source,
      ...(key === undefined ? {} : { key }),
      canWrite: ctx.user.value !== undefined && key !== undefined,
    },
    project: ctx.project,
    sprint: ctx.sprint,
    repo: ctx.repo,
    ...(opts.props === true ? { props: (await openSnapshot(ctx)).snapshot.config.props } : {}),
  };
}
