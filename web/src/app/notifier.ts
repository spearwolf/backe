/**
 * Der Notifier (ui.md U11): hängt sich an eine laufende Sitzung und zeigt Browser-Meldungen für
 * fremde Zuweisungen, fremde Änderungen an eigenen Issues und neue Sync-Konflikte. Die Regeln
 * stehen in `notes.ts`; hier nur Verdrahtung, Texte und Klickziele.
 */
import { createEffect, SignalGroup } from '@spearwolf/signalize';
import type { Session } from '../data/session.ts';
import type { ShowNote } from './browser-notes.ts';
import { EMPTY_FILTER, listFilterSearch } from './list-filter.ts';
import { m } from './notes.messages.ts';
import { conflictNotes, isIssueNote, issueNotes } from './notes.ts';
import { routeHref } from './routes.ts';

/** Bis hierher zeigt jede Issue-Meldung eines Patches für sich; darüber eine Sammelmeldung. */
export const NOTE_SUMMARY_AFTER = 3;

type Opts = { me: string; show: ShowNote; open: (href: string) => void };

/** Gibt die Abmeldung zurück: Hörer und Effect sind danach weg, nichts meldet sich mehr. */
export function attachNotifier(session: Session, opts: Opts): () => void {
  const { me, show, open } = opts;
  const { backlog } = session;
  const tag = (id: string) => `backe:${backlog}:${id}`;
  // Ziel der Sammelmeldung: meine Issues in allen States. Der Default zeigt nur offene, und ein
  // Issue, das der Patch geschlossen hat, fehlte dort.
  const filter = { ...EMPTY_FILTER, states: ['all'], assignee: me };
  const mine = `${routeHref({ kind: 'backlog', backlog })}${listFilterSearch(filter)}`;

  const offApplied = session.onApplied((patch, before) => {
    const notes = issueNotes(patch, (id) => before.get(id), me).filter(isIssueNote);
    if (notes.length > NOTE_SUMMARY_AFTER) {
      const by = [...new Set(notes.flatMap((n) => n.by))].sort();
      show({
        title: m.summaryTitle(notes.length),
        body: m.summaryBody(by.join(', ')),
        tag: tag('summary'),
        onClick: () => open(mine),
      });
      return;
    }
    for (const n of notes) {
      show({
        // Zeilenumbrüche und Leerzeichenfolgen im Titel werden zu einem Leerzeichen; ein leerer
        // Titel lässt die ID allein stehen.
        title: `${n.id} ${n.title}`.replace(/\s+/g, ' ').trim(),
        body: m[n.kind](n.by.join(', ')),
        tag: tag(n.id),
        onClick: () => open(routeHref({ kind: 'issue', backlog, id: n.id })),
      });
    }
  });

  // Der erste gesehene Status ist die Grundlinie, auch wenn er schon beim Anhängen da ist; ein
  // anfängliches `null` (noch nichts geladen) schiebt sie bis zum ersten echten Status auf.
  const owner = {};
  let known: ReadonlySet<string> | undefined;
  createEffect(
    () => {
      const sync = session.store.sync.get();
      if (known === undefined) {
        if (sync !== null) known = conflictNotes(new Set(), sync).known;
        return;
      }
      const next = conflictNotes(known, sync);
      known = next.known;
      for (const n of next.notes) {
        show({
          title: m.syncConflict,
          // Bei Konflikten trägt `title` das Subject des Konflikt-Commits.
          body: n.title,
          tag: tag(n.id),
          onClick: () => open(routeHref({ kind: 'settings', backlog, section: 'backlog' })),
        });
      }
    },
    { attach: owner },
  );

  return () => {
    offApplied();
    SignalGroup.delete(owner);
  };
}
