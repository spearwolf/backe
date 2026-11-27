import { CircleAlert } from 'lucide-react';
import { type FocusEvent, type ReactNode, useId } from 'react';
import { cn } from '../../lib/utils.ts';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';

/** Klassen eines nativen `<select>` im Stil von `Input`, wie in der Werkzeugleiste des Boards. */
export const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30';

/**
 * Ein beschriftetes Feld mit Hinweis und Fehler. Das Eingabeelement baut der Aufrufer selbst und
 * bekommt dafür `id`, `aria-describedby` (Hinweis und Fehler) und `aria-invalid` gereicht; so
 * passt dasselbe Gerüst um `<input>`, `<select>` und `<textarea>`.
 */
export function Field(props: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [
    props.hint === undefined ? undefined : hintId,
    props.error === undefined ? undefined : errorId,
  ].filter((d) => d !== undefined);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      {props.children({
        id,
        describedBy: described.length === 0 ? undefined : described.join(' '),
        invalid: props.error !== undefined,
      })}
      {props.hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
      {props.error !== undefined && (
        <p id={errorId} className="flex items-center gap-1.5 text-xs">
          <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          {props.error}
        </p>
      )}
    </div>
  );
}

type TextProps = {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
};

/** Ein einzeiliges Textfeld im Gerüst von `Field`; `mono` für Namen, Pfade und Refs. */
export function TextField(
  props: TextProps & {
    type?: 'text' | 'date';
    mono?: boolean;
    autoFocus?: boolean;
    className?: string;
    onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  },
) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={props.type}
          value={props.value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => props.onChange(e.target.value)}
          onFocus={props.onFocus}
          disabled={props.disabled}
          className={cn(props.mono === true && 'font-mono', props.className)}
          autoFocus={props.autoFocus}
        />
      )}
    </Field>
  );
}

/** Ein mehrzeiliges Textfeld (Beschreibung, Ziel) im Gerüst von `Field`. */
export function TextAreaField(props: TextProps & { rows?: number }) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          value={props.value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          rows={props.rows ?? 4}
        />
      )}
    </Field>
  );
}
