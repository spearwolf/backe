import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    configPathNotObject: (path: string) =>
      `Config path '${path}' runs through a value that is not an object`,
    editNotApplied: (file: string) => `Edit to ${file} could not be applied; file unchanged`,
  },
  de: {
    configPathNotObject: (path: string) =>
      `Config-Pfad »${path}« läuft durch einen Wert, der kein Objekt ist`,
    editNotApplied: (file: string) =>
      `Edit an ${file} konnte nicht angewendet werden; Datei unverändert`,
  },
});
