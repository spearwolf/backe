import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    noFreeId: (attempts: number) => `No free issue ID found after ${attempts} attempts`,
    issueNotFound: (id: string) => `Issue '${id}' not found`,
    noIdMatches: (input: string) => `No issue ID matches '${input}'`,
    shortIdTooShort: (min: number, input: string) =>
      `Short ID needs at least ${min} characters: '${input}'`,
    shortIdAmbiguous: (input: string, listed: string) =>
      `Short ID '${input}' is ambiguous: ${listed}`,
  },
  de: {
    noFreeId: (attempts: number) => `Keine freie Issue-ID nach ${attempts} Versuchen gefunden`,
    issueNotFound: (id: string) => `Issue »${id}« nicht gefunden`,
    noIdMatches: (input: string) => `Keine Issue-ID passt zu »${input}«`,
    shortIdTooShort: (min: number, input: string) =>
      `ID-Kurzform braucht mindestens ${min} Zeichen: »${input}«`,
    shortIdAmbiguous: (input: string, listed: string) =>
      `ID-Kurzform »${input}« ist mehrdeutig: ${listed}`,
  },
});
