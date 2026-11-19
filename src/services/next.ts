/**
 * `backe next` ohne Claim (backe.md §2.22, §2.23): das nächste Issue für den Akteur, ohne es zu
 * übernehmen. Ohne Kandidat ist das ein `not_found` mit dem Grund.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import { selectNext } from '../ops/next.ts';
import type { Notice } from '../ops/notice.ts';
import { effectiveFilter, openSnapshot } from './read.ts';

export type NextOutcome = {
  header: Record<string, string>;
  issue: Issue;
  resumed: boolean;
  notices: Notice[];
};

export type NextQuery = {
  level?: 'leaf' | 'top';
  project?: string;
  sprint?: string;
  repo?: string;
  all?: boolean;
};

export async function nextIssue(ctx: ResolvedContext, q: NextQuery): Promise<NextOutcome> {
  const actor = ctx.user.value;
  if (actor === undefined) {
    throw new BackeError('usage', '»next« braucht eine Identität', {
      hint: 'mit --as <handle> angeben oder eine Identität setzen',
    });
  }
  const { snapshot: s } = await openSnapshot(ctx);
  const f = effectiveFilter(
    ctx,
    {
      ...(q.project === undefined ? {} : { project: [q.project] }),
      ...(q.sprint === undefined ? {} : { sprint: [q.sprint] }),
      ...(q.repo === undefined ? {} : { repo: [q.repo] }),
    },
    q.all === true,
  );
  const result = selectNext(s, {
    actor,
    level: q.level ?? 'leaf',
    filter: {
      ...(f.project?.[0] === undefined ? {} : { project: f.project[0] }),
      ...(f.sprint?.[0] === undefined ? {} : { sprint: f.sprint[0] }),
      ...(f.repo?.[0] === undefined ? {} : { repo: f.repo[0] }),
    },
  });
  const chosen = result.id === undefined ? undefined : s.issues.get(result.id)?.data;
  if (chosen) {
    return { header: f.header, issue: chosen, resumed: result.resumed, notices: result.notices };
  }
  const reason = result.reason ?? 'nothing_open';
  const messages = {
    waiting: `Nichts bereit: alles wartet auf Abhängigkeiten (${(result.waiting ?? []).join(', ')})`,
    all_assigned: 'Nichts frei: alle bereiten Issues sind vergeben',
    all_blocked: 'Nichts bereit: alles ist blockiert',
    nothing_open: 'Nichts offen',
  } as const;
  throw new BackeError('not_found', messages[reason], {
    details: { reason, ...(result.waiting === undefined ? {} : { waiting: result.waiting }) },
  });
}
