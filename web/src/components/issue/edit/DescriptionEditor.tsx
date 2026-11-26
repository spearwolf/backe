import { useEffect, useRef, useState } from 'react';
import { useWrites } from '../../../data/write-context.tsx';
import { Markdown, type MarkdownProps } from '../../../markdown/index.tsx';
import { m } from '../../../views/issue.messages.ts';
import { MarkdownEditor } from '../../editor/MarkdownEditor.tsx';
import { Button } from '../../ui/button.tsx';
import { ActionError } from '../../write/ActionError.tsx';
import { useAction } from '../../write/use-action.ts';
import { m as w } from '../../write/write.messages.ts';
import { type AttachmentUpload, imageUpload } from './upload.ts';

type Props = {
  id: string;
  /** Der geladene Body; `undefined`, solange das Detail noch nicht da ist. */
  body: string | undefined;
  backlog: string;
  issue: MarkdownProps['issue'];
  uploads: AttachmentUpload;
};

/** Entwurf samt dem Body, auf dem er beruht: Weicht der geladene davon ab, hat ihn jemand geändert. */
type Draft = { text: string; base: string };

/** Gespeicherter Text, bis das Neuladen den geladenen Body `over` ablöst. */
type Saved = { text: string; over: string };

/**
 * Die Beschreibung (ui.md §2.9.2). Mit Schreibrecht öffnet »Bearbeiten« den Editor; »Speichern« ist
 * ein `issue_update` mit `body`. Bringt ein Neuladen währenddessen einen anderen Body, steht ein
 * Hinweis über dem Editor: Gespeichert wird dann nur über »Meine Fassung speichern«, nie still.
 * Nach dem Speichern steht der gespeicherte Text da, bis das Neuladen den alten Body ablöst. Ohne
 * Schreibrecht (etwa nach dem Löschen des Issues) verschwindet ein offener Editor.
 */
export function DescriptionEditor({ id, body: loaded, backlog, issue, uploads }: Props) {
  const { canWrite, writes } = useWrites();
  const [draft, setDraft] = useState<Draft>();
  const [saved, setSaved] = useState<Saved>();
  const { busy, error, run, reset } = useAction();
  const editButton = useRef<HTMLButtonElement>(null);
  // Nach Speichern, Abbrechen oder Verwerfen ist der Editor weg; der Fokus geht an »Bearbeiten«.
  const backToButton = useRef(false);
  const editing = canWrite && draft !== undefined;
  useEffect(() => {
    if (!editing && backToButton.current) editButton.current?.focus();
    backToButton.current = false;
  }, [editing]);
  useEffect(() => {
    if (saved !== undefined && loaded !== saved.over) setSaved(undefined);
  }, [loaded, saved]);
  // Der Body, wie ihn der Tab zeigt: der gespeicherte Text, solange der Server noch den alten liefert.
  const body = saved !== undefined && loaded === saved.over ? saved.text : loaded;

  if (body === undefined || (!canWrite && body === '')) return null;

  const close = (): void => {
    backToButton.current = true;
    setDraft(undefined);
  };
  const save = async (text: string): Promise<void> => {
    const over = loaded;
    if (!(await run(() => writes.run('issue_update', { id, body: text })))) return;
    if (over !== undefined) setSaved({ text, over });
    close();
  };
  const changed = draft !== undefined && body !== draft.base;

  return (
    <section aria-labelledby="issue-description" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="issue-description" className="text-sm font-semibold">
          {m.description}
        </h2>
        {canWrite && !editing && (
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="xs"
            aria-label={m.editNamed(m.description)}
            onClick={() => {
              reset();
              setDraft({ text: body, base: body });
            }}
          >
            {m.edit}
          </Button>
        )}
      </div>
      {!editing || draft === undefined ? (
        body !== '' && <Markdown source={body} backlog={backlog} issue={issue} />
      ) : (
        <div className="space-y-2">
          {changed && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              <span className="flex-1">{m.bodyChanged}</span>
              <Button type="button" size="sm" disabled={busy} onClick={() => void save(draft.text)}>
                {m.keepMine}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>
                {m.discardReload}
              </Button>
            </div>
          )}
          <MarkdownEditor
            value={draft.text}
            onChange={(text) => setDraft((d) => d && { ...d, text })}
            label={m.description}
            backlog={backlog}
            issue={issue}
            onImage={imageUpload(uploads.upload)}
            onOtherFiles={uploads.add}
            disabled={busy}
            autoFocus
          />
          <ActionError error={error} />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || changed}
              onClick={() => void save(draft.text)}
            >
              {m.saveChanges}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>
              {w.cancel}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
