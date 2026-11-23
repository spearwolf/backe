import { catalog } from '../../i18n/catalog.ts';

export const m = catalog({
  en: {
    command: 'batch [source]',
    description: 'Run operations as JSONL in one commit',
    fileFlags: '-f, --file <path|->',
    fileOption: "JSONL file ('-' reads stdin)",
    unexpectedArgument: (value: string) => `Unexpected argument '${value}'`,
    sourceHint: 'Source: -f <path> or - (stdin)',
    fileAndStdinExclusive: '-f and - are mutually exclusive',
    noInput: 'No input given',
    noInputHint: '-f <path>, -f - or - (stdin)',
  },
  de: {
    command: 'batch [quelle]',
    description: 'Operationen als JSONL in einem Commit ausführen',
    fileFlags: '-f, --file <pfad|->',
    fileOption: 'JSONL-Datei (»-« liest stdin)',
    unexpectedArgument: (value: string) => `Unerwartetes Argument »${value}«`,
    sourceHint: 'Quelle: -f <pfad> oder - (stdin)',
    fileAndStdinExclusive: '-f und - schließen sich aus',
    noInput: 'Keine Eingabe angegeben',
    noInputHint: '-f <pfad>, -f - oder - (stdin)',
  },
});
