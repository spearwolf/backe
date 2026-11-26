/**
 * Kontrollierte Eingaben für die Felder eines Issues (ui.md §2.9.1). Sie schreiben nichts selbst:
 * Wer sie einsetzt, entscheidet, wann daraus ein Aufruf wird (Feld-Editoren, Anlegen-Dialog).
 * Gewählt wird in Menüs: Pfeiltasten bewegen nur die Hervorhebung, erst Enter oder ein Klick
 * meldet `onChange`. Ein natives `<select>` meldet dagegen schon jeden Pfeilschritt.
 */
import { ChevronDown, Plus, X } from 'lucide-react';
import { useId } from 'react';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { Input } from '../../ui/input.tsx';
import { issueOptions } from './store-options.ts';

export { type DeclaredProps, type PropDeclaration, PropInput } from './PropInput.tsx';

/** Chips mit ×, dazu ein Menü der übrigen Optionen zum Hinzufügen. */
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-6 rounded-full"
              aria-label={m.addTo(label)}
              disabled={disabled}
              data-focus-return
            >
              <Plus className="size-3" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {rest.map((o) => (
              <DropdownMenuItem key={o} onSelect={() => onChange([...values, o])}>
                {o}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Wert des Radio-Eintrags für `none`; Handles sind nie leer. */
const NONE = '';

/** `none` heißt `null`; `me` steht für die eigene Identität, gemeldet wird ihr Handle. */
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
  const shown = value === null ? 'none' : value === me ? `me (${me})` : value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={m.choice(m.fieldAssignee, shown)}
          disabled={disabled}
          data-focus-return
        >
          {shown}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value ?? NONE}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <DropdownMenuRadioItem value={NONE}>none</DropdownMenuRadioItem>
          {me !== null && <DropdownMenuRadioItem value={me}>{`me (${me})`}</DropdownMenuRadioItem>}
          {others.map((u) => (
            <DropdownMenuRadioItem key={u} value={u}>
              {u}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ID-Eingabe; die Vorschläge (ID und Titel) kommen aus einem gemeinsamen Memo des Stores. */
export function IssuePick(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  exclude?: readonly string[];
  disabled?: boolean;
}) {
  const { label, value, onChange, exclude, disabled } = props;
  const listId = useId();
  const options = useSignal(issueOptions(useStore()));
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
        data-focus-return
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options
          .filter((o) => !exclude?.includes(o.id))
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
      </datalist>
    </>
  );
}
