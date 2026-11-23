import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    repoNotFound: (name: string) => `Repo '${name}' not found`,
    repoNotFoundHint: 'backe repo list shows the registered repos',
    noLocalPath: (name: string) => `No local path for '${name}'`,
    noLocalPathHint: (canonical: string) =>
      `backe repo scan <directory> or backe config set repos.${canonical} <path>`,
    pathMissing: (path: string) => `${path} does not exist`,
    pathMissingHint: (canonical: string) => `backe config set repos.${canonical} <path>`,
    notSearchable: (path: string, code: string) => `${path} cannot be searched (${code})`,
  },
  de: {
    repoNotFound: (name: string) => `Repo »${name}« nicht gefunden`,
    repoNotFoundHint: 'backe repo list zeigt die registrierten Repos',
    noLocalPath: (name: string) => `Kein lokaler Pfad für »${name}«`,
    noLocalPathHint: (canonical: string) =>
      `backe repo scan <verzeichnis> oder backe config set repos.${canonical} <pfad>`,
    pathMissing: (path: string) => `${path} existiert nicht`,
    pathMissingHint: (canonical: string) => `backe config set repos.${canonical} <pfad>`,
    notSearchable: (path: string, code: string) => `${path} lässt sich nicht durchsuchen (${code})`,
  },
});
