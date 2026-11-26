/**
 * Umsortieren gegen einen Anker ohne `rank` (ui.md §2.7). `issue_rank` lehnt einen solchen Anker
 * ab; frisch angelegte Issues haben aber keinen, und im Tab Backlog stehen sie in der globalen
 * Ordnung (`compareIssues`: mit Rang zuerst, dann nach `created`/`id`) hinter allen gerankten.
 * Darum bekommt vorher jedes Issue ohne Rang bis einschließlich zum Anker, in dieser Ordnung, einen
 * Rang am Ende. Ihre Reihenfolge untereinander und zu allen anderen bleibt dabei, wie sie war; das
 * Ganze geht als ein `batch` und damit als ein Commit.
 */
import { compareIssues } from '@backe/ops/order.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';

export type RankMove = { top: true } | { bottom: true } | { before: string } | { after: string };

/** Wohin das Issue soll und welche Issues ohne Rang vorher, in dieser Reihenfolge, ans Ende gehen. */
export type RankSteps = { pos: RankMove; unranked: string[] };

/**
 * Die Schritte für `id` nach `pos`. Ein Anker mit Rang braucht keine. »Ganz unten« heißt die letzte
 * Zeile: Gibt es Issues ohne Rang, ist das letzte der übrigen der Anker (`after`), sonst bliebe
 * `id` über ihnen stehen. Einen Anker, den der Client nicht kennt, beurteilt der Server allein.
 */
export function rankSteps(s: BacklogSnapshot, id: string, pos: RankMove): RankSteps {
  const ordered = [...s.issues.values()].map((e) => e.data).sort(compareIssues);
  let target = pos;
  if ('bottom' in pos) {
    const last = ordered.filter((i) => i.id !== id).at(-1);
    if (last === undefined || last.rank !== undefined) return { pos, unranked: [] };
    target = { after: last.id };
  }
  const anchor = 'before' in target ? target.before : 'after' in target ? target.after : undefined;
  const end = anchor === undefined ? -1 : ordered.findIndex((i) => i.id === anchor);
  if (end < 0 || ordered[end]?.rank !== undefined) return { pos: target, unranked: [] };
  const unranked = ordered
    .slice(0, end + 1)
    .filter((i) => i.rank === undefined && i.id !== id)
    .map((i) => i.id);
  return { pos: target, unranked };
}

/**
 * Die Operationen des Batches. Jedes `issue.rank` verlangt `from`: für die Issues ohne Rang `null`,
 * für das bewegte Issue sein Rang beim Server (`from`), nie der überlagerte, den eine noch offene
 * Vorschau zeigt. Der Server nimmt höchstens `MAX_BATCH` (1000) Operationen an; bei mehr Issues
 * ohne Rang vor dem Anker lehnt er ab, und seine Meldung steht wörtlich in der Fehleranzeige. Das
 * ist eine bewusste Grenze: So viele frische Issues sortiert niemand per Hand.
 */
export function rankBatchOps(
  id: string,
  from: number | undefined,
  steps: RankSteps,
): Record<string, unknown>[] {
  return [
    ...steps.unranked.map((key) => ({ op: 'issue.rank', id: key, from: null, bottom: true })),
    { op: 'issue.rank', id, from: from ?? null, ...steps.pos },
  ];
}
