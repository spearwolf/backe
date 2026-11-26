/**
 * Eingabe eines Property-Werts nach dem Typ seiner Deklaration (BK §2.24), kontrolliert und ohne
 * Schreiben: Wer sie einsetzt, entscheidet, wann daraus ein Aufruf wird.
 */
import type { BacklogConfig } from '@backe/core/schemas.ts';
import { type ComponentProps, useState } from 'react';
import { cn } from '../../../lib/utils.ts';
import { Input } from '../../ui/input.tsx';

export type PropDeclaration = NonNullable<BacklogConfig['props']>[string];
export type DeclaredProps = Record<string, PropDeclaration> | undefined;

/** Gleichheit von Property-Werten in ihrer JSON-Form. */
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Natives `<select>` im Stil von `Input`; es meldet nur die Wahl, gespeichert wird erst per Knopf. */
function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30',
        className,
      )}
      {...props}
    />
  );
}

type TextKind = 'string' | 'integer' | 'number' | 'json';

function formatProp(kind: TextKind, value: unknown): string {
  if (value === undefined) return '';
  return kind === 'json' ? JSON.stringify(value) : String(value);
}

/** `undefined` heißt »kein gültiger Wert«; `null` ist kein Property-Wert, sondern »entfernen«. */
function parseProp(kind: TextKind, text: string): unknown {
  if (text.trim() === '') return undefined;
  if (kind === 'string') return text;
  if (kind === 'json') {
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed === null ? undefined : parsed;
    } catch {
      return undefined;
    }
  }
  const n = Number(text);
  return (kind === 'integer' ? Number.isInteger(n) : Number.isFinite(n)) ? n : undefined;
}

type Props = {
  name: string;
  decl: PropDeclaration | undefined;
  value: unknown;
  onChange: (v: unknown | undefined) => void;
  disabled?: boolean;
  /** Zugänglicher Name; ohne Angabe der Key. */
  label?: string;
  /** `id` des Hilfetexts (`description`), angesagt mit dem Feld. */
  describedBy?: string;
};

/**
 * `enum` als Auswahl, Zahlen als Zahlfeld, `boolean` als Checkbox, `string` als Text, `json` und
 * Undeklariertes als JSON-Text, geprüft per `JSON.parse`. Leer oder ungültig meldet `undefined`.
 */
export function PropInput(props: Props) {
  const { name, decl, value, onChange, disabled, describedBy } = props;
  const label = props.label ?? name;
  const kind = decl?.type ?? 'json';
  const common = { 'aria-label': label, 'aria-describedby': describedBy, disabled };
  if (kind === 'boolean') {
    return (
      <input
        type="checkbox"
        {...common}
        className="size-4 accent-primary"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (kind === 'enum') {
    return (
      <NativeSelect
        {...common}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="" />
        {(decl?.values ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </NativeSelect>
    );
  }
  return <TextProp {...props} kind={kind} label={label} />;
}

function TextProp(props: Props & { kind: TextKind; label: string }) {
  const { kind, label, value, onChange, disabled, describedBy } = props;
  const [text, setText] = useState(() => formatProp(kind, value));
  // Der Text bleibt beim Tippen stehen (»1.«, halbes JSON); nur ein neuer Wert von außen ersetzt ihn.
  const [seen, setSeen] = useState(value);
  if (!sameValue(seen, value)) {
    setSeen(value);
    if (!sameValue(parseProp(kind, text), value)) setText(formatProp(kind, value));
  }
  const invalid = text.trim() !== '' && parseProp(kind, text) === undefined;
  const numeric = kind === 'integer' || kind === 'number';
  return (
    <Input
      aria-label={label}
      aria-describedby={describedBy}
      type={numeric ? 'number' : 'text'}
      {...(numeric ? { step: kind === 'integer' ? 1 : 'any' } : {})}
      value={text}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      className={cn('h-8', kind === 'json' && 'font-mono text-xs')}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseProp(kind, e.target.value));
      }}
    />
  );
}
