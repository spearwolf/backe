import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    diagramError: (message: string) => `Diagram could not be rendered: ${message}`,
  },
  de: {
    diagramError: (message: string) => `Diagramm nicht darstellbar: ${message}`,
  },
});
