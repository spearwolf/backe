import { LoaderCircle, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useWrites } from '../../../data/write-context.tsx';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { ConfirmDialog } from '../../write/ConfirmDialog.tsx';
import { useAction } from '../../write/use-action.ts';
import type { AttachmentUpload } from './upload.ts';

/** »Hochladen« öffnet die Dateiauswahl (mehrere Dateien); eine Wahl während eines Uploads reiht sich ein. */
export function UploadButton({ uploads }: { uploads: AttachmentUpload }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <span role="status" className="text-xs text-muted-foreground">
        {uploads.busy ? m.uploading : ''}
      </span>
      <Button type="button" variant="outline" size="xs" onClick={() => input.current?.click()}>
        {uploads.busy ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Upload className="size-3.5" aria-hidden="true" />
        )}
        {m.upload}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label={m.uploadFiles}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Zurücksetzen, damit dieselbe Datei ein zweites Mal gewählt werden kann.
          e.target.value = '';
          uploads.add(files);
        }}
      />
    </span>
  );
}

/** »Entfernen« eines Anhangs: erst bestätigen, dann `attachment_rm`; ein Fehler bleibt im Dialog. */
export function RemoveAttachment({ id, name }: { id: string; name: string }) {
  const { writes } = useWrites();
  const [open, setOpen] = useState(false);
  const { busy, error, run, reset } = useAction();
  const confirm = async (): Promise<void> => {
    if (await run(() => writes.run('attachment_rm', { id, name }))) setOpen(false);
  };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={m.remove(name)}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {m.removeAction}
      </Button>
      <ConfirmDialog
        open={open}
        title={m.removeAttachmentTitle(name)}
        confirmLabel={m.removeAction}
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
        onOpenChange={setOpen}
      />
    </>
  );
}
