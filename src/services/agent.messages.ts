import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidHandle: (handle: string) => `Invalid handle: '${handle}'`,
    identityExists: (handle: string) => `An identity is already configured for '${handle}'`,
    identityExistsHint: (backlog: string, handle: string) =>
      `Check identities.${backlog}.${handle} in the user config`,
    writeProducedNoCommit: (handle: string) => `The write for '${handle}' produced no commit`,
    identityNotSaved: (handle: string, commit: string, reason: string) =>
      `Agent ${handle} was created (commit ${commit}), but the identity could not be saved: ${reason}`,
    identityNotSavedHint: (backlog: string, handle: string, keyPath: string, configPath: string) =>
      `Add identities.${backlog}.${handle}.key = ${keyPath} in ${configPath}`,
  },
  de: {
    invalidHandle: (handle: string) => `Ungültiger Handle: »${handle}«`,
    identityExists: (handle: string) => `Für »${handle}« ist schon eine Identität eingetragen`,
    identityExistsHint: (backlog: string, handle: string) =>
      `identities.${backlog}.${handle} in der User-Config prüfen`,
    writeProducedNoCommit: (handle: string) =>
      `Der Write für »${handle}« hat keinen Commit erzeugt`,
    identityNotSaved: (handle: string, commit: string, reason: string) =>
      `Agent ${handle} ist angelegt (Commit ${commit}), aber die Identität konnte nicht eingetragen werden: ${reason}`,
    identityNotSavedHint: (backlog: string, handle: string, keyPath: string, configPath: string) =>
      `identities.${backlog}.${handle}.key = ${keyPath} in ${configPath} eintragen`,
  },
});
