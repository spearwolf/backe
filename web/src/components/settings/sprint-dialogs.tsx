/** Dialoge des Abschnitts Sprints: Anlegen und Schließen. */
import { isSprintSlug } from '@backe/core/names.ts';
import type { ToolArgs } from '@backe/ui/api.ts';
import { type FormEvent, useState } from 'react';
import type { SettingsSection as Section } from '../../app/settings-model.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/settings.messages.ts';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import type { DialogFocus } from './dialog-focus.ts';
import { Field, SELECT_CLASS, TextAreaField, TextField } from './fields.tsx';
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
        <TextField
          label={m.sprintSlug}
          error={slugMessage}
          value={slug}
          onChange={setSlug}
          disabled={busy}
          mono
          autoFocus
        />
        <TextField
          label={m.fieldTitle}
          hint={m.sprintTitleHint}
          value={title}
          onChange={setTitle}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-3">
          <TextField
            label={m.sprintStart}
            type="date"
            value={start}
            onChange={setStart}
            disabled={busy}
            className="w-fit"
          />
          <TextField
            label={m.sprintEnd}
            type="date"
            error={endMessage}
            value={end}
            onChange={setEnd}
            disabled={busy}
            className="w-fit"
          />
        </div>
        <TextAreaField label={m.sprintGoal} value={body} onChange={setBody} disabled={busy} />
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
