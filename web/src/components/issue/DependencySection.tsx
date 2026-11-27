/**
 * Hülle des Abschnitts Abhängigkeiten im Tab Issue (ui.md §2.9.5). Sie liegt im Hauptchunk und
 * entscheidet ohne die Graph-Bibliotheken, ob der Abschnitt erscheint, ob er offen ist und welche
 * Ansicht er zeigt. Den Graph-Chunk (`DepPanel` samt `@xyflow/react` und dagre) lädt sie erst,
 * wenn der offene Abschnitt sichtbar wird.
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { lazy, type RefObject, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { m as app } from '../../app/app.messages.ts';
import { hasDependencies } from '../../app/dep-graph.ts';
import { type DepPrefs, readDepPrefs, writeDepPrefs } from '../../app/dep-prefs.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { m } from '../../views/deps.messages.ts';
import { Button } from '../ui/button.tsx';

const DepPanel = lazy(async () => ({ default: (await import('../deps/DepPanel.tsx')).DepPanel }));

/**
 * Sichtbar, sobald `el` einmal in den Viewport ragt; danach bleibt es dabei. Ohne
 * `IntersectionObserver` gilt alles sofort als sichtbar.
 */
function useSeen(el: RefObject<Element | null>, active: boolean): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const target = el.current;
    if (seen || !active || target === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [el, seen, active]);
  return seen;
}

export function DependencySection(props: { id: string; backlog: string }) {
  const { id, backlog } = props;
  const store = useStore();
  const snapshot = useSignal(store.toSnapshot);
  const [prefs, setPrefs] = useState<DepPrefs>(() => readDepPrefs(backlog));
  const host = useRef<HTMLElement>(null);
  const headingId = useId();
  const bodyId = useId();
  // `hasDependencies` kennt auch fehlende IDs; ohne das Issue selbst gibt es hier nichts zu zeigen.
  const shown = useMemo(
    () => snapshot?.issues.has(id) === true && hasDependencies(snapshot, id),
    [snapshot, id],
  );
  // Der Beobachter hängt am Abschnitt; den gibt es nur, solange er gezeigt wird.
  const seen = useSeen(host, shown);

  if (!shown) return null;

  const change = (patch: Partial<DepPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeDepPrefs(backlog, next);
  };
  const Chevron = prefs.open ? ChevronDown : ChevronRight;

  return (
    <section ref={host} aria-labelledby={headingId} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id={headingId} className="text-sm font-semibold">
          <button
            type="button"
            className="-ml-1 inline-flex items-center gap-1 rounded-sm pr-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={prefs.open}
            aria-controls={prefs.open ? bodyId : undefined}
            onClick={() => change({ open: !prefs.open })}
          >
            <Chevron aria-hidden="true" className="size-4 text-muted-foreground" />
            {m.title}
          </button>
        </h2>
        {prefs.open && (
          <>
            <fieldset aria-label={m.view} className="flex gap-1 border-0 p-0">
              <Button
                type="button"
                size="xs"
                variant={prefs.view === 'graph' ? 'secondary' : 'ghost'}
                aria-pressed={prefs.view === 'graph'}
                onClick={() => change({ view: 'graph' })}
              >
                {m.viewGraph}
              </Button>
              <Button
                type="button"
                size="xs"
                variant={prefs.view === 'tree' ? 'secondary' : 'ghost'}
                aria-pressed={prefs.view === 'tree'}
                onClick={() => change({ view: 'tree' })}
              >
                {m.viewTree}
              </Button>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={prefs.parents}
                onChange={(e) => change({ parents: e.target.checked })}
              />
              {m.showParents}
            </label>
          </>
        )}
      </div>
      {prefs.open && (
        <div id={bodyId}>
          {seen && (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted-foreground">
                  {app.loading}
                </p>
              }
            >
              <DepPanel id={id} backlog={backlog} view={prefs.view} parents={prefs.parents} />
            </Suspense>
          )}
        </div>
      )}
    </section>
  );
}
