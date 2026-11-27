import { useCallback, useEffect, useRef, useState } from 'react';
import { attachmentNameFor, mentionsAttachment } from '../../app/attachment-name.ts';
import { type CreateDraft, createArgs } from '../../app/create-draft.ts';
import { useRouter } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/issue.messages.ts';
import { MarkdownEditor } from '../editor/MarkdownEditor.tsx';
import { Button } from '../ui/button.tsx';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.tsx';
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
  /** In Einfügereihenfolge; ein Bild, auf das der Text nicht mehr verweist, fällt weg. */
  const referenced = (body: string): LocalImage[] =>
    images.current.filter((i) => mentionsAttachment(body, i.name));
  return { local, onImage, referenced };
}

/** Property-Felder, deren Text gerade kein gültiger Wert ist; solange eines dabei ist, sperrt »Anlegen«. */
function useInvalidProps() {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback((name: string, valid: boolean) => {
    setInvalid((prev) => {
      if (prev.has(name) !== valid) return prev;
      const next = new Set(prev);
      if (valid) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  return { anyInvalid: invalid.size > 0, report };
}

/**
 * Dialog »Neues Issue« (ui.md §2.12). Ein Fehler beim Anlegen bleibt im Dialog, der Entwurf steht.
 * Scheitert danach ein Upload, gibt es das Issue schon: Die übrigen Bilder gehen trotzdem hoch, der
 * Dialog nennt die ID, wie viele Bilder angekommen sind und den ersten Fehler, und bietet nur noch
 * Schließen an, damit kein zweites Issue entsteht.
 */
export function CreateIssueDialog({
  initial,
  returnFocus,
  onClose,
}: {
  initial: CreateDraft;
  /** Wohin der Fokus nach dem Schließen geht; ist das Element weg, bleibt er, wo er landet. */
  returnFocus?: () => HTMLElement | null;
  onClose: () => void;
}) {
  const { backlog, writes } = useWrites();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [openAfter, setOpenAfter] = useState(true);
  const [created, setCreated] = useState<string>();
  const [uploads, setUploads] = useState<{ done: number; total: number }>();
  const { busy, error, run } = useAction();
  const { local, onImage, referenced } = useLocalImages();
  const { anyInvalid, report } = useInvalidProps();
  // Solange ein eingefügtes Bild noch keinen Link im Text hat, ginge es beim Anlegen verloren.
  const [linking, setLinking] = useState(false);
  const update: DraftUpdate = (change) => setDraft(change);
  const locked = busy || created !== undefined;
  const blocked = draft.title.trim() === '' || anyInvalid || linking;

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
      const newId = result.id;
      id = newId;
      setCreated(newId);
      // Unter den Namen, die schon im Text stehen; die Reihenfolge ist die des Einfügens. Ein
      // Fehlschlag hält die übrigen nicht auf: Jedes Bild, das ankommt, ist ein Link weniger, der
      // im neuen Issue ins Leere zeigt.
      const images = referenced(draft.body);
      let done = 0;
      let failure: { cause: unknown } | undefined;
      for (const image of images) {
        try {
          await writes.upload(newId, image.name, image.file);
          done += 1;
        } catch (cause) {
          failure ??= { cause };
        }
      }
      if (failure !== undefined) {
        setUploads({ done, total: images.length });
        throw failure.cause;
      }
    }).then((ok) => {
      if (ok && id !== undefined) finish(id);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      {/* Der Titel sagt alles; eine Beschreibung, die ihn wiederholt, läse der Screenreader doppelt. */}
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        // Ohne Auslöser fokussierte Radix nach dem Schließen nichts, und der Fokus fiele auf `body`.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const target = returnFocus?.();
          if (target?.isConnected) target.focus();
        }}
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
            onBusyChange={setLinking}
            disabled={locked}
            onChange={(body) => update((d) => ({ ...d, body }))}
          />
          <CreateIssueFields
            draft={draft}
            update={update}
            disabled={locked}
            onPropValidity={report}
          />
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
          {created !== undefined && uploads !== undefined && error !== undefined && (
            <p className="text-sm">{w.createdUploadFailed(created, uploads.done, uploads.total)}</p>
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
