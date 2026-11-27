/** Dialoge des Abschnitts Users & Agents: Hinzufügen, Agent anlegen, Key widerrufen, Entfernen. */
import { isHandle } from '@backe/core/names.ts';
import type { ToolArgs, UserJson } from '@backe/ui/api.ts';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import type { SettingsSection as Section, SettingsRights } from '../../app/settings-model.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/settings.messages.ts';
import { CopyValue } from '../issue/parts.tsx';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ActionError } from '../write/ActionError.tsx';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import { m as w } from '../write/write.messages.ts';
import type { DialogFocus } from './dialog-focus.ts';
import { Field, SELECT_CLASS } from './fields.tsx';
import { sectionId } from './SettingsSection.tsx';

const KEY_PREFIX = 'ssh-ed25519 ';

/** Ein Key ist eine Zeile; die abschließende Zeilenschaltung einer eingefügten `.pub` fällt weg. */
const keyValid = (key: string): boolean => key.startsWith(KEY_PREFIX) && !/[\r\n]/.test(key);

const handleError = (handle: string): string | undefined =>
  handle !== '' && !isHandle(handle) ? m.invalidHandle : undefined;

/**
 * Enter im Key-Feld sendet das Formular ab, statt eine zweite Zeile zu beginnen: Das Feld ist nur
 * mehrzeilig, damit ein langer Key ganz sichtbar umbricht.
 */
function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function HandleField(props: { value: string; set: (v: string) => void; busy: boolean }) {
  const error = handleError(props.value);
  return (
    <Field label={m.userHandle} {...(error === undefined ? {} : { error })}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          value={props.value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => props.set(e.target.value)}
          disabled={props.busy}
          className="font-mono"
          autoFocus
        />
      )}
    </Field>
  );
}

function NameField(props: { value: string; set: (v: string) => void; busy: boolean }) {
  return (
    <Field label={m.userName} hint={m.userNameHint}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          value={props.value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => props.set(e.target.value)}
          disabled={props.busy}
        />
      )}
    </Field>
  );
}

/**
 * Dialog »User hinzufügen« mit vorhandenem Public Key; nur zum Öffnen gemountet, damit er leer
 * beginnt. Ohne `addHuman` gibt es keine Wahl der Art: Dann ist es ein Agent, und mit `'self'`
 * steht der Operator fest auf mir (BK §2.13 Punkt 4).
 */
export function AddUserDialog({
  section,
  rights,
  me,
  humans,
  focus,
  onOpenChange,
}: {
  section: Section;
  rights: Pick<SettingsRights, 'addHuman' | 'addAgent'>;
  me: string;
  humans: readonly UserJson[];
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [keyText, setKeyText] = useState('');
  const [kind, setKind] = useState<UserJson['kind']>(rights.addHuman ? 'human' : 'agent');
  const [chosen, setChosen] = useState(me);
  const formId = `${sectionId(section)}-add-form`;
  const key = keyText.trim();
  const keyMessage = key !== '' && !keyValid(key) ? m.invalidPublicKey : undefined;
  // Verliere ich die Admin-Rechte bei offenem Dialog, verschwindet die Wahl der Art; ein Mensch
  // ginge dann sicher abgelehnt hinaus, darum gilt ohne `addHuman` immer Agent.
  const agent = !rights.addHuman || kind === 'agent';
  // Ein Operator, der per Patch verschwand oder zum Agent wurde, gilt nicht mehr als gewählt.
  const operator =
    rights.addAgent === 'any' ? (humans.some((u) => u.handle === chosen) ? chosen : '') : me;
  const blocked = !isHandle(handle) || !keyValid(key) || (agent && operator === '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    const args: ToolArgs['user_add'] = {
      handle,
      key,
      ...(name.trim() === '' ? {} : { name: name.trim() }),
      ...(agent ? { agent: true, operator } : {}),
    };
    void run(() => writes.run('user_add', args)).then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  return (
    <ConfirmDialog
      open
      title={m.addUserTitle}
      confirmLabel={m.addUser}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      formId={formId}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <HandleField value={handle} set={setHandle} busy={busy} />
        <NameField value={name} set={setName} busy={busy} />
        <Field
          label={m.publicKey}
          hint={m.publicKeyHint}
          {...(keyMessage === undefined ? {} : { error: keyMessage })}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={keyText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setKeyText(e.target.value)}
              onKeyDown={submitOnEnter}
              disabled={busy}
              rows={2}
              spellCheck={false}
              className="font-mono break-all"
            />
          )}
        </Field>
        {rights.addHuman ? (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{m.userKind}</legend>
            <div className="flex gap-4">
              {(['human', 'agent'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${formId}-kind`}
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    disabled={busy}
                    className="size-4 accent-primary"
                  />
                  {k === 'human' ? m.kindHuman : m.kindAgent}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">{m.kindFixedAgent}</p>
        )}
        {agent &&
          (rights.addAgent === 'any' ? (
            <Field label={m.operator}>
              {({ id, describedBy }) => (
                <select
                  id={id}
                  aria-describedby={describedBy}
                  className={`${SELECT_CLASS} w-fit`}
                  value={operator}
                  onChange={(e) => setChosen(e.target.value)}
                  disabled={busy}
                >
                  {humans.map((u) => (
                    <option key={u.handle} value={u.handle}>
                      {m.userOption(u.name, u.handle)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <span className="font-medium">{m.operator}</span>
              <code className="font-mono">{me}</code>
            </p>
          ))}
      </form>
    </ConfirmDialog>
  );
}

/**
 * Dialog »Agent anlegen« (`user_create_agent`): Der Server erzeugt das Schlüsselpaar auf diesem
 * Rechner. Danach bleibt der Dialog offen und zeigt, wo der Private Key liegt, denn das sagt nur
 * diese Antwort. Ein eigener Dialog statt `ConfirmDialog`, weil der Fuß nach dem Anlegen nur noch
 * »Schließen« trägt; Formular und Ergebnis teilen sich einen Dialog, damit der Fokus darin bleibt.
 */
export function CreateAgentDialog({
  section,
  focus,
  onOpenChange,
}: {
  section: Section;
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [keyPath, setKeyPath] = useState<string>();
  const formId = `${sectionId(section)}-create-agent-form`;
  const blocked = !isHandle(handle);
  // Wie `ConfirmDialog`: Während der Aufruf läuft, schließt nichts den Dialog.
  const change = (open: boolean): void => {
    if (!busy) onOpenChange(open);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    const args: ToolArgs['user_create_agent'] = {
      handle,
      ...(name.trim() === '' ? {} : { name: name.trim() }),
    };
    void run(async () => setKeyPath((await writes.run('user_create_agent', args)).key_path));
  };

  return (
    <Dialog open onOpenChange={change}>
      <DialogContent
        showCloseButton={false}
        closeLabel={w.dismiss}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{m.createAgentTitle}</DialogTitle>
          <DialogDescription className="sr-only">{m.createAgentTitle}</DialogDescription>
        </DialogHeader>
        {keyPath === undefined ? (
          <>
            <form id={formId} onSubmit={submit} className="space-y-3">
              <HandleField value={handle} set={setHandle} busy={busy} />
              <NameField value={name} set={setName} busy={busy} />
              <p className="text-sm text-muted-foreground">{m.createAgentHint}</p>
            </form>
            <ActionError error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => change(false)}>
                {w.cancel}
              </Button>
              <Button type="submit" form={formId} disabled={busy || blocked}>
                {m.createAgent}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-1 text-sm">
              <p>{m.keyPathCreated}</p>
              <CopyValue value={keyPath} label={m.copyKeyPath} />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => change(false)} autoFocus>
                {m.closeDialog}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Bestätigung zum Widerrufen eines Keys; endgültig (BK §2.12). */
export function RevokeKeyDialog({
  handle,
  fingerprint,
  focus,
  onOpenChange,
}: {
  handle: string;
  fingerprint: string;
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  return (
    <ConfirmDialog
      open
      destructive
      title={m.revokeKeyTitle(handle)}
      confirmLabel={m.revokeKey}
      busy={busy}
      error={error}
      onConfirm={() => {
        // Der Key wandert zu den widerrufenen, sein Knopf verschwindet (siehe `useDialogFocus`).
        focus.arm(true);
        void run(() => writes.run('user_revoke_key', { handle, fingerprint })).then((ok) => {
          if (ok) onOpenChange(false);
          else focus.arm(false);
        });
      }}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <div className="space-y-2 text-sm">
        <code className="block font-mono text-xs break-all">{fingerprint}</code>
        <p>{m.revokeFinal}</p>
      </div>
    </ConfirmDialog>
  );
}

/** Bestätigung zum Entfernen eines Users. */
export function RemoveUserDialog({
  handle,
  focus,
  onOpenChange,
}: {
  handle: string;
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  return (
    <ConfirmDialog
      open
      destructive
      title={m.removeUserTitle(handle)}
      confirmLabel={m.removeUser}
      busy={busy}
      error={error}
      onConfirm={() => {
        // Mit dem User verschwindet seine Zeile samt Auslöser (siehe `useDialogFocus`).
        focus.arm(true);
        void run(() => writes.run('user_rm', { handle })).then((ok) => {
          if (ok) onOpenChange(false);
          else focus.arm(false);
        });
      }}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <p className="text-sm">{m.removeUserHint}</p>
    </ConfirmDialog>
  );
}
