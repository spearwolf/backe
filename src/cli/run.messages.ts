import { catalog } from '../i18n/catalog.ts';

/** Abschnittstitel der Hilfe, wie commander sie englisch liefert. */
const GERMAN_TITLES: Readonly<Record<string, string>> = {
  'Usage:': 'Aufruf:',
  'Options:': 'Optionen:',
  'Arguments:': 'Argumente:',
  'Commands:': 'Befehle:',
  'Global Options:': 'Globale Optionen:',
};

export const m = catalog({
  en: {
    programDescription: 'Git-based backlog for humans and agents',
    versionDescription: 'Print the version',
    helpDescription: 'Show help',
    helpCommandFlags: 'help [command]',
    helpCommandDescription: 'Help for a command',
    helpTitle: (title: string) => title,
    quickstart: () =>
      [
        '',
        'Quick start:',
        '  backe config set user <handle>    set your own handle',
        '  backe init <dir> --name <n> --prefix <p> --remote <url>',
        '                                    create a new backlog',
        '  backe backlog clone <url>         clone an existing backlog',
        '  backe project create web          create a project (-t for a title)',
        '  backe sprint create 2026-w48      create a sprint',
        '  backe new -t "…" -p web           create an issue (-s for the sprint)',
        '  backe ls                          open issues',
        '  backe show <id>                   show an issue',
        '  backe mv <id> in_progress         change the state',
        '  backe next --claim                fetch and claim the next issue',
        'More: backe <command> --help',
        '',
      ].join('\n'),
    commandMissing: 'Missing command',
    subcommandMissing: 'Missing subcommand',
    argumentMissing: (name: string) => `Missing argument '${name}'`,
    optionMissing: (flags: string) => `Missing option '${flags}'`,
    optionRef: (name: string) => `option ${name}`,
    envVarRef: (name: string) => `environment variable ${name}`,
    didYouMean: (candidates: string, several: boolean) =>
      `(Did you mean ${several ? 'one of ' : ''}${candidates}?)`,
    unknownOption: (flag: string, suggestion: string) => `Unknown option ${flag}${suggestion}`,
    unknownCommand: (name: string, suggestion: string) => `Unknown command '${name}'${suggestion}`,
    excessArguments: (
      command: string | undefined,
      expected: number,
      received: number,
      given: string,
    ) =>
      `Too many arguments${command === undefined ? '' : ` for '${command}'`}: expected ${expected}, got ${received} (${given})`,
    optionMissingArgument: (flags: string) => `Option '${flags}' needs a value`,
    conflictingOption: (a: string, b: string) => `${a} cannot be used with ${b}`,
  },
  de: {
    programDescription: 'Git-basiertes Backlog für Menschen und Agents',
    versionDescription: 'Version ausgeben',
    helpDescription: 'Hilfe anzeigen',
    helpCommandFlags: 'help [befehl]',
    helpCommandDescription: 'Hilfe zu einem Befehl',
    helpTitle: (title: string) => GERMAN_TITLES[title] ?? title,
    quickstart: () =>
      [
        '',
        'Schnellstart:',
        '  backe config set user <handle>    eigenes Handle setzen',
        '  backe init <verz> --name <n> --prefix <p> --remote <url>',
        '                                    neues Backlog anlegen',
        '  backe backlog clone <url>         vorhandenes Backlog klonen',
        '  backe project create web          Projekt anlegen (-t für einen Titel)',
        '  backe sprint create 2026-w48      Sprint anlegen',
        '  backe new -t "…" -p web           Issue anlegen (-s für den Sprint)',
        '  backe ls                          offene Issues',
        '  backe show <id>                   Issue anzeigen',
        '  backe mv <id> in_progress         State ändern',
        '  backe next --claim                nächstes Issue holen und übernehmen',
        'Mehr: backe <befehl> --help',
        '',
      ].join('\n'),
    commandMissing: 'Befehl fehlt',
    subcommandMissing: 'Unterbefehl fehlt',
    argumentMissing: (name: string) => `Argument »${name}« fehlt`,
    optionMissing: (flags: string) => `Option »${flags}« fehlt`,
    optionRef: (name: string) => `Option ${name}`,
    envVarRef: (name: string) => `Umgebungsvariable ${name}`,
    didYouMean: (candidates: string, several: boolean) =>
      `(Meintest du ${several ? 'einen von ' : ''}${candidates}?)`,
    unknownOption: (flag: string, suggestion: string) => `Unbekannte Option ${flag}${suggestion}`,
    unknownCommand: (name: string, suggestion: string) =>
      `Unbekannter Befehl »${name}«${suggestion}`,
    excessArguments: (
      command: string | undefined,
      expected: number,
      received: number,
      given: string,
    ) =>
      `Zu viele Argumente${command === undefined ? '' : ` für »${command}«`}: erwartet ${expected}, erhalten ${received} (${given})`,
    optionMissingArgument: (flags: string) => `Option »${flags}« braucht einen Wert`,
    conflictingOption: (a: string, b: string) => `${a} lässt sich nicht mit ${b} verwenden`,
  },
});
