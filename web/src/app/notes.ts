/**
 * Regeln für Benachrichtigungen (ui.md U11): was ein Patch oder ein Sync-Status dem Nutzer wert
 * ist. Rein; der Notifier zeigt die Meldungen. Nur Patches zählen, nie `/state`.
 */
import type { IssueJson, PatchJson } from '@backe/ui/api.ts';
import { syncStatusView } from './sync-status.ts';

export type Note =
  | { kind: 'assigned' | 'changed' | 'deleted'; id: string; title: string; by: string[] }
  | { kind: 'conflict'; id: string; title: string };

/** Meldungen eines Patches für `me`; `before` liefert den Serverstand vor dem Patch. */
export function issueNotes(
  patch: PatchJson,
  before: (id: string) => IssueJson | undefined,
  me: string,
): Note[] {
  const upserted = new Map((patch.upsert.issues ?? []).map((i) => [i.id, i]));
  const removed = new Set(patch.remove.issues ?? []);
  const notes: Note[] = [];
  for (const [id, handles] of Object.entries(patch.actors ?? {})) {
    const by = [...new Set(handles)].filter((h) => h !== me).sort();
    if (by.length === 0) continue;
    const was = before(id);
    // Ein nur berührtes Issue steht unverändert im Store: `before` ist dann auch der Stand danach.
    const now = removed.has(id) ? undefined : (upserted.get(id) ?? was);
    const wasMine = was?.assignee === me;
    const isMine = now?.assignee === me;
    const title = (now ?? was)?.title;
    if (title === undefined) continue;
    if (isMine && !wasMine) notes.push({ kind: 'assigned', id, title, by });
    else if (wasMine && now === undefined) notes.push({ kind: 'deleted', id, title, by });
    else if (wasMine || isMine) notes.push({ kind: 'changed', id, title, by });
  }
  return notes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Konflikte, die der Notifier seit seinem Start nicht kannte. `known` wächst nur: ein gelöster
 * Konflikt, der unter derselben ID wiederkehrt, meldet sich nicht noch einmal. Ohne Status
 * (`null`) bleibt `known` unverändert. Der Aufrufer übergibt für den ersten gesehenen Status die
 * IDs als Grundlinie (also `known` = dessen Konflikte, ohne Meldung).
 */
export function conflictNotes(
  known: ReadonlySet<string>,
  sync: Record<string, unknown> | null,
): { notes: Note[]; known: Set<string> } {
  const conflicts = sync === null ? [] : syncStatusView(sync).conflicts;
  return {
    notes: conflicts
      .filter((c) => !known.has(c.id))
      .map((c): Note => ({ kind: 'conflict', id: c.id, title: c.subject })),
    known: new Set([...known, ...conflicts.map((c) => c.id)]),
  };
}
