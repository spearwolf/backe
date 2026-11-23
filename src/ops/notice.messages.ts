import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    settledDependency: (id: string, list: string) =>
      `${id} depends on cancelled or rejected issues: ${list}`,
    notDone: (id: string, odd: string) => `${id} (not done: ${odd})`,
    allBlockersSettled: (parts: string) => `All blockers settled, can be unblocked: ${parts}`,
  },
  de: {
    settledDependency: (id: string, list: string) =>
      `${id} hängt von abgebrochenen oder abgelehnten Issues ab: ${list}`,
    notDone: (id: string, odd: string) => `${id} (nicht erledigt: ${odd})`,
    allBlockersSettled: (parts: string) => `Alle Blocker erledigt, entblockbar: ${parts}`,
  },
});
