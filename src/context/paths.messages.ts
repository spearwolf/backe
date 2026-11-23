import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    tildeUserUnsupported: (p: string) => `Path '${p}': ~name is not supported`,
    tildeUserHint: 'Use ~/… or an absolute path',
  },
  de: {
    tildeUserUnsupported: (p: string) => `Pfad »${p}«: ~name wird nicht unterstützt`,
    tildeUserHint: 'Nutze ~/… oder einen absoluten Pfad.',
  },
});
