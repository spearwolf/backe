import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    foreignCommit: (sha: string) => `Local commit ${sha} was not signed by backe`,
    foreignCommitHint: 'backe commit --resign',
    mergeCommit: (sha: string) => `Local commit ${sha} is a merge commit`,
    claimUnitWithoutClaim: (sha: string) => `Claim unit ${sha} contains no issue.claim`,
    claimLost: (ids: string, reason: string) => `Claim ${ids} lost: ${reason}`,
  },
  de: {
    foreignCommit: (sha: string) => `Lokaler Commit ${sha} ist nicht von backe signiert`,
    foreignCommitHint: 'backe commit --resign',
    mergeCommit: (sha: string) => `Lokaler Commit ${sha} ist ein Merge-Commit`,
    claimUnitWithoutClaim: (sha: string) => `Claim-Einheit ${sha} enthält kein issue.claim`,
    claimLost: (ids: string, reason: string) => `Claim ${ids} verloren: ${reason}`,
  },
});
