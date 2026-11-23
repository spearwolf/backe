import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidCommentCount: (value: number | string) => `Invalid comment count: '${value}'`,
    commentCountExpects: 'give a number of 0 or more, or all',
  },
  de: {
    invalidCommentCount: (value: number | string) => `Ungültige Kommentaranzahl: »${value}«`,
    commentCountExpects: 'eine Zahl ab 0 oder all angeben',
  },
});
