/**
 * Kontrollierte Eingaben für die Felder eines Issues (ui.md §2.9.1). Sie schreiben nichts selbst:
 * Wer sie einsetzt, entscheidet, wann daraus ein Aufruf wird (Feld-Editoren, Anlegen-Dialog).
 */
import type { BacklogConfig } from '@backe/core/schemas.ts';
import { X } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { cn } from '../../../lib/utils.ts';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';

export type PropDeclaration = NonNullable<BacklogConfig['props']>[string];

/** Natives `<select>` im Stil von `Input`: Tastatur und Screenreader bringt der Browser mit. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
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

/** Chips mit ×, dazu eine Auswahl der übrigen Optionen zum Hinzufügen. */
export function MultiPick(props: {
  label: string;
  values: readonly string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { label, values, options, onChange, disabled } = props;
  const rest = options.filter((o) => !values.includes(o));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {values.map((v) => (
            <li key={v} className="inline-flex items-center rounded-full border pl-2 text-xs">
              {v}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5 rounded-full"
                aria-label={m.remove(v)}
                disabled={disabled}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <NativeSelect
          aria-label={m.addTo(label)}
          value=""
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value !== '') onChange([...values, e.target.value]);
          }}
        >
          <option value="">+</option>
          {rest.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}

/** `none` heißt `null`; `me` steht für die eigene Identität, gesendet wird ihr Handle. */
export function AssigneeSelect(props: {
  value: string | null;
  me: string | null;
  users: readonly string[];
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const { value, me, users, onChange, disabled } = props;
  const others = users.filter((u) => u !== me);
  // Ein Handle, das der Store nicht (mehr) kennt, bleibt wählbar, statt still auf `none` zu springen.
  if (value !== null && value !== me && !others.includes(value)) others.push(value);
  return (
    <NativeSelect
      aria-label={m.fieldAssignee}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">none</option>
      {me !== null && <option value={me}>{`me (${me})`}</option>}
      {others.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </NativeSelect>
  );
}

/** ID-Eingabe; die Vorschläge (ID und Titel) kommen aus dem Store. */
export function IssuePick(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  exclude?: readonly string[];
  disabled?: boolean;
}) {
  const { label, value, onChange, exclude, disabled } = props;
  const listId = useId();
  const snapshot = useSignal(useStore().toSnapshot);
  const issues = [...(snapshot?.issues.values() ?? [])]
    .map((e) => e.data)
    .filter((i) => !exclude?.includes(i.id));
  return (
    <>
      <Input
        aria-label={label}
        list={listId}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="h-8 font-mono text-xs"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {issues.map((i) => (
          <option key={i.id} value={i.id}>
            {i.title}
          </option>
        ))}
      </datalist>
    </>
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

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Eingabe nach dem Typ der Deklaration (BK §2.24): `enum` als Auswahl, Zahlen als Zahlfeld,
 * `boolean` als Checkbox, `string` als Text, `json` und Undeklariertes als JSON-Text, geprüft
 * per `JSON.parse`. Leer oder ungültig meldet `undefined`.
 */
export function PropInput(props: {
  name: string;
  decl: PropDeclaration | undefined;
  value: unknown;
  onChange: (v: unknown | undefined) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { name, decl, value, onChange, disabled } = props;
  const label = props.label ?? name;
  const kind = decl?.type ?? 'json';
  if (kind === 'boolean') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        className="size-4 accent-primary"
        checked={value === true}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (kind === 'enum') {
    return (
      <NativeSelect
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
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
  return (
    <TextProp
      kind={kind}
      label={label}
      value={value}
      onChange={onChange}
      {...(disabled === undefined ? {} : { disabled })}
    />
  );
}

function TextProp(props: {
  kind: TextKind;
  label: string;
  value: unknown;
  onChange: (v: unknown | undefined) => void;
  disabled?: boolean;
}) {
  const { kind, label, value, onChange, disabled } = props;
  const [text, setText] = useState(() => formatProp(kind, value));
  // Der Text bleibt beim Tippen stehen (»1.«, halbes JSON); nur ein neuer Wert von außen ersetzt ihn.
  const [seen, setSeen] = useState(value);
  if (!same(seen, value)) {
    setSeen(value);
    if (!same(parseProp(kind, text), value)) setText(formatProp(kind, value));
  }
  const invalid = text.trim() !== '' && parseProp(kind, text) === undefined;
  const numeric = kind === 'integer' || kind === 'number';
  return (
    <Input
      aria-label={label}
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
