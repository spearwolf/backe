import type { State } from '@backe/core/state.ts';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { draftForCell } from '../../app/board-draft.ts';
import type { BoardGroup } from '../../app/board-model.ts';
import { createArgs } from '../../app/create-draft.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/board.messages.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { useCreateIssue } from '../write/create-context.tsx';
import { useAction } from '../write/use-action.ts';

/**
 * Schnell anlegen am Fuß einer Zelle (ui.md §2.8): `+` öffnet ein Titelfeld, Enter legt das Issue
 * in dieser Spalte und Bahn an, das Feld bleibt für das nächste offen. »Mehr …« öffnet den Dialog,
 * vorbelegt aus der Bahn (ui.md §2.12). Ohne Schreibrecht gibt es nichts davon. Es steht außerhalb
 * der Kartenliste der Zelle, damit ein Druck darauf nie ein Ziehen beginnt.
 */
export function QuickCreate(props: {
  group: BoardGroup;
  lane: string;
  /** Sichtbarer Name der Bahn, wie ihr Kopf ihn zeigt. */
  laneName: string;
  column: State;
}) {
  const { group, lane, laneName, column } = props;
  const create = useCreateIssue();
  const { writes } = useWrites();
  const { busy, error, run, reset } = useAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const plus = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Ein gesperrtes Feld verliert den Fokus; nach dem Write bekommt es ihn zurück.
  const refocus = useRef(false);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false;
      field.current?.focus();
    }
  }, [busy]);

  if (create === undefined) return null;

  const close = () => {
    setOpen(false);
    reset();
    plus.current?.focus();
  };
  const submit = async () => {
    const text = title.trim();
    if (text === '' || busy) return;
    refocus.current = true;
    const ok = await run(() =>
      writes.run('issue_create', createArgs(draftForCell(group, lane, column, text))),
    );
    if (ok) setTitle('');
  };

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-1">
        <Button
          ref={plus}
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={m.newIssue(column, laneName)}
          aria-expanded={open}
          onClick={() => (open ? field.current?.focus() : setOpen(true))}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
        {open && (
          <>
            <Input
              ref={field}
              aria-label={m.titleLabel}
              value={title}
              disabled={busy}
              className="h-7"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2"
              disabled={busy}
              onClick={() => create.open(draftForCell(group, lane, column, title.trim()))}
            >
              {m.more}
            </Button>
          </>
        )}
      </div>
      {open && <ActionError error={error} />}
    </div>
  );
}
