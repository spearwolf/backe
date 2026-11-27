/** Dialoge des Abschnitts Sprints: Anlegen und Schließen. */
import { isSprintSlug } from '@backe/core/names.ts';
import type { ToolArgs } from '@backe/ui/api.ts';
import { type FormEvent, useState } from 'react';
import type { SettingsSection as Section } from '../../app/settings-model.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/settings.messages.ts';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import type { DialogFocus } from './dialog-focus.ts';
import { Field, FormSubmitShim, SELECT_CLASS } from './fields.tsx';
import { sectionId } from './SettingsSection.tsx';

/** Dialog »Hinzufügen«; nur zum Öffnen gemountet, damit jedes Mal leer begonnen wird. */
export function AddSprintDialog({
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
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [body, setBody] = useState('');
  const formId = `${sectionId(section)}-add-form`;
  const slugMessage = slug !== '' && !isSprintSlug(slug) ? m.invalidSprintSlug : undefined;
  // Wie `SprintSchema`: Das Ende liegt nicht vor dem Start. `YYYY-MM-DD` vergleicht als Text.
  const endMessage = start !== '' && end !== '' && end < start ? m.endBeforeStart : undefined;
  const blocked = !isSprintSlug(slug) || endMessage !== undefined;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    // Leere optionale Felder gehen nicht mit: Ohne Titel gilt der Slug.
    const args: ToolArgs['sprint_create'] = {
      slug,
      ...(title.trim() === '' ? {} : { title: title.trim() }),
      ...(start === '' ? {} : { start }),
      ...(end === '' ? {} : { end }),
      ...(body.trim() === '' ? {} : { body }),
    };
    void run(() => writes.run('sprint_create', args)).then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  const text = (
    label: string,
    value: string,
    set: (v: string) => void,
    extra: { hint?: string; error?: string; mono?: boolean; autoFocus?: boolean } = {},
  ) => (
    <Field
      label={label}
      {...(extra.hint === undefined ? {} : { hint: extra.hint })}
      {...(extra.error === undefined ? {} : { error: extra.error })}
    >
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => set(e.target.value)}
          disabled={busy}
          className={extra.mono === true ? 'font-mono' : undefined}
          autoFocus={extra.autoFocus}
        />
      )}
    </Field>
  );

  const date = (
    label: string,
    value: string,
    set: (v: string) => void,
    message: string | undefined,
  ) => (
    <Field label={label} {...(message === undefined ? {} : { error: message })}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type="date"
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => set(e.target.value)}
          disabled={busy}
          className="w-fit"
        />
      )}
    </Field>
  );

  return (
    <ConfirmDialog
      open
      title={m.addSprintTitle}
      confirmLabel={m.addSprint}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      formId={formId}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <FormSubmitShim disabled={blocked || busy} />
        {text(m.sprintSlug, slug, setSlug, {
          ...(slugMessage === undefined ? {} : { error: slugMessage }),
          mono: true,
          autoFocus: true,
        })}
        {text(m.fieldTitle, title, setTitle, { hint: m.sprintTitleHint })}
        <div className="flex flex-wrap gap-3">
          {date(m.sprintStart, start, setStart, undefined)}
          {date(m.sprintEnd, end, setEnd, endMessage)}
        </div>
        <Field label={m.sprintGoal}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={body}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
              rows={4}
            />
          )}
        </Field>
      </form>
    </ConfirmDialog>
  );
}

/** Dialog »Schließen« mit optionalem Nachfolger (`carry_over`) unter den anderen offenen Sprints. */
export function CloseSprintDialog({
  slug,
  others,
  focus,
  onOpenChange,
}: {
  slug: string;
  others: readonly string[];
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [carry, setCarry] = useState('');
  // Ein Nachfolger, der per Patch schloss oder verschwand, gilt nicht mehr als gewählt.
  const target = others.includes(carry) ? carry : '';

  const confirm = (): void => {
    // Mit dem offenen Sprint verschwindet sein Knopf (siehe `useDialogFocus`).
    focus.arm(true);
    void run(() =>
      writes.run('sprint_close', target === '' ? { slug } : { slug, carry_over: target }),
    ).then((ok) => {
      if (ok) onOpenChange(false);
      else focus.arm(false);
    });
  };

  return (
    <ConfirmDialog
      open
      title={m.closeSprintTitle(slug)}
      confirmLabel={m.closeSprint}
      busy={busy}
      error={error}
      onConfirm={confirm}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <Field label={m.carryOver} hint={m.carryOverHint}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className={`${SELECT_CLASS} w-fit font-mono`}
            value={target}
            onChange={(e) => setCarry(e.target.value)}
            disabled={busy}
          >
            <option value="">{m.carryOverNone}</option>
            {others.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </Field>
    </ConfirmDialog>
  );
}
