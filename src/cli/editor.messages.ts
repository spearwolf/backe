import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    nothingToChange: 'Nothing to change',
    nothingToChangeHint: 'Pass flags or set BACKE_EDITOR',
    editorStartFailed: (reason: string) => `Could not start editor: ${reason}`,
    editorFailed: (code: number) => `Editor exited with exit code ${code}; nothing changed`,
  },
  de: {
    nothingToChange: 'Nichts zu ändern',
    nothingToChangeHint: 'Flags angeben oder BACKE_EDITOR setzen',
    editorStartFailed: (reason: string) => `Editor konnte nicht gestartet werden: ${reason}`,
    editorFailed: (code: number) => `Editor endete mit Exit-Code ${code}; nichts geändert`,
  },
});
