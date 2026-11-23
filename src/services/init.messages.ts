import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidBacklogName: (name: string) => `Invalid backlog name '${name}'`,
    backlogNameRules: 'Allowed are lowercase letters, digits and hyphens (max. 64 characters).',
    invalidIdPrefix: (prefix: string) => `Invalid ID prefix '${prefix}'`,
    idPrefixRules: 'Allowed are 2 to 6 lowercase letters.',
    invalidHandle: (handle: string) => `Invalid handle '${handle}'`,
    handleRules:
      "Allowed are lowercase letters, digits and hyphens (2 to 32 characters); 'me' is reserved.",
    alreadyRegistered: (name: string) => `Backlog '${name}' is already registered`,
    targetNotAbsolute: (dir: string) => `Target directory must be absolute: ${dir}`,
    targetNotEmpty: (root: string) => `Target directory is not empty: ${root}`,
    pushFailed: (remote: string, detail: string) => `Push to '${remote}' failed: ${detail}`,
  },
  de: {
    invalidBacklogName: (name: string) => `Ungültiger Backlog-Name »${name}«`,
    backlogNameRules: 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche (max. 64 Zeichen).',
    invalidIdPrefix: (prefix: string) => `Ungültiges ID-Präfix »${prefix}«`,
    idPrefixRules: 'Erlaubt sind 2 bis 6 Kleinbuchstaben.',
    invalidHandle: (handle: string) => `Ungültiger Handle »${handle}«`,
    handleRules:
      'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche (2 bis 32 Zeichen); »me« ist reserviert.',
    alreadyRegistered: (name: string) => `Backlog »${name}« ist bereits registriert`,
    targetNotAbsolute: (dir: string) => `Zielverzeichnis muss absolut sein: ${dir}`,
    targetNotEmpty: (root: string) => `Zielverzeichnis ist nicht leer: ${root}`,
    pushFailed: (remote: string, detail: string) => `Push nach ${remote} fehlgeschlagen: ${detail}`,
  },
});
