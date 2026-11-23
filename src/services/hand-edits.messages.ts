import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    notARegularFile: (path: string) => `${path} is not a regular file`,
    notARegularFileHint:
      'symlinks and directories of other repos do not belong in the backlog; remove them or replace them with a file.',
    editorOrSystemFiles: (paths: string) => `Editor or system files: ${paths}`,
    junkHint: 'delete them or add them to .gitignore',
  },
  de: {
    notARegularFile: (path: string) => `${path} ist keine reguläre Datei`,
    notARegularFileHint:
      'Symlinks und Verzeichnisse fremder Repos gehören nicht ins Backlog; entfernen oder durch eine Datei ersetzen.',
    editorOrSystemFiles: (paths: string) => `Editor- oder Systemdateien: ${paths}`,
    junkHint: 'löschen oder in .gitignore aufnehmen',
  },
});
