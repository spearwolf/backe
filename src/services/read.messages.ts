import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    noWorkingCopy: (name: string) => `No working copy of '${name}' available`,
    addBacklogHint: (name: string) => `backe backlog add ${name} <path>`,
    cloneBacklogHint: (remote: string) => `backe backlog clone ${remote}`,
    meNeedsIdentity: "'me' needs an identity",
    identityHint: 'pass --as <handle> or set an identity',
    invalidHandle: (input: string) => `Invalid handle: '${input}'`,
    noStateGiven: 'No state given',
    allStandsAlone: "'all' must stand alone",
  },
  de: {
    noWorkingCopy: (name: string) => `Keine Arbeitskopie von »${name}« vorhanden`,
    addBacklogHint: (name: string) => `backe backlog add ${name} <pfad>`,
    cloneBacklogHint: (remote: string) => `backe backlog clone ${remote}`,
    meNeedsIdentity: '»me« braucht eine Identität',
    identityHint: 'mit --as <handle> angeben oder eine Identität setzen',
    invalidHandle: (input: string) => `Ungültiger Handle: »${input}«`,
    noStateGiven: 'Kein State angegeben',
    allStandsAlone: '»all« steht allein',
  },
});
