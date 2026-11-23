import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    canonicalUrlShared: (canonical: string, others: readonly string[]) =>
      `Canonical URL '${canonical}' also belongs to ${others.map((n) => `'${n}'`).join(', ')}`,
    repoNotFound: (name: string) => `Repo '${name}' not found`,
    repoNotFoundHint: 'backe repo list shows the registered repos',
    invalidIssueRef: (key: string, path: string, ref: string) =>
      `Issue '${key}' (${path}): ref '${ref}' is invalid`,
    withUnregisteredRepo: (message: string, name: string) =>
      `${message}, repo '${name}' is not registered`,
    githubNoUsableAnswer: 'GitHub returned no usable response',
    githubRequestFailed: (detail: string) => `GitHub request failed: ${detail}`,
    unreachable: (detail: string) => `unreachable: ${detail}`,
    repoArchived: 'Repo is archived',
    staleCache: (cached: string) => ` (cache from ${cached}; --fresh checks again)`,
    looksLikeCommit: (label: string, ref: string) =>
      `${label} '${ref}' looks like a commit and cannot be checked via ls-remote`,
    missingOnRemote: (label: string, ref: string, stale: string) =>
      `${label} '${ref}' does not exist on the remote${stale}`,
    errorCount: (count: number) => `repo check: ${count} ${count === 1 ? 'error' : 'errors'}`,
  },
  de: {
    canonicalUrlShared: (canonical: string, others: readonly string[]) =>
      `Kanonische URL »${canonical}« gehört auch zu ${others.map((n) => `»${n}«`).join(', ')}`,
    repoNotFound: (name: string) => `Repo »${name}« nicht gefunden`,
    repoNotFoundHint: 'backe repo list zeigt die registrierten Repos',
    invalidIssueRef: (key: string, path: string, ref: string) =>
      `Issue »${key}« (${path}): Ref »${ref}« ist ungültig`,
    withUnregisteredRepo: (message: string, name: string) =>
      `${message}, Repo »${name}« ist nicht registriert`,
    githubNoUsableAnswer: 'GitHub lieferte keine auswertbare Antwort',
    githubRequestFailed: (detail: string) => `GitHub-Abfrage fehlgeschlagen: ${detail}`,
    unreachable: (detail: string) => `nicht erreichbar: ${detail}`,
    repoArchived: 'Repo ist archiviert',
    staleCache: (cached: string) => ` (Cache vom ${cached}; --fresh prüft neu)`,
    looksLikeCommit: (label: string, ref: string) =>
      `${label} »${ref}« sieht wie ein Commit aus und ist per ls-remote nicht prüfbar`,
    missingOnRemote: (label: string, ref: string, stale: string) =>
      `${label} »${ref}« existiert im Remote nicht${stale}`,
    errorCount: (count: number) => `repo check: ${count} Fehler`,
  },
});
