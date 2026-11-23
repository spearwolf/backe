import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    description: 'Show the resolved context with the origin of each value',
    projectFlags: '--project <path>',
    projectOption: 'Project for this call',
    sprintOption: 'Sprint for this call',
    propsOption: 'Append the property declarations of the backlog',
    noPropsDeclared: 'no properties declared',
    writeLabel: 'write:',
    yes: 'yes',
    no: 'no',
  },
  de: {
    description: 'aufgelösten Kontext mit Herkunft jedes Werts zeigen',
    projectFlags: '--project <pfad>',
    projectOption: 'Projekt für diesen Aufruf',
    sprintOption: 'Sprint für diesen Aufruf',
    propsOption: 'Property-Deklarationen des Backlogs anhängen',
    noPropsDeclared: 'keine Properties deklariert',
    writeLabel: 'schreiben:',
    yes: 'ja',
    no: 'nein',
  },
});
