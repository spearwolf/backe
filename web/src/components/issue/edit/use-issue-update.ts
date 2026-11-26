import type { IssueJson, ToolArgs } from '@backe/ui/api.ts';
import { updateOverlay } from '../../../app/optimistic.ts';
import { useWrites } from '../../../data/write-context.tsx';
import { useAction } from '../../write/use-action.ts';

export type IssueChange = Omit<ToolArgs['issue_update'], 'id'>;

/**
 * Ein Feld-Editor: jede Änderung genau ein `issue_update` mit der Überlagerung aus `updateOverlay`,
 * `busy` sperrt den Editor, `error` steht am Feld.
 */
export function useIssueUpdate(issue: IssueJson) {
  const { writes } = useWrites();
  const action = useAction();
  const update = (change: IssueChange): Promise<boolean> => {
    const args = { id: issue.id, ...change };
    return action.run(() =>
      writes.run('issue_update', args, { optimistic: updateOverlay(issue, args) }),
    );
  };
  return { ...action, update };
}
