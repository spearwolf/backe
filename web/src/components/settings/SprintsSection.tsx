import type { SprintJson } from '@backe/ui/api.ts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { EMPTY_FILTER, listFilterSearch } from '../../app/list-filter.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { sprintGroups } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/settings.messages.ts';
import { Button } from '../ui/button.tsx';
import { useDialogFocus } from './dialog-focus.ts';
import { type SectionFrame, SettingsSection, sectionId } from './SettingsSection.tsx';
import { sprintsOf } from './settings-memos.ts';
import { AddSprintDialog, CloseSprintDialog } from './sprint-dialogs.tsx';

/**
 * Zeitraum roh als `YYYY-MM-DD`, wie er in der Datei steht: beide Daten mit Strich, ein einzelnes
 * als »ab« bzw. »bis«, ohne Daten nichts.
 */
function dates({ start, end }: SprintJson): string | undefined {
  if (start !== undefined && end !== undefined) return `${start} – ${end}`;
  if (start !== undefined) return m.sprintFrom(start);
  if (end !== undefined) return m.sprintUntil(end);
  return undefined;
}

function SprintItem({
  sprint,
  canClose,
  onClose,
}: {
  sprint: SprintJson;
  canClose: boolean;
  onClose: (slug: string, trigger: HTMLElement) => void;
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
        {span !== undefined && <span className="text-sm text-muted-foreground">{span}</span>}
        {canClose && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            aria-label={m.closeSprintOf(slug)}
            onClick={(e) => onClose(slug, e.currentTarget)}
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
  // Ein abgebrochener Dialog gibt den Fokus an seinen Auslöser zurück; nach dem Schließen
  // verschwindet der mit dem offenen Sprint, dann geht er an »Hinzufügen«.
  const addId = `${sectionId(id)}-add`;
  const focus = useDialogFocus(addId);
  const openClose = (slug: string, trigger: HTMLElement): void => {
    focus.opened(trigger);
    setClosing(slug);
  };
  const Chevron = showClosed ? ChevronDown : ChevronRight;

  const actions = canWrite ? (
    <Button
      id={addId}
      type="button"
      size="sm"
      onClick={(e) => {
        focus.opened(e.currentTarget);
        setAdding(true);
      }}
    >
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
                  onClose={openClose}
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
                    onClose={openClose}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {adding && <AddSprintDialog section={id} focus={focus} onOpenChange={setAdding} />}
      {/* Schließt der Sprint per Patch oder verschwindet er, schließt sich sein Dialog mit. */}
      {closing !== undefined && closingOpen && (
        <CloseSprintDialog
          slug={closing}
          others={openSlugs.filter((s) => s !== closing)}
          focus={focus}
          onOpenChange={(o) => !o && setClosing(undefined)}
        />
      )}
    </SettingsSection>
  );
}
