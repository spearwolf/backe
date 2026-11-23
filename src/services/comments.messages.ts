import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    commentEmpty: 'Comment is empty',
    invalidLimit: (value: number) => `Invalid limit: '${value}'`,
    limitExpects: 'expects an integer of 1 or more',
    commentNotFound: (ref: string) => `Comment '${ref}' not found`,
    commentRefHint: 'give a file name or a number from 1 in the comment list',
  },
  de: {
    commentEmpty: 'Kommentar ist leer',
    invalidLimit: (value: number) => `Ungültiges Limit: »${value}«`,
    limitExpects: 'erwartet eine ganze Zahl ab 1',
    commentNotFound: (ref: string) => `Kommentar »${ref}« nicht gefunden`,
    commentRefHint: 'Dateiname oder Nummer ab 1 aus der Kommentarliste angeben',
  },
});
