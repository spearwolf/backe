import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SettingsSection as Section } from '../../app/settings-model.ts';

/** IDs eines Abschnitts; fest statt `useId`, damit Route und Navigation ihn finden. */
export const sectionId = (id: Section) => `settings-${id}`;
export const toggleId = (id: Section) => `settings-${id}-toggle`;

/**
 * Ein einklappbarer Abschnitt der Settings (Skizze `settings.png`): Kopf mit Klappknopf und Titel,
 * rechts daneben Aktionen wie »Hinzufügen«. Eingeklappt steht nur der Kopf da.
 */
export function SettingsSection(props: {
  id: Section;
  title: string;
  folded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { id, title, folded } = props;
  const headingId = `${sectionId(id)}-title`;
  const bodyId = `${sectionId(id)}-body`;
  const Chevron = folded ? ChevronRight : ChevronDown;
  return (
    <section id={sectionId(id)} aria-labelledby={headingId} className="scroll-mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-1">
        <h2 id={headingId} className="flex-1 text-base font-semibold">
          <button
            id={toggleId(id)}
            type="button"
            className="-ml-1 inline-flex items-center gap-1 rounded-sm pr-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
            aria-expanded={!folded}
            aria-controls={folded ? undefined : bodyId}
            onClick={props.onToggle}
          >
            <Chevron aria-hidden="true" className="size-4 text-muted-foreground" />
            {title}
          </button>
        </h2>
        {/* Die Aktionen gehören zum Kopf: »Hinzufügen« öffnet einen Dialog und geht auch eingeklappt. */}
        {props.actions}
      </div>
      {!folded && (
        <div id={bodyId} className="space-y-4 pt-3 pb-2">
          {props.children}
        </div>
      )}
    </section>
  );
}
