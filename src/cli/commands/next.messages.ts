import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidLevel: (value: string) => `Invalid level: '${value}'`,
    levelHint: 'leaf or top',
    description: 'Show the next issue for me; with --claim, claim it right away',
    projectFlags: '-p, --project <path>',
    projectOption: 'Only in this project',
    sprintOption: 'Only in this sprint',
    repoOption: 'Only with this repo',
    levelOption: 'Unit of work: leaf (default) or whole subtree',
    allOption: 'Ignore the context filter (project, sprint, repo)',
    claimOption: 'Claim the issue right away, in sync with the remote',
    syncExcludesClaim: '--sync cannot be combined with --claim',
    syncExcludesClaimHint: 'the claim syncs on its own',
    alreadyRunning: '(already running)',
  },
  de: {
    invalidLevel: (value: string) => `Ungültige Ebene: »${value}«`,
    levelHint: 'leaf oder top',
    description: 'nächstes Issue für mich zeigen; mit --claim gleich übernehmen',
    projectFlags: '-p, --project <pfad>',
    projectOption: 'nur in diesem Projekt',
    sprintOption: 'nur in diesem Sprint',
    repoOption: 'nur mit diesem Repo',
    levelOption: 'Arbeitseinheit: Blatt (Default) oder ganzer Teilbaum',
    allOption: 'Kontextfilter (Projekt, Sprint, Repo) ignorieren',
    claimOption: 'das Issue gleich übernehmen, synchron mit dem Remote',
    syncExcludesClaim: '--sync passt nicht zu --claim',
    syncExcludesClaimHint: 'der Claim synchronisiert selbst',
    alreadyRunning: '(läuft schon)',
  },
});
