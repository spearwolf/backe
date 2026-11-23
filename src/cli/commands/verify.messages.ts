import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    description: 'Check signatures and permissions of every commit since the anchor',
    sinceOption: 'Only check commits after <rev>',
    acceptOption: 'Record an invalid commit as accepted in the quarantine',
    revertOption: 'Revert an invalid commit and record it in the quarantine',
    reasonOption: "Justification for --accept/--revert ('-' reads stdin)",
    checked: (count: number, since: string) => `checked: ${count} commits since ${since}`,
    acceptAndRevertExclusive: '--accept and --revert are mutually exclusive',
    sinceExcludesQuarantine: '--since cannot be combined with --accept or --revert',
    reasonRequired: (flag: string) => `${flag} needs --reason with a justification`,
    reasonOnlyWithQuarantine: '--reason only works with --accept or --revert',
    unknownKeys: (path: string, keys: string) =>
      `${path}: unknown keys ${keys} — custom data belongs in props`,
  },
  de: {
    description: 'Signaturen und Rechte jedes Commits seit dem Anker prüfen',
    sinceOption: 'nur Commits nach <rev> prüfen',
    acceptOption: 'ungültigen Commit als hingenommen in die Quarantäne eintragen',
    revertOption: 'ungültigen Commit umkehren und in die Quarantäne eintragen',
    reasonOption: 'Begründung für --accept/--revert (»-« liest stdin)',
    checked: (count: number, since: string) => `geprüft: ${count} Commits seit ${since}`,
    acceptAndRevertExclusive: '--accept und --revert schließen sich aus',
    sinceExcludesQuarantine: '--since passt nicht zu --accept oder --revert',
    reasonRequired: (flag: string) => `${flag} braucht --reason mit einer Begründung`,
    reasonOnlyWithQuarantine: '--reason gehört zu --accept oder --revert',
    unknownKeys: (path: string, keys: string) =>
      `${path}: unbekannte Keys ${keys} — eigene Daten gehören nach props`,
  },
});
