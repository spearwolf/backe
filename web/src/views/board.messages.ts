import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    lanes: 'Lanes',
    groupSprint: 'Sprint',
    groupProject: 'Project',
    groupRepo: 'Repo',
    groupNone: 'none',
    showBacklog: 'Show backlog column',
    noSprint: 'no sprint',
    noProject: 'no project',
    noRepo: 'no repo',
    allIssues: 'all issues',
    cardCount: (count: number) => `${count} ${count === 1 ? 'card' : 'cards'}`,
    cell: (lane: string, state: string) => `${lane} · ${state}`,
    dragHint: 'Move a card with Alt and the arrow keys.',
  },
  de: {
    lanes: 'Bahnen',
    groupSprint: 'Sprint',
    groupProject: 'Projekt',
    groupRepo: 'Repo',
    groupNone: 'keine',
    showBacklog: 'Spalte backlog zeigen',
    noSprint: 'ohne Sprint',
    noProject: 'ohne Projekt',
    noRepo: 'ohne Repo',
    allIssues: 'alle Issues',
    cardCount: (count: number) => `${count} ${count === 1 ? 'Karte' : 'Karten'}`,
    cell: (lane: string, state: string) => `${lane} · ${state}`,
    dragHint: 'Karte mit Alt und den Pfeiltasten verschieben.',
  },
});
