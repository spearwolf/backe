/** Verweise von Issues auf ein Repo oder Projekt, wie die Entfernen-Dialoge sie zeigen. */
import type { IssueJson } from '@backe/ui/api.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { IssueRef } from '../issue/IssueRef.tsx';

/**
 * Alle Issues des Stores. Der Snapshot ist ein Memo über alle Issues (stabil, solange sich nichts
 * ändert): Auch ein Patch auf `repos` oder `projects` eines bestehenden Issues rechnet ihn neu und
 * rendert den Dialog, der die Verweise zeigt.
 */
export function useAllIssues(): IssueJson[] {
  const snapshot = useSignal(useStore().toSnapshot);
  return snapshot === undefined ? [] : [...snapshot.issues.values()].map((e) => e.data);
}

function ReferencingIssue({ id }: { id: string }) {
  const { backlog } = useWrites();
  const issue = useSignal(useStore().issues.get(id));
  return <IssueRef issue={issue ?? { id, missing: true }} backlog={backlog} />;
}

/** Die verweisenden Issues als Liste, je mit aktuellem Titel und State aus dem Store. */
export function ReferenceList({ ids }: { ids: readonly string[] }) {
  return (
    <ul className="space-y-1">
      {ids.map((id) => (
        <li key={id}>
          <ReferencingIssue id={id} />
        </li>
      ))}
    </ul>
  );
}
