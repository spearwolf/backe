import { type ClipboardEvent, type DragEvent, useLayoutEffect, useRef, useState } from 'react';
import { attachmentLink } from '../../app/attachment-name.ts';
import { Markdown, type MarkdownProps } from '../../markdown/index.tsx';
import { Button } from '../ui/button.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { useSerialQueue } from '../write/use-serial-queue.ts';
import { m } from '../write/write.messages.ts';

export type MarkdownEditorProps = {
  value: string;
  onChange(next: string): void;
  label: string;
  backlog: string;
  issue?: MarkdownProps['issue'];
  local?: ReadonlyMap<string, string>;
  /** Nimmt ein Bild an und liefert seinen Anhangsnamen (= file); wirft bei Fehlern. Fehlt es, gibt es keinen Bild-Upload. */
  onImage?: (file: File) => Promise<string>;
  /**
   * Nimmt beim Ablegen die Dateien, die keine Bilder sind (sie werden Anhänge statt Links). Fehlt
   * es, bleiben sie liegen; ohne Bilder im Stapel steigt das Ablegen dann zum Umfeld auf.
   */
  onOtherFiles?: (files: File[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

const isImage = (f: File): boolean => f.type.startsWith('image/');

function imagesOf(files: FileList | readonly File[] | undefined | null): File[] {
  return files === undefined || files === null ? [] : Array.from(files).filter(isImage);
}

/**
 * Textfeld mit Umschalter Text/Vorschau. Bilder aus Einfügen und Ablegen laufen nacheinander durch
 * `onImage`; der Link steht danach an der Cursorstelle. Weitere Stapel reihen sich hinten an,
 * statt verloren zu gehen (`useSerialQueue`). Der erste Fehler eines Stapels bricht dessen Rest ab
 * und bleibt unter dem Feld stehen, der Text bleibt, wie er war.
 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  backlog,
  issue,
  local,
  onImage,
  onOtherFiles,
  disabled,
  autoFocus,
}: MarkdownEditorProps) {
  const [preview, setPreview] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // Während eines Uploads kann der Text sich ändern; Einfügungen rechnen immer gegen den neuesten.
  const latest = useRef(value);
  latest.current = value;
  // Auswahl, die nach dem nächsten Render ins Feld geschrieben wird; `ours` heißt: hinter unserem Link.
  const cursor = useRef<{ start: number; end: number; ours: boolean } | undefined>(undefined);
  // Stapel laufen nacheinander durch die Warteschlange; `tail` ist das Ende des zuletzt eingefügten Links.
  const queue = useSerialQueue();
  const tail = useRef<number | undefined>(undefined);

  // Der Cursor springt erst nach dem Render hinter den Link, wenn der Wert beim Feld angekommen ist.
  // Ohne Textfeld (Vorschau) verfällt er, damit er nicht später ins Leere greift.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` ist der Auslöser, nicht Eingabe.
  useLayoutEffect(() => {
    const sel = cursor.current;
    if (sel === undefined) return;
    cursor.current = undefined;
    area.current?.setSelectionRange(sel.start, sel.end);
  }, [value]);

  const insert = (link: string, at: { start: number; end: number }): number => {
    const text = latest.current;
    const from = Math.min(at.start, text.length);
    const to = Math.min(Math.max(at.end, from), text.length);
    const next = `${text.slice(0, from)}${link}${text.slice(to)}`;
    // Der Cursor folgt dem Link nur, wenn der Nutzer ihn zwischenzeitlich nicht woanders hingesetzt
    // hat; sonst bleibt seine Stelle erhalten und rückt nur um die eingefügte Länge nach.
    const el = area.current;
    const pending = cursor.current;
    const sel =
      pending ?? (el === null ? undefined : { start: el.selectionStart, end: el.selectionEnd });
    const after = from + link.length;
    if (sel === undefined) {
      cursor.current = undefined;
    } else if (pending?.ours === true || (sel.start === at.start && sel.end === at.end)) {
      cursor.current = { start: after, end: after, ours: true };
    } else {
      const shift = (p: number) => (p >= to ? p + link.length - (to - from) : p);
      cursor.current = { start: shift(sel.start), end: shift(sel.end), ours: false };
    }
    latest.current = next;
    onChange(next);
    return from + link.length;
  };

  const take = (files: File[]) => {
    if (onImage === undefined) return;
    // Hinter einem laufenden Stapel gilt dessen Ende, sonst die Auswahl zum Zeitpunkt des Einfügens.
    const behind = !queue.idle();
    if (!behind) tail.current = undefined;
    const el = area.current;
    let at = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
    queue.enqueue(async (alive) => {
      let first = true;
      for (const file of files) {
        // Nach dem Unmount startet kein weiterer Upload mehr.
        if (!alive()) return;
        const name = await onImage(file);
        if (!alive()) return;
        const link = attachmentLink(name);
        // Jeder Link steht in einer eigenen Zeile, auch der erste eines eingereihten Stapels.
        let glue = !first;
        if (first && behind && tail.current !== undefined) {
          at = { start: tail.current, end: tail.current };
          glue = true;
        }
        const end = insert(glue ? `\n${link}` : link, at);
        at = { start: end, end };
        tail.current = end;
        first = false;
      }
    });
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (onImage === undefined || disabled === true) return;
    const images = imagesOf(e.clipboardData.files);
    if (images.length === 0) return;
    e.preventDefault();
    take(images);
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    if (onImage === undefined || disabled === true) return;
    const files = Array.from(e.dataTransfer.files);
    const images = files.filter(isImage);
    const others = onOtherFiles === undefined ? [] : files.filter((f) => !isImage(f));
    if (images.length === 0 && others.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (images.length > 0) take(images);
    if (others.length > 0) onOtherFiles?.(others);
  };

  const onDragOver = (e: DragEvent<HTMLTextAreaElement>) => {
    // Ohne `preventDefault` beim Darüberziehen löst der Browser kein `drop` aus.
    if (onImage !== undefined && disabled !== true && e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  };

  return (
    <div className="space-y-2">
      <fieldset aria-label={m.editorMode} className="flex gap-1 border-0 p-0">
        <Button
          type="button"
          size="xs"
          variant={preview ? 'ghost' : 'secondary'}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          {m.editorText}
        </Button>
        <Button
          type="button"
          size="xs"
          variant={preview ? 'secondary' : 'ghost'}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          {m.editorPreview}
        </Button>
      </fieldset>
      {preview ? (
        <section className="min-h-16 rounded-md border px-3 py-2" aria-label={label}>
          <Markdown source={value} backlog={backlog} issue={issue} local={local} />
        </section>
      ) : (
        <Textarea
          ref={area}
          aria-label={label}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={onDragOver}
        />
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {queue.busy ? m.editorUploading : ''}
      </p>
      <ActionError error={queue.error} />
    </div>
  );
}
