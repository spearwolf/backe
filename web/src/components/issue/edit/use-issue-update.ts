import type { IssueJson, ToolArgs } from '@backe/ui/api.ts';
import { updateOverlay } from '../../../app/optimistic.ts';
import { useWrites } from '../../../data/write-context.tsx';
import { useAction } from '../../write/use-action.ts';
import { useFocusReturn } from './use-focus-return.ts';

export type IssueChange = Omit<ToolArgs['issue_update'], 'id'>;

/**
 * Ein Feld-Editor: jede Änderung genau ein `issue_update` mit der Überlagerung aus `updateOverlay`,
 * `busy` sperrt den Editor, `error` steht am Feld. `scope` gehört an das Element des Editors: Dorthin
 * kehrt der Fokus zurück, wenn der Write ihn verdrängt hat.
 */
export function useIssueUpdate<E extends HTMLElement = HTMLDivElement>(issue: IssueJson) {
  const { writes } = useWrites();
  const action = useAction();
  const { scope, capture } = useFocusReturn<E>(action.busy);
  const update = (change: IssueChange): Promise<boolean> => {
    const args = { id: issue.id, ...change };
    capture();
    return action.run(() =>
      writes.run('issue_update', args, { optimistic: updateOverlay(issue, args) }),
    );
  };
  return { ...action, update, scope };
}
