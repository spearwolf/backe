import { useCallback, useEffect, useRef } from 'react';
import { attachmentNameFor } from '../../../app/attachment-name.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
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
 * des Issues im Store und die Namen, die der Tab gerade hochlädt oder hochgeladen hat, deren Patch
 * aber noch aussteht: Ohne sie bekäme das nächste eingefügte `image.png` denselben Namen, und der
 * Server lehnte es mit `exists` ab. Frei wird ein Name, sobald der Store ihn kennt (von da an
 * zählt der Store), spätestens wenn sein Write endet; nach `attachment_rm` ist er wieder zu haben.
 */
export function useUploader(id: string): Uploader {
  const { writes } = useWrites();
  const store = useStore();
  // Name zu seiner Reservierung: Ein spätes Freigeben trifft nie eine neuere desselben Namens.
  const pending = useRef(new Map<string, object>());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const attachments = useSignal(store.issues.get(id))?.attachments;
  useEffect(() => {
    for (const a of attachments ?? []) pending.current.delete(a.name);
  }, [attachments]);
  return useCallback(
    (files) => {
      const run = chain.current.then(async () => {
        const names: string[] = [];
        // Datei für Datei: Scheitert eine, bleiben die Namen der schon hochgeladenen vergeben.
        for (const file of files) {
          const stored = (store.issues.get(id).value?.attachments ?? []).map((a) => a.name);
          const name = attachmentNameFor(
            file.name,
            file.type,
            new Set([...stored, ...pending.current.keys()]),
          );
          const mine = {};
          pending.current.set(name, mine);
          const release = () => {
            if (pending.current.get(name) === mine) pending.current.delete(name);
          };
          try {
            await writes.upload(id, name, file, { onSettle: release });
          } catch (cause) {
            release();
            throw cause;
          }
          names.push(name);
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
