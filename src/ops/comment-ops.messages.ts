import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    commentNeedsText: 'A comment needs a text',
    commentsNotLoaded: (id: string) => `Comments of ${id} were not loaded`,
    commentNotFound: (path: string) => `Comment ${path} not found`,
    commentNotOwn: (file: string, author: string, actor: string) =>
      `Comment ${file} belongs to ${author}, not ${actor}`,
    commentChanged: (id: string, file: string) =>
      `${id}: comment ${file} has been changed in the meantime`,
    attachmentTooLarge: (file: string, size: number, max: number) =>
      `Attachment '${file}' has ${size} bytes, ${max} are allowed`,
    raiseLimitHint: 'Raise attachments.max_bytes (backe.md §2.8).',
    raiseLimitOrLfsHint:
      'Raise attachments.max_bytes; enable attachments.lfs for large files (backe.md §2.8).',
    attachmentExists: (id: string, name: string) => `${id}: attachment '${name}' already exists`,
    attachWithoutContent: (file: string) => `attach.add for '${file}' without file content`,
    fileBelongsToOtherAttachment: (id: string, file: string) =>
      `${id}: file '${file}' already belongs to another attachment`,
    attachmentNotFound: (id: string, name: string) => `${id}: attachment '${name}' not found`,
  },
  de: {
    commentNeedsText: 'Ein Kommentar braucht einen Text',
    commentsNotLoaded: (id: string) => `Kommentare von ${id} wurden nicht geladen`,
    commentNotFound: (path: string) => `Kommentar ${path} nicht gefunden`,
    commentNotOwn: (file: string, author: string, actor: string) =>
      `Kommentar ${file} gehört ${author}, nicht ${actor}`,
    commentChanged: (id: string, file: string) =>
      `${id}: Kommentar ${file} wurde inzwischen geändert`,
    attachmentTooLarge: (file: string, size: number, max: number) =>
      `Anhang »${file}« hat ${size} Bytes, erlaubt sind ${max}`,
    raiseLimitHint: 'Grenze attachments.max_bytes anheben (backe.md §2.8).',
    raiseLimitOrLfsHint:
      'Grenze attachments.max_bytes anheben; für große Dateien attachments.lfs aktivieren (backe.md §2.8).',
    attachmentExists: (id: string, name: string) => `${id}: Anhang »${name}« existiert bereits`,
    attachWithoutContent: (file: string) => `attach.add für »${file}« ohne Dateiinhalt`,
    fileBelongsToOtherAttachment: (id: string, file: string) =>
      `${id}: Datei »${file}« gehört schon einem anderen Anhang`,
    attachmentNotFound: (id: string, name: string) => `${id}: Anhang »${name}« nicht gefunden`,
  },
});
