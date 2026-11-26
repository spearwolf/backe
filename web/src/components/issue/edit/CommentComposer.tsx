import { useEffect, useRef, useState } from 'react';
import { useWrites } from '../../../data/write-context.tsx';
import type { MarkdownProps } from '../../../markdown/index.tsx';
import { m } from '../../../views/issue.messages.ts';
import { MarkdownEditor } from '../../editor/MarkdownEditor.tsx';
import { Button } from '../../ui/button.tsx';
import { ActionError } from '../../write/ActionError.tsx';
import { useAction } from '../../write/use-action.ts';
import { type AttachmentUpload, imageUpload } from './upload.ts';

type Props = {
  id: string;
  backlog: string;
  issue: MarkdownProps['issue'];
  uploads: AttachmentUpload;
};

/**
 * Neuer Kommentar unter der Zeitleiste (ui.md §2.9.3): derselbe Editor wie die Beschreibung,
 * `comment_add` beim Absenden. Nach Erfolg ist das Feld leer und behält den Fokus; ein Fehler lässt
 * den Entwurf stehen.
 */
export function CommentComposer({ id, backlog, issue, uploads }: Props) {
  const { canWrite, writes } = useWrites();
  const [draft, setDraft] = useState('');
  const { busy, error, run } = useAction();
  // Während ein Bild hochlädt, fehlt sein Link noch im Entwurf: Absenden wartet darauf.
  const [uploading, setUploading] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // Während des Laufs ist das Feld gesperrt und verliert den Fokus; danach bekommt es ihn zurück.
  const refocus = useRef(false);
  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    // Hat der Nutzer den Fokus inzwischen woandershin gesetzt, bleibt er dort.
    const active = document.activeElement;
    const root = form.current;
    if (root === null || (active !== null && active !== document.body && !root.contains(active))) {
      return;
    }
    root.querySelector('textarea')?.focus();
  }, [busy]);

  if (!canWrite) return null;
  const submit = async (): Promise<void> => {
    if (draft.trim() === '' || uploading) return;
    refocus.current = true;
    if (await run(() => writes.run('comment_add', { id, body: draft }))) setDraft('');
  };

  return (
    <form
      ref={form}
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <MarkdownEditor
        value={draft}
        onChange={setDraft}
        label={m.newComment}
        backlog={backlog}
        issue={issue}
        onImage={imageUpload(uploads.upload)}
        onOtherFiles={uploads.add}
        onBusyChange={setUploading}
        disabled={busy}
      />
      <ActionError error={error} />
      <Button type="submit" size="sm" disabled={busy || uploading || draft.trim() === ''}>
        {m.addComment}
      </Button>
    </form>
  );
}
