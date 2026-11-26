import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    pending: 'pending',
    failures: 'Failed actions',
    editorText: 'Text',
    editorPreview: 'Preview',
    editorMode: 'Editor view',
    editorUploading: 'Uploading image…',
    newIssue: 'New issue',
    create: 'Create',
    openAfter: 'Open after creating',
    dependsOn: 'Dependencies',
    createdUploadFailed: (id: string) =>
      `Issue ${id} was created, but an image could not be uploaded.`,
  },
  de: {
    cancel: 'Abbrechen',
    dismiss: 'Schließen',
    pending: 'ausstehend',
    failures: 'Fehlgeschlagene Aktionen',
    editorText: 'Text',
    editorPreview: 'Vorschau',
    editorMode: 'Editor-Ansicht',
    editorUploading: 'Bild wird hochgeladen…',
    newIssue: 'Neues Issue',
    create: 'Anlegen',
    openAfter: 'Nach dem Anlegen öffnen',
    dependsOn: 'Abhängigkeiten',
    createdUploadFailed: (id: string) =>
      `Issue ${id} ist angelegt, ein Bild ließ sich aber nicht hochladen.`,
  },
});
