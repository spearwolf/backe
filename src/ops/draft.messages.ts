import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    labelIssue: 'Issue',
    labelUser: 'User',
    labelProject: 'Project',
    labelSprint: 'Sprint',
    labelRepo: 'Repo',
    notFound: (label: string, key: string) => `${label} ${key} not found`,
    idMismatch: (file: string, expected: string, got: string) =>
      `${file}: id: expected ${expected}, got ${got}`,
    invalidCommentFileName: (file: string) => `Invalid comment file name '${file}'`,
    commentNotOwn: (file: string, actor: string) => `Comment '${file}' does not belong to ${actor}`,
    commentExists: (path: string) => `Comment ${path} already exists`,
    notLoadable: (label: string, key: string, path: string, reason: string) =>
      `${label} ${key} is not loadable (${path}): ${reason}`,
    notLoadableHint: 'Repair the file first; until then every write to it fails.',
    unknownFields: (file: string, list: string) => `${file}: unknown fields: ${list}`,
    randomSourceShort: (got: number) => `Random source returned ${got} instead of 3 bytes`,
    noFreeCommentName: (attempts: number) =>
      `No free comment file name found after ${attempts} attempts`,
  },
  de: {
    labelIssue: 'Issue',
    labelUser: 'User',
    labelProject: 'Projekt',
    labelSprint: 'Sprint',
    labelRepo: 'Repo',
    notFound: (label: string, key: string) => `${label} ${key} nicht gefunden`,
    idMismatch: (file: string, expected: string, got: string) =>
      `${file}: id: erwartet ${expected}, bekam ${got}`,
    invalidCommentFileName: (file: string) => `Ungültiger Kommentar-Dateiname »${file}«`,
    commentNotOwn: (file: string, actor: string) => `Kommentar »${file}« gehört nicht zu ${actor}`,
    commentExists: (path: string) => `Kommentar ${path} existiert bereits`,
    notLoadable: (label: string, key: string, path: string, reason: string) =>
      `${label} ${key} ist nicht ladbar (${path}): ${reason}`,
    notLoadableHint: 'Erst die Datei reparieren; bis dahin scheitert jeder Write darauf.',
    unknownFields: (file: string, list: string) => `${file}: unbekannte Felder: ${list}`,
    randomSourceShort: (got: number) => `Zufallsquelle lieferte ${got} statt 3 Bytes`,
    noFreeCommentName: (attempts: number) =>
      `Kein freier Kommentar-Dateiname nach ${attempts} Versuchen gefunden`,
  },
});
