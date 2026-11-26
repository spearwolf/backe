import type { IssueJson } from '@backe/ui/api.ts';
import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useWrites } from '../../../data/write-context.tsx';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { ActionError } from '../../write/ActionError.tsx';
import { useIssueUpdate } from './use-issue-update.ts';

const HEADING = 'text-xl font-semibold';

/** Der Titel als Überschrift; mit Schreibrecht per Knopf bearbeitbar, Enter speichert, Esc bricht ab. */
export function TitleEditor({ issue }: { issue: IssueJson }) {
  const { canWrite } = useWrites();
  const [draft, setDraft] = useState<string>();
  const { busy, error, update, reset } = useIssueUpdate(issue);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== undefined;
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (!canWrite) return <h1 className={HEADING}>{issue.title}</h1>;
  if (draft === undefined) {
    return (
      <div className="flex items-start gap-1">
        <h1 className={HEADING}>{issue.title}</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={m.editTitle}
          onClick={() => {
            reset();
            setDraft(issue.title);
          }}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const save = async (): Promise<void> => {
    const title = draft.trim();
    if (title === '') return;
    if (title === issue.title || (await update({ title }))) setDraft(undefined);
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        ref={input}
        aria-label={m.titleLabel}
        value={draft}
        disabled={busy}
        className="text-lg font-semibold"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          setDraft(undefined);
        }}
      />
      <ActionError error={error} />
    </form>
  );
}
