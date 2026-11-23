import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    notRegularFile: (sha: string, path: string) => `Commit ${sha}: ${path} is not a regular file`,
    cannotReapply: (sha: string, reason: string) =>
      `Local commit ${sha} can no longer be applied after re-signing: ${reason}`,
    noTrustAnchor: (wc: string) => `No trust anchor in ${wc}`,
    resignHint: 'Recreate hand edits with backe commit',
    resignWithHandEdits: (flag: string) => `${flag} cannot be combined with hand edits`,
    resignWithHandEditsHint: 'run backe commit first',
    noCommonAncestor: (ref: string) =>
      `HEAD has no common ancestor with ${ref}; local commits cannot be determined`,
    verifyWouldReject: (reasons: string) => `verify would reject the commit: ${reasons}`,
  },
  de: {
    notRegularFile: (sha: string, path: string) =>
      `Commit ${sha}: ${path} ist keine reguläre Datei`,
    cannotReapply: (sha: string, reason: string) =>
      `Lokaler Commit ${sha} lässt sich nach dem Neusignieren nicht mehr anwenden: ${reason}`,
    noTrustAnchor: (wc: string) => `Kein Vertrauensanker in ${wc}`,
    resignHint: 'Hand-Edits per backe commit neu anlegen',
    resignWithHandEdits: (flag: string) => `${flag} geht nicht zusammen mit Hand-Edits`,
    resignWithHandEditsHint: 'erst backe commit',
    noCommonAncestor: (ref: string) =>
      `HEAD hat keinen gemeinsamen Vorfahren mit ${ref}; lokale Commits unbestimmbar`,
    verifyWouldReject: (reasons: string) => `verify würde den Commit ablehnen: ${reasons}`,
  },
});
