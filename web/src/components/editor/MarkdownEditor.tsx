import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ApiError } from '../../data/api-client.ts';
import { Markdown, type MarkdownProps } from '../../markdown/index.tsx';
import { Button } from '../ui/button.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ActionError } from '../write/ActionError.tsx';
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
 * `onImage`; der Link steht danach an der Cursorstelle. Weitere Stapel reihen sich hinten an,
 * statt verloren zu gehen. Der erste Fehler eines Stapels bricht dessen Rest ab und bleibt unter dem Feld stehen, der Text bleibt, wie er war.
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
  // Während eines Uploads kann der Text sich ändern; Einfügungen rechnen immer gegen den neuesten.
  const latest = useRef(value);
  latest.current = value;
  const cursor = useRef<number | undefined>(undefined);
  // Stapel laufen nacheinander: `chain` hängt den nächsten hinter den laufenden, `queued` zählt sie
  // für die Statuszeile, `tail` ist das Ende des zuletzt eingefügten Links.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const tail = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Der Cursor springt erst nach dem Render hinter den Link, wenn der Wert beim Feld angekommen ist.
  // Ohne Textfeld (Vorschau) verfällt er, damit er nicht später ins Leere greift.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` ist der Auslöser, nicht Eingabe.
  useLayoutEffect(() => {
    const at = cursor.current;
    if (at === undefined) return;
    cursor.current = undefined;
    area.current?.setSelectionRange(at, at);
  }, [value]);

  const insert = (link: string, at: { start: number; end: number }): number => {
    const text = latest.current;
    const from = Math.min(at.start, text.length);
    const to = Math.min(Math.max(at.end, from), text.length);
    const next = `${text.slice(0, from)}${link}${text.slice(to)}`;
    // Der Cursor folgt dem Link nur, wenn der Nutzer ihn zwischenzeitlich nicht woanders hingesetzt hat.
    const el = area.current;
    const unmoved =
      el !== null &&
      (cursor.current !== undefined ||
        (el.selectionStart === at.start && el.selectionEnd === at.end));
    latest.current = next;
    cursor.current = unmoved ? from + link.length : undefined;
    onChange(next);
    return from + link.length;
  };

  const take = (files: File[]) => {
    if (onImage === undefined) return;
    if (queued.current === 0) {
      tail.current = undefined;
      setError(undefined);
    }
    const el = area.current;
    // Hinter einem laufenden Stapel gilt dessen Ende, sonst die Auswahl zum Zeitpunkt des Einfügens.
    const behind = queued.current > 0;
    let at = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
    queued.current += 1;
    setBusy(true);
    const batch = async () => {
      try {
        let first = true;
        for (const file of files) {
          const name = await onImage(file);
          if (!mounted.current) return;
          const link = `![${name}](attachments/${name})`;
          if (first && behind && tail.current !== undefined) {
            at = { start: tail.current, end: tail.current };
          }
          const end = insert(first ? link : `\n${link}`, at);
          at = { start: end, end };
          tail.current = end;
          first = false;
        }
      } catch (cause) {
        if (mounted.current) {
          setError(
            cause instanceof ApiError
              ? cause
              : new ApiError(
                  0,
                  'unexpected',
                  cause instanceof Error ? cause.message : String(cause),
                ),
          );
        }
      } finally {
        queued.current -= 1;
        if (mounted.current && queued.current === 0) setBusy(false);
      }
    };
    chain.current = chain.current.then(batch);
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
        {busy ? m.editorUploading : ''}
      </p>
      <ActionError error={error} />
    </div>
  );
}
