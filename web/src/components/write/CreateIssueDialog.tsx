import { useEffect, useRef, useState } from 'react';
import { attachmentNameFor } from '../../app/attachment-name.ts';
import { type CreateDraft, createArgs } from '../../app/create-draft.ts';
import { useRouter } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/issue.messages.ts';
import { MarkdownEditor } from '../editor/MarkdownEditor.tsx';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { ActionError } from './ActionError.tsx';
import { CreateIssueFields, type DraftUpdate, Row } from './CreateIssueFields.tsx';
import { useAction } from './use-action.ts';
import { m as w } from './write.messages.ts';

type LocalImage = { name: string; file: File };

/**
 * Bilder bleiben bis zum Anlegen im Browser: Es gibt noch kein Issue, an das sie gehören. Der Name
 * steht sofort fest und damit auch der Link im Text; die Vorschau zeigt die `blob:`-URL. Die
 * URLs gibt der Dialog frei, wenn er geht.
 */
function useLocalImages() {
  const images = useRef<LocalImage[]>([]);
  const urls = useRef<string[]>([]);
  const [local, setLocal] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    },
    [],
  );
  const onImage = async (file: File): Promise<string> => {
    const taken = new Set(images.current.map((i) => i.name));
    const name = attachmentNameFor(file.name, file.type, taken);
    images.current.push({ name, file });
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    setLocal((prev) => new Map(prev).set(name, url));
    return name;
  };
  /** In Einfügereihenfolge; ein Bild, dessen Link der Text nicht mehr enthält, fällt weg. */
  const referenced = (body: string): LocalImage[] =>
    images.current.filter((i) => body.includes(`(attachments/${i.name})`));
  return { local, onImage, referenced };
}

/**
 * Dialog »Neues Issue« (ui.md §2.12). Ein Fehler beim Anlegen bleibt im Dialog, der Entwurf steht.
 * Scheitert danach ein Upload, gibt es das Issue schon: Der Dialog nennt dessen ID und den Fehler
 * und bietet nur noch Schließen an, damit kein zweites Issue entsteht.
 */
export function CreateIssueDialog({
  initial,
  onClose,
}: {
  initial: CreateDraft;
  onClose: () => void;
}) {
  const { backlog, writes } = useWrites();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [openAfter, setOpenAfter] = useState(true);
  const [created, setCreated] = useState<string>();
  const { busy, error, run } = useAction();
  const { local, onImage, referenced } = useLocalImages();
  const update: DraftUpdate = (change) => setDraft(change);
  const locked = busy || created !== undefined;
  const blocked = draft.title.trim() === '';

  const finish = (id: string): void => {
    onClose();
    if (openAfter) router.navigate(routeHref({ kind: 'issue', backlog, id }));
  };
  const close = (): void => {
    if (busy) return;
    if (created === undefined) onClose();
    else finish(created);
  };
  const submit = (): void => {
    if (locked || blocked) return;
    let id: string | undefined;
    void run(async () => {
      const result = await writes.run('issue_create', createArgs(draft));
      id = result.id;
      setCreated(id);
      // Unter den Namen, die schon im Text stehen; die Reihenfolge ist die des Einfügens.
      for (const image of referenced(draft.body)) await writes.upload(id, image.name, image.file);
    }).then((ok) => {
      if (ok && id !== undefined) finish(id);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        closeLabel={w.dismiss}
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{w.newIssue}</DialogTitle>
            <DialogDescription className="sr-only">{w.newIssue}</DialogDescription>
          </DialogHeader>
          <Row label={m.titleLabel}>
            <Input
              aria-label={m.titleLabel}
              aria-required
              value={draft.title}
              disabled={locked}
              className="h-8"
              onChange={(e) => {
                const title = e.target.value;
                update((d) => ({ ...d, title }));
              }}
            />
          </Row>
          <MarkdownEditor
            label={m.description}
            backlog={backlog}
            value={draft.body}
            local={local}
            onImage={onImage}
            disabled={locked}
            onChange={(body) => update((d) => ({ ...d, body }))}
          />
          <CreateIssueFields draft={draft} update={update} disabled={locked} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={openAfter}
              disabled={busy}
              onChange={(e) => setOpenAfter(e.target.checked)}
            />
            {w.openAfter}
          </label>
          {created !== undefined && error !== undefined && (
            <p className="text-sm">{w.createdUploadFailed(created)}</p>
          )}
          <ActionError error={error} />
          <DialogFooter>
            {created === undefined ? (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={close}>
                  {w.cancel}
                </Button>
                <Button type="submit" disabled={busy || blocked}>
                  {w.create}
                </Button>
              </>
            ) : (
              <Button type="button" disabled={busy} onClick={close}>
                {w.dismiss}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
