/**
 * `backe next` ohne Claim (backe.md §2.22, §2.23): das nächste Issue für den Akteur, ohne es zu
 * übernehmen. Ohne Kandidat ist das ein `not_found` mit dem Grund.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import { selectNext } from '../ops/next.ts';
import type { Notice } from '../ops/notice.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { hasOpenDeps } from './issue-list.ts';
import { effectiveFilter, openSnapshot } from './read.ts';

export type NextOutcome = {
  header: Record<string, string>;
  issue: Issue;
  resumed: boolean;
  /** Hat das Issue offene `depends_on`? Möglich bei einem fortgesetzten `in_progress`-Issue. */
  openDeps: boolean;
  notices: Notice[];
};

export type NextQuery = {
  level?: 'leaf' | 'top';
  project?: string;
  sprint?: string;
  repo?: string;
  all?: boolean;
  /** Issues, die nicht gewählt werden: die Kandidaten verlorener Claims (`next --claim`). */
  exclude?: readonly string[];
};

/** Der Handle, für den `next` wählt; ohne Identität `usage`. */
export function nextActor(ctx: ResolvedContext): string {
  const actor = ctx.user.value;
  if (actor === undefined) {
    throw new BackeError('usage', '»next« braucht eine Identität', {
      hint: 'mit --as <handle> angeben oder eine Identität setzen',
    });
  }
  return actor;
}

export async function nextIssue(ctx: ResolvedContext, q: NextQuery): Promise<NextOutcome> {
  const actor = nextActor(ctx);
  const { snapshot } = await openSnapshot(ctx);
  return pickNext(ctx, snapshot, actor, q);
}

/**
 * Die Auswahl von `next` auf dem Stand `s`, rein: das nächste Issue für `actor` im Kontextfilter,
 * ohne die Issues aus `q.exclude`. Ohne Kandidat `not_found` mit dem Grund.
 */
export function pickNext(
  ctx: ResolvedContext,
  s: BacklogSnapshot,
  actor: string,
  q: NextQuery,
): NextOutcome {
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
    ...(q.exclude === undefined ? {} : { exclude: q.exclude }),
    filter: {
      ...(f.project?.[0] === undefined ? {} : { project: f.project[0] }),
      ...(f.sprint?.[0] === undefined ? {} : { sprint: f.sprint[0] }),
      ...(f.repo?.[0] === undefined ? {} : { repo: f.repo[0] }),
    },
  });
  const chosen = result.id === undefined ? undefined : s.issues.get(result.id)?.data;
  if (chosen) {
    return {
      header: f.header,
      issue: chosen,
      resumed: result.resumed,
      openDeps: hasOpenDeps(s, chosen),
      notices: result.notices,
    };
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
