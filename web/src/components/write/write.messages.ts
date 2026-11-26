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
    createdUploadFailed: (id: string, done: number, total: number) =>
      `Issue ${id} was created; ${done} of ${total} images uploaded.`,
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
    createdUploadFailed: (id: string, done: number, total: number) =>
      `Issue ${id} ist angelegt; ${done} von ${total} Bildern hochgeladen.`,
  },
});
