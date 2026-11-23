import { catalog } from '../i18n/catalog.ts';

/** Gründe, aus denen `verify` einen Commit ablehnt. */
export const m = catalog({
  en: {
    onlyAdminsChange: (path: string) => `only admins change ${path}`,
    caseVariant: (path: string) => `path differs from the layout only in letter case: ${path}`,
    misnamedComment: (path: string) => `comment file with invalid name: ${path}`,
    unverifiable: (path: string, message: string) => `not verifiable: ${path}: ${message}`,
    creatorMismatch: (id: string, creator: string, actor: string) =>
      `creator of ${id} is ${creator}, actor is ${actor}`,
    idMismatch: (path: string, id: string) => `id of ${path} is ${id}`,
    fieldChanged: (field: string, id: string) => `${field} of ${id} changed`,
    foreignComment: (file: string, author: string, actor: string) =>
      `comment ${file} by ${author}, actor is ${actor}`,
    authorMismatch: (file: string, author: string) =>
      `comment ${file}: author ${author} does not match the file name`,
    authorChanged: (file: string) => `author of comment ${file} changed`,
  },
  de: {
    onlyAdminsChange: (path: string) => `nur Admins ändern ${path}`,
    caseVariant: (path: string) =>
      `Pfad weicht nur in Groß-/Kleinschreibung vom Layout ab: ${path}`,
    misnamedComment: (path: string) => `Kommentar-Datei mit ungültigem Namen: ${path}`,
    unverifiable: (path: string, message: string) => `nicht prüfbar: ${path}: ${message}`,
    creatorMismatch: (id: string, creator: string, actor: string) =>
      `creator von ${id} ist ${creator}, Akteur ist ${actor}`,
    idMismatch: (path: string, id: string) => `id von ${path} ist ${id}`,
    fieldChanged: (field: string, id: string) => `${field} von ${id} geändert`,
    foreignComment: (file: string, author: string, actor: string) =>
      `Kommentar ${file} von ${author}, Akteur ist ${actor}`,
    authorMismatch: (file: string, author: string) =>
      `Kommentar ${file}: author ${author} passt nicht zum Dateinamen`,
    authorChanged: (file: string) => `author von Kommentar ${file} geändert`,
  },
});
