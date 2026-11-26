/**
 * Properties am Issue (BK §2.24): deklarierte zuerst mit Eingabe nach Typ und `description` als
 * Hilfetext, dann vorhandene undeklarierte als JSON, dazu »Property hinzufügen«. Jede Änderung ist
 * ein `issue_update` mit `props`; `null` entfernt den Key.
 */
import { PROP_KEY_RE } from '@backe/core/names.ts';
import type { IssueJson } from '@backe/ui/api.ts';
import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { ErrorBox } from '../../write/ActionError.tsx';
import { type DeclaredProps, type PropDeclaration, PropInput, sameValue } from './PropInput.tsx';
import { useFocusRescue } from './use-focus-return.ts';
import { useIssueUpdate } from './use-issue-update.ts';

function PropRow(props: {
  issue: IssueJson;
  name: string;
  decl: PropDeclaration | undefined;
  current: unknown;
}) {
  const { issue, name, decl, current } = props;
  const [draft, setDraft] = useState<unknown>(current);
  // Ein neuer Wert vom Server (oder das Ende der Überlagerung) ersetzt den Entwurf.
  const [seen, setSeen] = useState(current);
  if (!sameValue(seen, current)) {
    setSeen(current);
    setDraft(current);
  }
  const helpId = useId();
  const { busy, error, update, scope } = useIssueUpdate<HTMLFormElement>(issue);
  const changed = draft !== undefined && !sameValue(draft, current);
  return (
    <form
      ref={scope}
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) void update({ props: { [name]: draft } });
      }}
    >
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 truncate font-mono text-xs">{name}</span>
        <PropInput
          name={name}
          decl={decl}
          value={draft}
          disabled={busy}
          onChange={setDraft}
          {...(decl === undefined ? {} : { describedBy: helpId })}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={m.save(name)}
          disabled={busy || !changed}
        >
          <Check className="size-3.5" aria-hidden="true" />
        </Button>
        {current !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={m.remove(name)}
            disabled={busy}
            onClick={() => void update({ props: { [name]: null } })}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      {decl !== undefined && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {decl.description}
        </p>
      )}
      {error !== undefined && <ErrorBox error={error} compact />}
    </form>
  );
}

function AddProp({ issue }: { issue: IssueJson }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState<unknown>();
  // Nach dem Hinzufügen beginnt die Wert-Eingabe neu, samt ihrem Text.
  const [round, setRound] = useState(0);
  const { busy, error, update, scope } = useIssueUpdate<HTMLFormElement>(issue);
  const name = key.trim();
  const keyInvalid = name !== '' && !PROP_KEY_RE.test(name);
  const ready = name !== '' && !keyInvalid && value !== undefined;
  return (
    <form
      ref={scope}
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void update({ props: { [name]: value } }).then((ok) => {
          if (!ok) return;
          setKey('');
          setValue(undefined);
          setRound(round + 1);
        });
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label={m.propKey}
          placeholder={m.propKey}
          value={key}
          disabled={busy}
          aria-invalid={keyInvalid || undefined}
          spellCheck={false}
          className="h-8 w-24 shrink-0 font-mono text-xs"
          data-focus-return
          onChange={(e) => setKey(e.target.value)}
        />
        <PropInput
          key={round}
          name={name}
          label={m.propValue}
          decl={undefined}
          value={value}
          disabled={busy}
          onChange={setValue}
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || !ready}>
          {m.addProp}
        </Button>
      </div>
      {error !== undefined && <ErrorBox error={error} compact />}
    </form>
  );
}

/** Deklarierte Properties zuerst (mit Hilfetext), dann vorhandene undeklarierte, dann »hinzufügen«. */
export function PropsEditor({ issue, declared }: { issue: IssueJson; declared: DeclaredProps }) {
  // Eine entfernte undeklarierte Property verschwindet samt ihrer Zeile; der Fokus bleibt im Feld.
  const rescue = useFocusRescue<HTMLDivElement>();
  const values: Record<string, unknown> = issue.props ?? {};
  // Nur eigene Keys: `constructor` ist ein gültiger Property-Key, aber kein Wert des Issues.
  const ownValue = (k: string) => (Object.hasOwn(values, k) ? values[k] : undefined);
  const isDeclared = (k: string) => declared !== undefined && Object.hasOwn(declared, k);
  const declaredKeys = Object.keys(declared ?? {});
  const undeclared = Object.keys(values).filter((k) => !isDeclared(k));
  return (
    <div ref={rescue} className="space-y-2">
      {declaredKeys.map((k) => (
        <PropRow key={k} issue={issue} name={k} decl={declared?.[k]} current={ownValue(k)} />
      ))}
      {undeclared.map((k) => (
        <PropRow key={k} issue={issue} name={k} decl={undefined} current={ownValue(k)} />
      ))}
      <AddProp issue={issue} />
    </div>
  );
}
