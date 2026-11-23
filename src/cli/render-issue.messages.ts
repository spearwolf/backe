import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    missingRef: 'missing',
    childrenProgress: (settled: number, total: number) => `${settled}/${total} done`,
    pausedFrom: (state: string) => `(from ${state})`,
    blockedBy: (blockers: string) => `blocked by ${blockers}`,
  },
  de: {
    missingRef: 'fehlt',
    childrenProgress: (settled: number, total: number) => `${settled}/${total} erledigt`,
    pausedFrom: (state: string) => `(aus ${state})`,
    blockedBy: (blockers: string) => `blockiert von ${blockers}`,
  },
});
