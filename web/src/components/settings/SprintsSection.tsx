import { isSprintSlug } from '@backe/core/names.ts';
import type { SprintJson, ToolArgs } from '@backe/ui/api.ts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { EMPTY_FILTER, listFilterSearch } from '../../app/list-filter.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import type { SettingsSection as Section } from '../../app/settings-model.ts';
import { sprintGroups } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/settings.messages.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import { Field, FormSubmitShim, SELECT_CLASS } from './fields.tsx';
import { type SectionFrame, SettingsSection, sectionId } from './SettingsSection.tsx';
import { sprintsOf } from './settings-memos.ts';

/** Dialog »Hinzufügen«; nur zum Öffnen gemountet, damit jedes Mal leer begonnen wird. */
function AddDialog({
  section,
  onOpenChange,
}: {
  section: Section;
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
  const blocked = !isSprintSlug(slug);

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

  const date = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          type="date"
          value={value}
          aria-describedby={describedBy}
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
          {date(m.sprintStart, start, setStart)}
          {date(m.sprintEnd, end, setEnd)}
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
function CloseDialog({
  slug,
  others,
  onOpenChange,
  onClosed,
  onCloseAutoFocus,
}: {
  slug: string;
  others: readonly string[];
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [carry, setCarry] = useState('');
  // Ein Nachfolger, der per Patch schloss oder verschwand, gilt nicht mehr als gewählt.
  const target = others.includes(carry) ? carry : '';

  return (
    <ConfirmDialog
      open
      title={m.closeSprintTitle(slug)}
      confirmLabel={m.closeSprint}
      busy={busy}
      error={error}
      onConfirm={() =>
        void run(() =>
          writes.run('sprint_close', target === '' ? { slug } : { slug, carry_over: target }),
        ).then((ok) => {
          if (!ok) return;
          onClosed();
          onOpenChange(false);
        })
      }
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
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

/** Zeitraum roh als `YYYY-MM-DD`, wie er in der Datei steht; ohne beide Daten nichts. */
function dates(sprint: SprintJson): string | undefined {
  if (sprint.start === undefined && sprint.end === undefined) return undefined;
  return `${sprint.start ?? ''} – ${sprint.end ?? ''}`.trim();
}

function SprintItem({
  sprint,
  canClose,
  onClose,
}: {
  sprint: SprintJson;
  canClose: boolean;
  onClose: (slug: string) => void;
}) {
  const { backlog } = useWrites();
  const go = useLinkClick();
  const { slug } = sprint;
  const href =
    routeHref({ kind: 'backlog', backlog }) +
    listFilterSearch({ ...EMPTY_FILTER, sprints: [slug] });
  const span = dates(sprint);
  return (
    <li aria-label={slug} className="space-y-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={href}
          onClick={go(href)}
          className="rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {sprint.title}
        </a>
        <code className="font-mono text-xs text-muted-foreground">{slug}</code>
        {span !== undefined && (
          <span className="font-mono text-sm text-muted-foreground">{span}</span>
        )}
        {canClose && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            aria-label={m.closeSprintOf(slug)}
            onClick={() => onClose(slug)}
          >
            {m.closeSprint}
          </Button>
        )}
      </div>
      {sprint.body !== undefined && sprint.body.trim() !== '' && (
        <Markdown source={sprint.body} backlog={backlog} className="text-sm" />
      )}
    </li>
  );
}

/**
 * Abschnitt Sprints (ui.md §2.10): offene zuerst, geschlossene hinter einem Klappknopf (flüchtig,
 * zu Beginn zu); mit Schreibrecht »Hinzufügen« und je offenem Sprint »Schließen«.
 */
export function SprintsSection({ id, title, folded, onToggle }: SectionFrame) {
  const store = useStore();
  const { canWrite } = useWrites();
  const { open, closed } = sprintGroups(useSignal(sprintsOf(store)));
  const openSlugs = open.map((s) => s.slug);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<string>();
  const [showClosed, setShowClosed] = useState(false);
  const closedId = useId();
  // Ein Sprint, der per Patch schloss oder verschwand und wieder offen ist, öffnet den alten
  // Dialog nicht wieder.
  const closingOpen = closing !== undefined && openSlugs.includes(closing);
  useEffect(() => {
    if (closing !== undefined && !closingOpen) setClosing(undefined);
  }, [closing, closingOpen]);
  // Nach dem Schließen verschwindet der Auslöser mit dem offenen Sprint; der Fokus geht an
  // »Hinzufügen«.
  const vanished = useRef(false);
  const addId = `${sectionId(id)}-add`;
  const afterClose = (event: Event): void => {
    if (!vanished.current) return;
    vanished.current = false;
    event.preventDefault();
    document.getElementById(addId)?.focus();
  };
  const Chevron = showClosed ? ChevronDown : ChevronRight;

  const actions = canWrite ? (
    <Button id={addId} type="button" size="sm" onClick={() => setAdding(true)}>
      {m.addSprint}
    </Button>
  ) : undefined;

  return (
    <SettingsSection id={id} title={title} folded={folded} onToggle={onToggle} actions={actions}>
      <div className="max-w-3xl space-y-4">
        {open.length === 0 && closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noSprints}</p>
        ) : (
          open.length > 0 && (
            <ul aria-label={m.sprintList} className="space-y-2">
              {open.map((sprint) => (
                <SprintItem
                  key={sprint.slug}
                  sprint={sprint}
                  canClose={canWrite}
                  onClose={setClosing}
                />
              ))}
            </ul>
          )
        )}
        {closed.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              className="-ml-1 inline-flex items-center gap-1 rounded-sm pr-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
              aria-expanded={showClosed}
              aria-controls={showClosed ? closedId : undefined}
              onClick={() => setShowClosed(!showClosed)}
            >
              <Chevron aria-hidden="true" className="size-4 text-muted-foreground" />
              {m.closedSprints(closed.length)}
            </button>
            {showClosed && (
              <ul id={closedId} aria-label={m.closedSprintList} className="space-y-2">
                {closed.map((sprint) => (
                  <SprintItem
                    key={sprint.slug}
                    sprint={sprint}
                    canClose={false}
                    onClose={setClosing}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {adding && <AddDialog section={id} onOpenChange={setAdding} />}
      {/* Schließt der Sprint per Patch oder verschwindet er, schließt sich sein Dialog mit. */}
      {closing !== undefined && closingOpen && (
        <CloseDialog
          slug={closing}
          others={openSlugs.filter((s) => s !== closing)}
          onOpenChange={(o) => !o && setClosing(undefined)}
          onClosed={() => {
            vanished.current = true;
          }}
          onCloseAutoFocus={afterClose}
        />
      )}
    </SettingsSection>
  );
}
