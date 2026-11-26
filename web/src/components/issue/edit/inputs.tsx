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

/**
 * Chips mit ×, dazu ein Menü der übrigen Optionen zum Hinzufügen. Gibt es weder Werte noch etwas
 * zu wählen (der Backlog hat keine Projekte), steht ein gedämpfter Strich da: Eine leere Zeile
 * sähe aus wie ein fehlendes Feld.
 */
export function MultiPick(props: {
  label: string;
  values: readonly string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { label, values, options, onChange, disabled } = props;
  const rest = options.filter((o) => !values.includes(o));
  if (values.length === 0 && rest.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{m.noValues}</span>
      </span>
    );
  }
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

/** Wert des Radio-Eintrags für »niemand«; Handles sind nie leer. */
export const NO_ASSIGNEE = '';

/**
 * Die Wahlen für den Assignee, in jedem Menü gleich: niemand, ich (`<handle>`), dann die übrigen
 * Users. Die Beschriftung folgt der Sprache, die Werte bleiben roh (`NO_ASSIGNEE` oder ein
 * Handle); die FilterBar zeigt dagegen `me`/`none` als Filter-Syntax. Ein Handle, das der Store
 * nicht (mehr) kennt, bleibt wählbar, statt still auf niemand zu springen.
 */
export function assigneeChoices(
  value: string | null,
  me: string | null,
  users: readonly string[],
): { value: string; label: string }[] {
  const others = users.filter((u) => u !== me);
  if (value !== null && value !== me && !others.includes(value)) others.push(value);
  return [
    { value: NO_ASSIGNEE, label: m.assigneeNone },
    ...(me === null ? [] : [{ value: me, label: m.assigneeMe(me) }]),
    ...others.map((u) => ({ value: u, label: u })),
  ];
}

/** Niemand heißt `null`; »ich« steht für die eigene Identität, gemeldet wird ihr Handle. */
export function AssigneeSelect(props: {
  value: string | null;
  me: string | null;
  users: readonly string[];
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const { value, me, users, onChange, disabled } = props;
  const choices = assigneeChoices(value, me, users);
  const shown = choices.find((c) => c.value === (value ?? NO_ASSIGNEE))?.label ?? m.assigneeNone;
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
          value={value ?? NO_ASSIGNEE}
          onValueChange={(v) => onChange(v === NO_ASSIGNEE ? null : v)}
        >
          {choices.map((c) => (
            <DropdownMenuRadioItem key={c.value} value={c.value}>
              {c.label}
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
