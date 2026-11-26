import type { IssueJson } from '@backe/ui/api.ts';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { IssueRelations } from '../../../app/issue-relations.ts';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { ErrorBox } from '../../write/ActionError.tsx';
import { IssueRef } from '../IssueRef.tsx';
import { RelationGroup } from '../parts.tsx';
import { IssuePick } from './inputs.tsx';
import { useIssueUpdate } from './use-issue-update.ts';

/** `depends_on` mit Entfernen je Eintrag und einer ID-Eingabe zum Hinzufügen (`add_deps`/`rm_deps`). */
export function DepsEditor(props: {
  issue: IssueJson;
  dependsOn: IssueRelations['dependsOn'];
  backlog: string;
}) {
  const { issue, dependsOn, backlog } = props;
  const [draft, setDraft] = useState('');
  const { busy, error, update, scope } = useIssueUpdate(issue);
  const target = draft.trim();
  const footer = (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (target === '') return;
        void update({ add_deps: [target] }).then((ok) => ok && setDraft(''));
      }}
    >
      <div className="flex items-center gap-1">
        <div className="w-40">
          <IssuePick
            label={m.dependency}
            value={draft}
            exclude={[issue.id, ...dependsOn.map((d) => d.id)]}
            disabled={busy}
            onChange={setDraft}
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={busy || target === ''}>
          {m.addDep}
        </Button>
      </div>
      {error !== undefined && <ErrorBox error={error} compact />}
    </form>
  );
  return (
    <div ref={scope}>
      <RelationGroup title="depends_on" footer={footer}>
        {dependsOn.map((d) => (
          <li key={d.id} className="flex items-center gap-1">
            <IssueRef issue={d} backlog={backlog} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={m.remove(d.id)}
              disabled={busy}
              onClick={() => void update({ rm_deps: [d.id] })}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </RelationGroup>
    </div>
  );
}
