import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    imageBlocked: (alt: string) =>
      alt === '' ? 'External image blocked' : `External image blocked: ${alt}`,
  },
  de: {
    imageBlocked: (alt: string) =>
      alt === '' ? 'Externes Bild blockiert' : `Externes Bild blockiert: ${alt}`,
  },
});
