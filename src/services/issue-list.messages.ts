import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidSort: (value: string) => `Invalid sort order: '${value}'`,
    sortChoices: 'rank or created',
    parentAndTopLevelExclusive: `--parent and --top-level are mutually exclusive`,
    invalidLimit: (value: number) => `Invalid limit: '${value}'`,
    limitExpects: 'expects an integer of 1 or more',
  },
  de: {
    invalidSort: (value: string) => `Ungültige Sortierung: »${value}«`,
    sortChoices: 'rank oder created',
    parentAndTopLevelExclusive: `--parent und --top-level schließen sich aus`,
    invalidLimit: (value: number) => `Ungültiges Limit: »${value}«`,
    limitExpects: 'erwartet eine ganze Zahl ab 1',
  },
});
