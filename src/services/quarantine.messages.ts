import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    manualRevertNeeded: (reason: string) => `Manual revert required: ${reason}`,
    symlinkOrSubmodule: (path: string) => `symlink or submodule ${path}`,
    changedSince: (path: string, sha: string) =>
      `${path} was changed after ${sha}; manual revert required`,
    reasonEmpty: 'Reason must not be empty',
    adminsOnly: 'Only admins may change the quarantine',
    signingKeyNotValid: (handle: string) =>
      `the signing key of ${handle} is not valid in the authoritative state`,
    commitNotInHistory: (sha: string) => `Commit ${sha} is not in the history of HEAD`,
    alreadyQuarantined: (sha: string) => `Commit ${sha} is already in the quarantine`,
    anchorNotRevertible: 'The trust anchor cannot be reverted',
  },
  de: {
    manualRevertNeeded: (reason: string) => `Umkehr von Hand nötig: ${reason}`,
    symlinkOrSubmodule: (path: string) => `Symlink oder Submodule ${path}`,
    changedSince: (path: string, sha: string) =>
      `${path} wurde nach ${sha} geändert; Umkehr von Hand`,
    reasonEmpty: 'Grund darf nicht leer sein',
    adminsOnly: 'Quarantäne ändern nur Admins',
    signingKeyNotValid: (handle: string) =>
      `der Signier-Key von ${handle} gilt im maßgeblichen Stand nicht`,
    commitNotInHistory: (sha: string) => `Commit ${sha} liegt nicht in der Historie von HEAD`,
    alreadyQuarantined: (sha: string) => `Commit ${sha} steht schon in der Quarantäne`,
    anchorNotRevertible: 'Der Vertrauensanker lässt sich nicht umkehren',
  },
});
