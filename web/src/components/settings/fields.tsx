import { CircleAlert } from 'lucide-react';
import { type ReactNode, useId } from 'react';

/** Klassen eines nativen `<select>` im Stil von `Input`, wie in der Werkzeugleiste des Boards. */
export const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30';

/**
 * Verborgener Absende-Knopf für Formulare, deren sichtbarer Knopf im Fuß eines `ConfirmDialog`
 * sitzt (`form=`-Zuordnung). Browser nehmen diesen Knopf schon als Standardknopf, jsdom aber nur
 * Knöpfe im Formular: Dort löste Enter in einem von mehreren Feldern sonst nichts aus. Für den
 * Browser ist er redundant, und er sperrt wie der sichtbare Knopf.
 */
export function FormSubmitShim({ disabled }: { disabled: boolean }) {
  return <button type="submit" hidden tabIndex={-1} disabled={disabled} />;
}

/**
 * Ein beschriftetes Feld mit Hinweis und Fehler. Das Eingabeelement baut der Aufrufer selbst und
 * bekommt dafür `id`, `aria-describedby` (Hinweis und Fehler) und `aria-invalid` gereicht; so
 * passt dasselbe Gerüst um `<input>`, `<select>` und `<textarea>`.
 */
export function Field(props: {
  label: string;
  hint?: string;
  error?: string;
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
