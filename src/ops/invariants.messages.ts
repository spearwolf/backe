import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    refIssue: 'issue',
    refProject: 'project',
    refSprint: 'sprint',
    refRepo: 'repo',
    refUser: 'user',
    hierarchyCycle: (a: string, b: string) => `Cycle via parent and depends_on: ${a} -> ${b}`,
    parentDone: (id: string, parent: string) => `${id}: Parent ${parent} is done`,
    missingRefs: (id: string, list: string) => `${id}: Reference to something nonexistent: ${list}`,
    fieldCycle: (field: string, cycle: string) => `Cycle in ${field}: ${cycle}`,
    repoRepeated: (id: string, name: string) =>
      `${id}: Repo '${name}' appears more than once in repos`,
    repoRepeatedHint: 'Only one entry per repo is allowed ("name" or "name@ref").',
  },
  de: {
    refIssue: 'Issue',
    refProject: 'Projekt',
    refSprint: 'Sprint',
    refRepo: 'Repo',
    refUser: 'User',
    hierarchyCycle: (a: string, b: string) => `Zyklus über parent und depends_on: ${a} -> ${b}`,
    parentDone: (id: string, parent: string) => `${id}: Parent ${parent} ist done`,
    missingRefs: (id: string, list: string) => `${id}: Referenz auf Nichtexistierendes: ${list}`,
    fieldCycle: (field: string, cycle: string) => `Zyklus in ${field}: ${cycle}`,
    repoRepeated: (id: string, name: string) => `${id}: Repo »${name}« steht mehrfach in repos`,
    repoRepeatedHint: 'Je Repo ist nur ein Eintrag erlaubt ("name" oder "name@ref").',
  },
});
