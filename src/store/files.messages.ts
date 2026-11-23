import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidPath: (path: string) => `Invalid path in backlog: '${path}'`,
    invalidPathHint:
      'Only normalized, relative paths without "..", ".", "//" and a trailing slash are allowed.',
    pathUnderGit: (path: string) => `Path under .git in backlog: '${path}'`,
    pathUnderGitHint: 'Git internals live under ".git"; backe never writes or deletes there.',
    recursiveDeleteNotAllowed: (path: string) => `Recursive delete not allowed: '${path}'`,
    recursiveDeleteHint:
      'Only an issue directory "issues/<shard>/<id>" is deleted recursively (content: null).',
    symlinkInBacklog: (path: string) => `Symlink in backlog: ${path}`,
    symlinkHint:
      'backe does not write through symlinks; replace the link with a file or a directory.',
  },
  de: {
    invalidPath: (path: string) => `Ungültiger Pfad im Backlog: »${path}«`,
    invalidPathHint:
      'Erlaubt sind nur normalisierte, relative Pfade ohne "..", ".", "//" und Schrägstrich am Ende.',
    pathUnderGit: (path: string) => `Pfad unter .git im Backlog: »${path}«`,
    pathUnderGitHint: 'Unter ".git" liegen Git-Interna; dorthin schreibt und löscht backe nie.',
    recursiveDeleteNotAllowed: (path: string) => `Rekursives Löschen nicht erlaubt: »${path}«`,
    recursiveDeleteHint:
      'Rekursiv gelöscht wird nur ein Issue-Verzeichnis "issues/<shard>/<id>" (content: null).',
    symlinkInBacklog: (path: string) => `Symlink im Backlog: ${path}`,
    symlinkHint:
      'backe schreibt nicht durch Symlinks; den Link durch eine Datei oder ein Verzeichnis ersetzen.',
  },
});
