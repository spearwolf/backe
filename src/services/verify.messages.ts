import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    noTrustAnchor: (wc: string) => `No trust anchor in ${wc}`,
    historyMismatch: (rev: string) => `History of ${rev} does not match the trust anchor`,
    notDescendantOfVerified: (rev: string, verified: string) =>
      `${rev} is not a descendant of the last verified state ${verified}`,
    sinceNotAncestor: (since: string, to: string) => `since ${since} is not an ancestor of ${to}`,
    recordSinceUnverified: (since: string) =>
      `Recording with --since ${since} only works if ${since} is already verified`,
    recordSinceUnverifiedHint: 'Verify without --since, or from the last verified state.',
    actorMissing: 'Backe-Actor missing',
    actorRepeated: 'Backe-Actor repeated',
    signerIsNotActor: (principal: string, actor: string) =>
      `signed by ${principal}, Backe-Actor is ${actor}`,
    opMissing: (sha: string) => `${sha}: Backe-Op missing`,
    opUndecodable: (sha: string) => `${sha}: Backe-Op not decodable`,
    anchorWithoutInit: 'Trust anchor without Backe-Op init',
    notVerifiable: (file: string, detail: string) => `not verifiable: ${file}: ${detail}`,
    actorNotAdminInAnchor: (actor: string) => `Actor ${actor} is not an admin in the trust anchor`,
    quarantineInvalid: (detail: string) => `quarantine.jsonc invalid: ${detail}`,
    buildsOnInvalid: (sha: string) => `builds on invalid commit ${sha}`,
    invalidCommits: (count: number, anchor: string) =>
      `${count} invalid ${count === 1 ? 'commit' : 'commits'} since ${anchor}`,
  },
  de: {
    noTrustAnchor: (wc: string) => `Kein Vertrauensanker in ${wc}`,
    historyMismatch: (rev: string) => `Historie von ${rev} passt nicht zum Vertrauensanker`,
    notDescendantOfVerified: (rev: string, verified: string) =>
      `${rev} ist kein Nachfahre des zuletzt verifizierten Stands ${verified}`,
    sinceNotAncestor: (since: string, to: string) => `since ${since} ist kein Vorfahre von ${to}`,
    recordSinceUnverified: (since: string) =>
      `Aufzeichnen mit --since ${since} geht nur, wenn ${since} schon verifiziert ist`,
    recordSinceUnverifiedHint: 'Ohne --since prüfen oder ab dem zuletzt verifizierten Stand.',
    actorMissing: 'Backe-Actor fehlt',
    actorRepeated: 'Backe-Actor mehrfach',
    signerIsNotActor: (principal: string, actor: string) =>
      `signiert von ${principal}, Backe-Actor ist ${actor}`,
    opMissing: (sha: string) => `${sha}: Backe-Op fehlt`,
    opUndecodable: (sha: string) => `${sha}: Backe-Op nicht dekodierbar`,
    anchorWithoutInit: 'Vertrauensanker ohne Backe-Op init',
    notVerifiable: (file: string, detail: string) => `nicht prüfbar: ${file}: ${detail}`,
    actorNotAdminInAnchor: (actor: string) => `Akteur ${actor} ist im Vertrauensanker kein Admin`,
    quarantineInvalid: (detail: string) => `quarantine.jsonc ungültig: ${detail}`,
    buildsOnInvalid: (sha: string) => `baut auf ungültigem Commit ${sha} auf`,
    invalidCommits: (count: number, anchor: string) => `${count} ungültige Commits seit ${anchor}`,
  },
});
