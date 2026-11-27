import { Info } from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';
import { m as app } from '../app/app.messages.ts';
import { useLinkClick, useRouter } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import {
  isSettingsSection,
  SETTINGS_SECTIONS,
  type SettingsSection as Section,
  type ShownNavigation,
} from '../app/settings-model.ts';
import { type Folded, readFolded, writeFolded } from '../app/settings-prefs.ts';
import { BacklogSection } from '../components/settings/BacklogSection.tsx';
import { InterfaceSection } from '../components/settings/InterfaceSection.tsx';
import { SettingsSection, sectionId, toggleId } from '../components/settings/SettingsSection.tsx';
import { useSignal } from '../data/use-signal.ts';
import { cn } from '../lib/utils.ts';
import { m } from './settings.messages.ts';

/**
 * Titel und Inhalt je Abschnitt, an einer Stelle. Ein Abschnitt ohne `Body` zeigt vorerst nur
 * seinen Rahmen; seinen Inhalt bringt er mit, sobald er gebaut ist.
 */
const SECTIONS: Record<Section, { title: () => string; Body?: ComponentType }> = {
  repositories: { title: () => m.sectionRepositories },
  projects: { title: () => m.sectionProjects },
  sprints: { title: () => m.sectionSprints },
  users: { title: () => m.sectionUsers },
  backlog: { title: () => m.sectionBacklog, Body: BacklogSection },
  interface: { title: () => m.sectionInterface, Body: InterfaceSection },
};

type Props = { backlog: string; section: string | undefined; shown: ShownNavigation };

function Settings({ backlog, section, shown }: Props) {
  const navigation = useSignal(useRouter().navigation);
  const go = useLinkClick();
  const [folded, setFolded] = useState<Folded>(() => readFolded(backlog));
  const known = section !== undefined && isSettingsSection(section) ? section : undefined;

  const setFold = (id: Section, value: boolean): void => {
    const next = { ...folded, [id]: value };
    setFolded(next);
    writeFolded(backlog, next);
  };

  // Je Navigation einmal, auch per Link auf den Abschnitt, der schon in der URL steht: aufklappen,
  // zeigen, den Klappknopf fokussieren. Kopf und Knopf stehen auch eingeklappt da; die Ansicht
  // rückt also schon vor dem Aufklappen richtig.
  useEffect(() => {
    if (known === undefined || shown.last === navigation) return;
    shown.last = navigation;
    if (folded[known] === true) {
      const next = { ...folded, [known]: false };
      setFolded(next);
      writeFolded(backlog, next);
    }
    document.getElementById(sectionId(known))?.scrollIntoView?.({ block: 'start' });
    document.getElementById(toggleId(known))?.focus();
  }, [known, navigation, shown, folded, backlog]);

  return (
    <div className="p-4">
      <h1 className="mb-4 text-lg font-semibold">{app.settings}</h1>
      <div className="lg:flex lg:items-start lg:gap-8">
        <nav aria-label={m.sectionsNav} className="sticky top-0 hidden w-48 shrink-0 lg:block">
          <ul className="space-y-0.5 text-sm">
            {SETTINGS_SECTIONS.map((id) => {
              const href = routeHref({ kind: 'settings', backlog, section: id });
              const current = id === known;
              return (
                <li key={id}>
                  <a
                    href={href}
                    onClick={go(href)}
                    aria-current={current ? 'location' : undefined}
                    className={cn(
                      'block rounded-md px-2 py-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring',
                      current && 'bg-accent font-medium',
                    )}
                  >
                    {SECTIONS[id].title()}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 space-y-6">
          {section !== undefined && known === undefined && (
            <p className="flex items-center gap-2 text-sm">
              <Info className="size-4 shrink-0" aria-hidden="true" />
              {m.unknownSection(section)}
            </p>
          )}
          {SETTINGS_SECTIONS.map((id) => {
            const { title, Body } = SECTIONS[id];
            const isFolded = folded[id] === true;
            return (
              <SettingsSection
                key={id}
                id={id}
                title={title()}
                folded={isFolded}
                onToggle={() => setFold(id, !isFolded)}
              >
                {Body !== undefined && <Body />}
              </SettingsSection>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Tab Settings (ui.md §2.10), als eigener Chunk geladen. Je Backlog neu gemountet: Der
 * Klappzustand gehört zum Backlog.
 */
export default function SettingsView(props: Props) {
  return <Settings key={props.backlog} {...props} />;
}
