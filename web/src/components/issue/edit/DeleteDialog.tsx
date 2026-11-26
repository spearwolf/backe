import { useState } from 'react';
import { deletePlan } from '../../../app/delete-plan.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { useWrites } from '../../../data/write-context.tsx';
import { m } from '../../../views/issue.messages.ts';
import { ConfirmDialog } from '../../write/ConfirmDialog.tsx';
import { useAction } from '../../write/use-action.ts';
import { IssueRef } from '../IssueRef.tsx';

type Children = 'orphan' | 'recursive';

type Props = { id: string; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Löschen eines Issues (ui.md §2.9.1). Die Rückfragen kommen aus `deletePlan` auf dem Store, also
 * dieselben, die der Server sonst als Fehler stellt: Bei Sub-Issues ist `orphan` oder `recursive`
 * Pflicht, bei Verweisen anderer Issues das Häkchen für `force`. Fehlt eins, bleibt »Löschen«
 * gesperrt.
 */
export function DeleteDialog({ id, open, onOpenChange }: Props) {
  // Jedes Öffnen beginnt ohne Wahl und ohne Häkchen.
  return open ? <OpenDeleteDialog id={id} onOpenChange={onOpenChange} /> : null;
}

function OpenDeleteDialog({ id, onOpenChange }: Omit<Props, 'open'>) {
  const { writes } = useWrites();
  const store = useStore();
  const snapshot = useSignal(store.toSnapshot);
  const [children, setChildren] = useState<Children>();
  const [force, setForce] = useState(false);
  const { busy, error, run } = useAction();

  const plan =
    snapshot === undefined ? { children: [], referencing: [] } : deletePlan(snapshot, id, children);
  const needsChoice = plan.children.length > 0;
  const needsForce = plan.referencing.length > 0;
  const blocked = (needsChoice && children === undefined) || (needsForce && !force);

  const confirm = async (): Promise<void> => {
    const args = {
      id,
      ...(needsChoice && children !== undefined ? { children } : {}),
      ...(needsForce ? { force: true } : {}),
    };
    if (await run(() => writes.run('issue_delete', args))) onOpenChange(false);
  };

  return (
    <ConfirmDialog
      open
      title={m.deleteTitle(id)}
      confirmLabel={m.deleteAction}
      destructive
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      onConfirm={() => void confirm()}
      onOpenChange={onOpenChange}
    >
      {needsChoice && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{m.childrenChoice}</legend>
          <RefList ids={plan.children} label={m.children} />
          {(['orphan', 'recursive'] as const).map((choice) => (
            <label key={choice} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="delete-children"
                value={choice}
                checked={children === choice}
                disabled={busy}
                className="accent-primary"
                onChange={() => setChildren(choice)}
              />
              {choice === 'orphan' ? m.orphan : m.recursive}
            </label>
          ))}
        </fieldset>
      )}
      {needsForce && (
        <div className="space-y-2">
          <RefList ids={plan.referencing} label={m.referencing} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={force}
              disabled={busy}
              className="size-4 accent-primary"
              onChange={(e) => setForce(e.target.checked)}
            />
            {m.forceDelete}
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}

function RefList({ ids, label }: { ids: readonly string[]; label: string }) {
  return (
    <section aria-label={label} className="space-y-1">
      <h3 className="text-sm text-muted-foreground">{label}</h3>
      <ul className="space-y-1">
        {ids.map((ref) => (
          <li key={ref}>
            <Ref id={ref} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Ref({ id }: { id: string }) {
  const { backlog } = useWrites();
  const issue = useSignal(useStore().issues.get(id));
  return <IssueRef issue={issue ?? { id, missing: true }} backlog={backlog} />;
}
