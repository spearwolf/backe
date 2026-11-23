import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    schemaNotAnObject: 'UserConfigSchema is not an object',
    unsupportedType: (path: string, type: string) =>
      `'${path}' (${type}) is not supported by config`,
    noSubkeys: (path: string) => `'${path}' has no subkeys`,
    unknownKey: (segment: string, allowed: string) =>
      `Unknown key '${segment}'; allowed: ${allowed}`,
    emptyKey: (parent: string | undefined) =>
      parent === undefined ? 'Empty key' : `Empty key (under '${parent}')`,
    notSettable: (key: string) => `'${key}' is not a settable value`,
    notSet: (key: string) => `'${key}' is not set`,
    draftKept: (draft: string) => `Your draft is in ${draft}`,
    changedWhileEditing: (file: string) => `${file} changed since the editor was started`,
  },
  de: {
    schemaNotAnObject: 'UserConfigSchema ist kein Objekt',
    unsupportedType: (path: string, type: string) =>
      `»${path}« (${type}) wird von config nicht unterstützt`,
    noSubkeys: (path: string) => `»${path}« hat keine Unterkeys`,
    unknownKey: (segment: string, allowed: string) =>
      `Unbekannter Key »${segment}«; erlaubt: ${allowed}`,
    emptyKey: (parent: string | undefined) =>
      parent === undefined ? 'Leerer Key' : `Leerer Key (unter »${parent}«)`,
    notSettable: (key: string) => `»${key}« ist kein setzbarer Wert`,
    notSet: (key: string) => `»${key}« ist nicht gesetzt`,
    draftKept: (draft: string) => `Dein Entwurf liegt in ${draft}`,
    changedWhileEditing: (file: string) =>
      `${file} hat sich geändert, seit der Editor gestartet wurde`,
  },
});
