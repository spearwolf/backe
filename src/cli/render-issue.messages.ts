import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    missingRef: 'missing',
    childrenProgress: (settled: number, total: number) => `${settled}/${total} done`,
  },
  de: {
    missingRef: 'fehlt',
    childrenProgress: (settled: number, total: number) => `${settled}/${total} erledigt`,
  },
});
