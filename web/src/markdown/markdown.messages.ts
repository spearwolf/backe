import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    imageBlocked: (alt: string) => `External image blocked: ${alt}`,
    imageBlockedNoAlt: 'External image blocked',
  },
  de: {
    imageBlocked: (alt: string) => `Externes Bild blockiert: ${alt}`,
    imageBlockedNoAlt: 'Externes Bild blockiert',
  },
});
