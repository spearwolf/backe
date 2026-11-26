import type { CommentJson } from '@backe/ui/api.ts';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useWrites } from '../../data/write-context.tsx';
import { formatDate } from '../../lib/format.ts';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/issue.messages.ts';
import { MarkdownEditor } from '../editor/MarkdownEditor.tsx';
import { StateIcon } from '../StateIcon.tsx';
import { Button } from '../ui/button.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import { m as w } from '../write/write.messages.ts';
import { CommentComposer } from './edit/CommentComposer.tsx';
import { type AttachmentUpload, imageUpload } from './edit/upload.ts';
import { useFocusRescue } from './edit/use-focus-return.ts';
import { Author, Time } from './parts.tsx';

type MarkdownIssue = React.ComponentProps<typeof Markdown>['issue'];

/**
 * Kommentare und Übergänge in der Reihenfolge des Servers, darunter mit Schreibrecht der Composer.
 * Eigene Kommentare (`author === me`, keine Transition) lassen sich bearbeiten und löschen (BK §2.7).
 */
export function Timeline(props: {
  id: string;
  comments: readonly CommentJson[];
  backlog: string;
  issue: MarkdownIssue;
  uploads: AttachmentUpload;
}) {
  const { id, comments, backlog, issue, uploads } = props;
  const { canWrite, me } = useWrites();
  // Ein gelöschter Kommentar nimmt seinen Knopf mit; der Fokus bleibt dann in der Zeitleiste.
  const rescue = useFocusRescue<HTMLElement>();
  if (comments.length === 0 && !canWrite) return null;
  return (
    <section ref={rescue} aria-labelledby="issue-timeline" className="space-y-3">
      <h2 id="issue-timeline" className="text-sm font-semibold">
        {m.timeline}
      </h2>
      {comments.length > 0 && (
        <ol aria-label={m.timeline} className="space-y-3">
          {comments.map((c) => (
            <TimelineItem
              key={c.file}
              id={id}
              item={c}
              own={canWrite && me !== null && c.author === me && c.kind !== 'transition'}
              backlog={backlog}
              issue={issue}
              uploads={uploads}
            />
          ))}
        </ol>
      )}
      <CommentComposer id={id} backlog={backlog} issue={issue} uploads={uploads} />
    </section>
  );
}

function TimelineItem(props: {
  id: string;
  item: CommentJson;
  own: boolean;
  backlog: string;
  issue: MarkdownIssue;
  uploads: AttachmentUpload;
}) {
  const { id, item: c, own, backlog, issue, uploads } = props;
  const { writes } = useWrites();
  const [draft, setDraft] = useState<string>();
  // Gespeicherter Text, bis das Neuladen den Body `over` ablöst; sonst stünde kurz der alte da.
  const [saved, setSaved] = useState<{ text: string; over: string }>();
  const [confirming, setConfirming] = useState(false);
  const edit = useAction();
  const remove = useAction();
  const editButton = useRef<HTMLButtonElement>(null);
  const backToButton = useRef(false);
  // Verliert der Tab das Schreibrecht (Issue gelöscht), verschwindet auch ein offener Editor.
  const editing = own && draft !== undefined;
  const named = m.commentBy(c.author, formatDate(c.created));
  useEffect(() => {
    if (!editing && backToButton.current) editButton.current?.focus();
    backToButton.current = false;
  }, [editing]);
  useEffect(() => {
    if (saved !== undefined && c.body !== saved.over) setSaved(undefined);
  }, [c.body, saved]);
  const body = saved !== undefined && c.body === saved.over ? saved.text : c.body;
  const close = (): void => {
    backToButton.current = true;
    setDraft(undefined);
  };

  const save = async (text: string): Promise<void> => {
    const over = c.body;
    const args = { id, comment: c.file, body: text };
    if (!(await edit.run(() => writes.run('comment_edit', args)))) return;
    setSaved({ text, over });
    close();
  };
  const confirmDelete = async (): Promise<void> => {
    const args = { id, comment: c.file };
    if (await remove.run(() => writes.run('comment_delete', args))) setConfirming(false);
  };

  return (
    <li className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {c.kind === 'transition' && c.from !== undefined && c.to !== undefined ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <span className="sr-only">{m.transition}</span>
            <StateIcon state={c.from} />
            <ArrowRight className="size-3.5" aria-hidden="true" />
            <StateIcon state={c.to} />
          </span>
        ) : (
          <span className="sr-only">{m.comment}</span>
        )}
        <Author handle={c.author} />
        <Time iso={c.created} />
        {own && !editing && (
          <span className="ml-auto flex gap-1">
            <Button
              ref={editButton}
              type="button"
              variant="ghost"
              size="xs"
              aria-label={m.editNamed(named)}
              onClick={() => {
                edit.reset();
                setDraft(body);
              }}
            >
              {m.edit}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={m.deleteNamed(named)}
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              {m.deleteAction}
            </Button>
          </span>
        )}
      </div>
      {!editing || draft === undefined ? (
        body !== '' && <Markdown source={body} backlog={backlog} issue={issue} />
      ) : (
        <div className="space-y-2">
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            label={m.comment}
            backlog={backlog}
            issue={issue}
            onImage={imageUpload(uploads.upload)}
            onOtherFiles={uploads.add}
            disabled={edit.busy}
            autoFocus
          />
          <ActionError error={edit.error} />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={edit.busy || draft.trim() === ''}
              onClick={() => void save(draft)}
            >
              {m.saveChanges}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={edit.busy} onClick={close}>
              {w.cancel}
            </Button>
          </div>
        </div>
      )}
      {own && (
        <ConfirmDialog
          open={confirming}
          title={m.deleteCommentTitle}
          confirmLabel={m.deleteAction}
          destructive
          busy={remove.busy}
          error={remove.error}
          onConfirm={() => void confirmDelete()}
          onOpenChange={setConfirming}
        />
      )}
    </li>
  );
}
