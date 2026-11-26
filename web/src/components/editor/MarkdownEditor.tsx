import { type ClipboardEvent, type DragEvent, useLayoutEffect, useRef, useState } from 'react';
import { Markdown, type MarkdownProps } from '../../markdown/index.tsx';
import { Button } from '../ui/button.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { useAction } from '../write/use-action.ts';
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
  disabled?: boolean;
  autoFocus?: boolean;
};

function imagesOf(files: FileList | readonly File[] | undefined | null): File[] {
  return files === undefined || files === null
    ? []
    : Array.from(files).filter((f) => f.type.startsWith('image/'));
}

/**
 * Textfeld mit Umschalter Text/Vorschau. Bilder aus Einfügen und Ablegen laufen nacheinander durch
 * `onImage`; der Link steht danach an der Cursorstelle. Der erste Fehler bricht den Rest des
 * Stapels ab und bleibt unter dem Feld stehen, der Text bleibt, wie er war.
 */
export function MarkdownEditor({
  value,
  onChange,
  label,
  backlog,
  issue,
  local,
  onImage,
  disabled,
  autoFocus,
}: MarkdownEditorProps) {
  const [preview, setPreview] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const upload = useAction();
  // Während eines Uploads kann der Text sich ändern; Einfügungen rechnen immer gegen den neuesten.
  const latest = useRef(value);
  latest.current = value;
  const cursor = useRef<number | undefined>(undefined);

  // Der Cursor springt erst nach dem Render hinter den Link, wenn der Wert beim Feld angekommen ist.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` ist der Auslöser, nicht Eingabe.
  useLayoutEffect(() => {
    const at = cursor.current;
    if (at === undefined || area.current === null) return;
    area.current.setSelectionRange(at, at);
    cursor.current = undefined;
  }, [value]);

  const insert = (link: string, start: number, end: number): number => {
    const text = latest.current;
    const from = Math.min(start, text.length);
    const to = Math.min(Math.max(end, from), text.length);
    const next = `${text.slice(0, from)}${link}${text.slice(to)}`;
    latest.current = next;
    cursor.current = from + link.length;
    onChange(next);
    return from + link.length;
  };

  const take = (files: File[]) => {
    if (onImage === undefined) return;
    const el = area.current;
    let at = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
    void upload.run(async () => {
      let first = true;
      for (const file of files) {
        const name = await onImage(file);
        const link = `![${name}](attachments/${name})`;
        const end = insert(first ? link : `\n${link}`, at.start, at.end);
        at = { start: end, end };
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
    const images = imagesOf(e.dataTransfer.files);
    if (images.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    take(images);
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
        {upload.busy ? m.editorUploading : ''}
      </p>
      <ActionError error={upload.error} />
    </div>
  );
}
