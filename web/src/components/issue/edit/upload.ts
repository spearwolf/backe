import { useCallback, useEffect, useRef, useState } from 'react';
import { attachmentNameFor } from '../../../app/attachment-name.ts';
import { ApiError } from '../../../data/api-client.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useWrites } from '../../../data/write-context.tsx';
import type { Writes } from '../../../data/writes.ts';

/** Lädt Dateien nacheinander hoch, Namen per attachmentNameFor gegen die schon vergebenen; liefert die Namen. */
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
  async (file: File): Promise<string> =>
    (await upload([file]))[0] as string;

/**
 * Hochladen für einen Issue-Tab; der Tab hält genau einen davon. Vergeben sind die Anhänge des Issues im Store und alles, was der
 * Tab selbst schon hochgeladen hat: Der Patch mit dem neuen Anhang kann noch ausstehen, ein zweites
 * `image.png` aus dem nächsten Einfügen würde sonst das erste überschreiben.
 */
export function useUploader(id: string): Uploader {
  const { writes } = useWrites();
  const store = useStore();
  const mine = useRef(new Set<string>());
  return useCallback(
    async (files) => {
      const names: string[] = [];
      // Datei für Datei: Scheitert eine, bleiben die Namen der schon hochgeladenen vergeben.
      for (const file of files) {
        const taken = new Set(mine.current);
        for (const a of store.issues.get(id).value?.attachments ?? []) taken.add(a.name);
        const [name] = await uploadFiles(writes, id, [file], taken);
        if (name === undefined) continue;
        mine.current.add(name);
        names.push(name);
      }
      return names;
    },
    [writes, store, id],
  );
}

/**
 * Hochladen per Auswahl und per Ablegen auf den Tab mit gemeinsamer Fehlerfläche über der Liste.
 * Stapel laufen nacheinander: Was während eines Uploads fällt, reiht sich ein, statt verloren zu
 * gehen. Ein neuer Stapel ohne laufenden Vorgänger löscht den alten Fehler.
 */
export function useAttachmentUpload(upload: Uploader) {
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const add = useCallback(
    (files: readonly File[]): void => {
      if (files.length === 0) return;
      if (queued.current === 0) setError(undefined);
      queued.current += 1;
      setBusy(true);
      chain.current = chain.current.then(async () => {
        try {
          if (mounted.current) await upload(files);
        } catch (cause) {
          if (!mounted.current) return;
          setError(
            cause instanceof ApiError
              ? cause
              : new ApiError(
                  0,
                  'unexpected',
                  cause instanceof Error ? cause.message : String(cause),
                ),
          );
        } finally {
          queued.current -= 1;
          if (mounted.current && queued.current === 0) setBusy(false);
        }
      });
    },
    [upload],
  );
  return { busy, error, add };
}

export type AttachmentUpload = ReturnType<typeof useAttachmentUpload>;
