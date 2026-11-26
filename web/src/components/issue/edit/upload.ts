import { useCallback, useRef } from 'react';
import { attachmentNameFor } from '../../../app/attachment-name.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useWrites } from '../../../data/write-context.tsx';
import type { Writes } from '../../../data/writes.ts';
import { useSerialQueue } from '../../write/use-serial-queue.ts';

/**
 * Lädt Dateien nacheinander hoch, Namen per attachmentNameFor gegen die schon vergebenen; liefert
 * die Namen.
 */
export async function uploadFiles(
  writes: Writes,
  id: string,
  files: readonly File[],
  taken: ReadonlySet<string>,
): Promise<string[]> {
  const used = new Set(taken);
  const names: string[] = [];
  for (const file of files) {
    const name = attachmentNameFor(file.name, file.type, used);
    used.add(name);
    await writes.upload(id, name, file);
    names.push(name);
  }
  return names;
}

export type Uploader = (files: readonly File[]) => Promise<string[]>;

/** Ein Bild aus dem Editor: hochladen, den Namen liefern (`onImage` von `MarkdownEditor`). */
export const imageUpload =
  (upload: Uploader) =>
  async (file: File): Promise<string> => {
    const [name] = await upload([file]);
    if (name === undefined) throw new Error(`no attachment name for ${file.name}`);
    return name;
  };

/**
 * Hochladen für einen Issue-Tab; der Tab hält genau einen davon, und alle seine Uploads (Editor der
 * Beschreibung, Kommentare, Anhangsliste) laufen nacheinander hindurch. Vergeben sind die Anhänge
 * des Issues im Store und die Namen, die der Tab hochgeladen hat, deren Patch aber noch aussteht:
 * Ohne sie bekäme das nächste eingefügte `image.png` denselben Namen, und der Server lehnte es mit
 * `exists` ab. Sobald der Store einen Namen kennt, gibt der Tab ihn frei; nach `attachment_rm` ist
 * er dann wieder zu haben.
 */
export function useUploader(id: string): Uploader {
  const { writes } = useWrites();
  const store = useStore();
  const pending = useRef(new Set<string>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(
    (files) => {
      const run = chain.current.then(async () => {
        const names: string[] = [];
        // Datei für Datei: Scheitert eine, bleiben die Namen der schon hochgeladenen vergeben.
        for (const file of files) {
          const stored = new Set(
            (store.issues.get(id).value?.attachments ?? []).map((a) => a.name),
          );
          for (const name of pending.current) if (stored.has(name)) pending.current.delete(name);
          const uploaded = await uploadFiles(
            writes,
            id,
            [file],
            new Set([...stored, ...pending.current]),
          );
          for (const name of uploaded) pending.current.add(name);
          names.push(...uploaded);
        }
        return names;
      });
      // Ein Fehler gehört dem Aufrufer; die Kette läuft für den nächsten weiter.
      chain.current = run.catch(() => {});
      return run;
    },
    [writes, store, id],
  );
}

/**
 * Hochladen per Auswahl und per Ablegen auf den Tab mit gemeinsamer Fehlerfläche über der Liste.
 * Stapel laufen nacheinander (`useSerialQueue`): Was während eines Uploads fällt, reiht sich ein.
 * `upload` ist der Uploader des Tabs selbst, für die Bilder der Editoren.
 */
export function useAttachmentUpload(upload: Uploader) {
  const { busy, error, enqueue } = useSerialQueue();
  const add = useCallback(
    (files: readonly File[]): void => {
      if (files.length === 0) return;
      enqueue(async (alive) => {
        if (alive()) await upload(files);
      });
    },
    [enqueue, upload],
  );
  return { busy, error, add, upload };
}

export type AttachmentUpload = ReturnType<typeof useAttachmentUpload>;
