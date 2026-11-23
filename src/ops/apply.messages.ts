import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    actorNotUser: (actor: string) => `Actor '${actor}' is not a user of this backlog`,
    invalidTimestamp: (now: string) => `Invalid timestamp in ApplyContext: '${now}'`,
    unresolvedPlaceholders: (list: string) => `Unresolved placeholders: ${list}`,
    placeholdersHint:
      'Placeholders exist only in a batch; they are replaced there before applying.',
  },
  de: {
    actorNotUser: (actor: string) => `Akteur »${actor}« ist kein User dieses Backlogs`,
    invalidTimestamp: (now: string) => `Ungültiger Zeitstempel im ApplyContext: »${now}«`,
    unresolvedPlaceholders: (list: string) => `Unaufgelöste Platzhalter: ${list}`,
    placeholdersHint: 'Platzhalter gibt es nur im Batch; dort werden sie vor dem Anwenden ersetzt.',
  },
});
