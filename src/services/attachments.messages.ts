import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidAttachmentName: (file: string) => `Invalid file name for the attachment: '${file}'`,
    attachmentNameHint: 'give --name <n>.<ext> matching [a-z0-9][a-z0-9._-]{0,63}',
    fileNotFound: (raw: string) => `File '${raw}' not found`,
    fileUnreadable: (raw: string, code: string) => `File '${raw}' cannot be read (${code})`,
    fileOutsideWorkdir: (raw: string) => `File '${raw}' is outside the working directory`,
    passTextOrJson: 'pass the content as text or json',
    notAFile: (path: string) => `${path} is not a file`,
    fileSwapped: (raw: string) => `File '${raw}' was swapped while being read`,
    noAttachmentSource: 'No source for the attachment',
    invalidJson: (reason: string) => `Invalid JSON: ${reason}`,
    attachmentNotFound: (id: string, name: string) => `${id}: attachment '${name}' not found`,
    pathMissing: (path: string) => `${path} does not exist`,
    attachmentNotLoaded: (name: string) => `Attachment '${name}' is not loaded (LFS)`,
  },
  de: {
    invalidAttachmentName: (file: string) => `Ungültiger Dateiname für den Anhang: »${file}«`,
    attachmentNameHint: '--name <n>.<ext> angeben; erlaubt sind [a-z0-9][a-z0-9._-]{0,63}',
    fileNotFound: (raw: string) => `Datei »${raw}« nicht gefunden`,
    fileUnreadable: (raw: string, code: string) =>
      `Datei »${raw}« lässt sich nicht lesen (${code})`,
    fileOutsideWorkdir: (raw: string) => `Datei »${raw}« liegt außerhalb des Arbeitsverzeichnisses`,
    passTextOrJson: 'Inhalt per text oder json übergeben',
    notAFile: (path: string) => `${path} ist keine Datei`,
    fileSwapped: (raw: string) => `Datei »${raw}« wurde während des Lesens ausgetauscht`,
    noAttachmentSource: 'Keine Quelle für den Anhang',
    invalidJson: (reason: string) => `Ungültiges JSON: ${reason}`,
    attachmentNotFound: (id: string, name: string) => `${id}: Anhang »${name}« nicht gefunden`,
    pathMissing: (path: string) => `${path} existiert nicht`,
    attachmentNotLoaded: (name: string) => `Anhang »${name}« ist nicht geladen (LFS)`,
  },
});
