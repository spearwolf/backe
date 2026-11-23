import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    anchorIsIssue: (anchor: string) => `Anchor ${anchor} is the issue itself`,
    anchorUnreadable: (anchor: string, reason: string) =>
      `Anchor ${anchor} is not readable: ${reason}`,
    issueNotFound: (id: string) => `Issue ${id} not found`,
    anchorWithoutRank: (anchor: string) => `Anchor ${anchor} has no rank`,
    unknownPosition: 'Unknown rank position',
    rankNotInteger: (value: number) => `rank must be an integer, not ${value}`,
  },
  de: {
    anchorIsIssue: (anchor: string) => `Anker ${anchor} ist das Issue selbst`,
    anchorUnreadable: (anchor: string, reason: string) =>
      `Anker ${anchor} ist nicht lesbar: ${reason}`,
    issueNotFound: (id: string) => `Issue ${id} nicht gefunden`,
    anchorWithoutRank: (anchor: string) => `Anker ${anchor} hat keinen rank`,
    unknownPosition: 'Unbekannte Rang-Position',
    rankNotInteger: (value: number) => `rank muss eine Ganzzahl sein, nicht ${value}`,
  },
});
