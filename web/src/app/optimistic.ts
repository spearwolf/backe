/**
 * Optimistische Überlagerungen für `Writes.run` (ui.md §2.5): was der Server nach dem Aufruf in
 * die Issues schriebe, gerechnet mit demselben reinen BK-Code. Listen stehen in der Form, in der
 * der Server sie schreibt; ein Schlüssel mit `undefined` entfernt das Feld.
 */
import { BackeError } from '@backe/core/errors.ts';
import { planTransition } from '@backe/core/state.ts';
import { type RankPosition, rankPlacement } from '@backe/ops/rank.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import type { IssueJson, ToolArgs } from '@backe/ui/api.ts';
import type { StateAction } from './state-actions.ts';

type Overlay = Map<string, Partial<IssueJson>>;

/**
 * Eine Überlagerung ist nur Vorschau: Lehnt die Rechnung ab (`BackeError`, etwa ein Anker oder
 * eine Blocker-ID, die BK nicht annimmt), läuft der Write ohne sie und der Server entscheidet
 * allein. Jeder andere Wurf ist ein Fehler im Client und fliegt weiter.
 */
export function preview<T>(compute: () => T): T | undefined {
  try {
    return compute();
  } catch (cause) {
    if (cause instanceof BackeError) return undefined;
    throw cause;
  }
}

/**
 * Das Ergebnis von `planTransition`; fehlende Felder werden ausdrücklich gelöscht. Wirft `BackeError`
 * für Aktionen, die `stateActions` nicht anbietet: Aufrufer reichen nur Angebotenes durch.
 */
export function stateOverlay(
  s: BacklogSnapshot,
  id: string,
  action: StateAction,
  blockedBy?: string[],
): Overlay {
  const issue = s.issues.get(id)?.data;
  if (issue === undefined) return new Map();
  const kind =
    action.tool === 'issue_resume' ? 'resume' : action.tool === 'issue_reopen' ? 'reopen' : 'move';
  // Erlaubt war der Wechsel schon beim Anbieten; `strict` ist hier nur die Rechnung, nicht die Regel.
  const next = planTransition(issue, kind, {
    to: action.to,
    strict: false,
    ...(blockedBy === undefined ? {} : { blockedBy }),
  });
  if (next === null) return new Map();
  // `planTransition` liefert nie `blocked` oder `on_hold` als Herkunft, nur das Schema weiß es enger.
  const pausedFrom = next.paused_from as IssueJson['paused_from'];
  return new Map([
    [id, { state: next.state, paused_from: pausedFrom, blocked_by: next.blocked_by }],
  ]);
}

/**
 * `rank` aller Issues, die `rankPlacement` umnummeriert (inklusive `id`). Wirft `BackeError` bei
 * ungültigem Anker, wie `rankPlacement`.
 */
export function rankOverlay(s: BacklogSnapshot, id: string, pos: RankPosition): Overlay {
  return new Map([...rankPlacement(s, id, pos)].map(([key, rank]) => [key, { rank }]));
}

/** Wie `editList` in BK: erst entfernen, dann hinten anhängen, was fehlt; leer entfällt. */
function editList(
  current: readonly string[] | undefined,
  add: readonly string[] | undefined,
  remove: readonly string[] | undefined,
): string[] | undefined {
  const dropped = new Set(remove ?? []);
  const out = (current ?? []).filter((x) => !dropped.has(x));
  for (const x of add ?? []) if (!out.includes(x)) out.push(x);
  return out.length > 0 ? out : undefined;
}

/** Überlagerung von `issue_update`; `body` liegt nicht im Store und entfällt. */
export function updateOverlay(issue: IssueJson, args: ToolArgs['issue_update']): Overlay {
  const o: Partial<IssueJson> = {};
  if (args.title !== undefined) o.title = args.title;
  if (args.assignee !== undefined) o.assignee = args.assignee ?? undefined;
  if (args.parent !== undefined) o.parent = args.parent ?? undefined;
  const lists = [
    ['projects', args.add_projects, args.rm_projects],
    ['sprints', args.add_sprints, args.rm_sprints],
    ['depends_on', args.add_deps, args.rm_deps],
  ] as const;
  for (const [field, add, remove] of lists) {
    if (add !== undefined || remove !== undefined) {
      o[field] = editList(issue[field], add, remove);
    }
  }
  if (args.props !== undefined) {
    const props: Record<string, unknown> = { ...issue.props };
    for (const [key, value] of Object.entries(args.props)) {
      if (value === null) delete props[key];
      else props[key] = value;
    }
    o.props = Object.keys(props).length > 0 ? (props as IssueJson['props']) : undefined;
  }
  return new Map([[issue.id, o]]);
}
